"""Video <-> page/slide links (where was this page explained, and the reverse).

A link is an ESTIMATE, never evidence. Two independent signals, strongest first:

* screen: text read (OCR) off the video scene frames overlaps the page text by at least
  SCREEN_MIN_OVERLAP. Works when the slide itself is shown on screen, whatever the audio says.
* speech: dense similarity between the page and the transcript reaches LINK_MIN_SIMILARITY and they
  share an anchoring key term (the NO_TOPIC_ANCHOR rule of unified.search).

When nothing qualifies the answer is an empty list; nothing is invented.
"""

from __future__ import annotations

import json
import os
import re

from fastapi import HTTPException
from pydantic import Field, model_validator

from knot_rag import frame_text
from knot_rag.text import fold, stem
from knot_rag.unified import Manifest, technical_terms, topics


# Minimum cosine similarity (1 - cosine distance) between the source text and a transcript chunk.
# The single place this is defined. 0.87 is calibrated for multilingual-e5-small, whose cosine
# scores are compressed into roughly 0.78-0.90 (see docs/video-slayt-esleme-esik.md); another
# embedding model needs its own value, set with KNOT_LINK_MIN_SIMILARITY. When unsure, a higher
# value is right: an empty answer is honest, a wrong moment is not.
def _min_similarity() -> float:
    try:
        value = float(os.environ.get("KNOT_LINK_MIN_SIMILARITY", ""))
    except ValueError:
        return 0.87
    return value if 0.0 <= value <= 1.0 else 0.87


LINK_MIN_SIMILARITY = _min_similarity()
# Screen match: share of the SMALLER key-term set that also appears in the other text.
SCREEN_MIN_OVERLAP = 0.5
SCREEN_MIN_TERMS = 5
SCREEN_WINDOW_MS = 5_000
# Ordinary vocabulary overlap alone is weak: without a technical term, this many shared
# key terms are required for a speech match.
MIN_SHARED_TOPICS = 2
MAX_LINKS = 3
SOURCE_WINDOW_MS = 20_000
MERGE_GAP_MS = 15_000
QUERY_CHARS = 1500
PREVIEW_CHARS = 160
_UPPER = re.compile(r"\b[A-Z][A-Z0-9]{1,9}\b")


class Links(Manifest):
    material_id: str = Field(pattern=r"^(pdf|video|file)_[A-Za-z0-9_-]{1,80}$")
    version: str = Field(pattern=r"^[a-f0-9]{64}$")
    page: int | None = Field(default=None, ge=1, le=500)
    time_ms: int | None = Field(default=None, ge=0, le=604800000)

    @model_validator(mode="after")
    def one_source(self):
        if (self.page is None) == (self.time_ms is None):
            raise ValueError("Exactly one of page or time_ms is required")
        return self


def _display_terms(source_text: str, candidate_text: str, shared: set[str]) -> list[str]:
    """Shared technical terms in their written form (TCP, UDP), from recorded text only."""
    out: dict[str, None] = {}
    for token in _UPPER.findall(source_text) + _UPPER.findall(candidate_text):
        if stem(fold(token)) in shared:
            out.setdefault(token)
    return list(out)[:5]


def overlap(a: set[str], b: set[str]) -> float:
    """Shared key terms / the smaller set; 0 when either side is too short to judge."""
    small = min(len(a), len(b))
    if small < SCREEN_MIN_TERMS:
        return 0.0
    return len(a & b) / small


def _merge_video(items: list[dict]) -> list[dict]:
    """Merge consecutive/overlapping chunks of one video (gap <= MERGE_GAP_MS)."""
    merged: list[dict] = []
    for item in sorted(items, key=lambda e: (e["material_id"], e["location"]["start_ms"])):
        last = merged[-1] if merged else None
        if (
            last
            and last["material_id"] == item["material_id"]
            and item["location"]["start_ms"] - last["location"]["end_ms"] <= MERGE_GAP_MS
        ):
            last["location"]["end_ms"] = max(last["location"]["end_ms"], item["location"]["end_ms"])
            last["terms"] = list(dict.fromkeys(last["terms"] + item["terms"]))[:5]
            if item["score"] > last["score"]:
                last["score"], last["preview"] = item["score"], item["preview"]
            continue
        merged.append({**item, "location": dict(item["location"])})
    return merged


def _where(course_id: str, **extra):
    clauses = [{"course_id": course_id}, {"marker": False}]
    clauses += [{key: value} for key, value in extra.items()]
    return {"$" + "and": clauses}


def _page_key(loc: dict):
    if "page" in loc:
        return ("page", loc["page"])
    if "slide" in loc:
        return ("slide", loc["slide"])
    return None


def _screen_page_to_video(source_text, videos, course_id, col):
    """Moments of other videos whose on-screen text matches this page. -> (found, missing_ids)."""
    tokens = topics(source_text)
    found, missing = [], []
    for video in videos:
        frames = frame_text.load(course_id, video.id, video.version)
        if frames is None:
            missing.append(video.id)
            continue
        run = None
        runs = []
        for frame in frames:
            score = overlap(tokens, topics(frame["text"])) if frame["text"] else 0.0
            if score >= SCREEN_MIN_OVERLAP:
                if run is None:
                    run = {"start": frame["start_ms"], "end": frame["end_ms"], "score": score, "text": frame["text"]}
                    runs.append(run)
                else:
                    run["end"] = frame["end_ms"]
                    if score > run["score"]:
                        run["score"], run["text"] = score, frame["text"]
            else:
                run = None
        if not runs:
            continue
        chunks = col.get(where=_where(course_id, material_id=video.id), limit=5000)
        for r in runs:
            sid, best = "", None
            for cid, meta in zip(chunks["ids"], chunks["metadatas"]):
                if meta["version"] != video.version:
                    continue
                gap = abs(json.loads(meta["location"]).get("start_ms", 0) - r["start"])
                if best is None or gap < best:
                    best, sid = gap, cid
            shared = technical_terms(source_text) & topics(r["text"])
            found.append(
                {
                    "source_id": sid,
                    "material_id": video.id,
                    "title": video.title,
                    "kind": "VIDEO",
                    "location": {"kind": "video", "start_ms": r["start"], "end_ms": r["end"]},
                    "terms": _display_terms(source_text, r["text"], shared),
                    "score": 1.0 + r["score"],
                    "preview": r["text"][:PREVIEW_CHARS],
                    "basis": "screen",
                }
            )
    return found, missing


def _screen_video_to_page(time_ms, video, pages_by_material, course_id):
    """Pages whose text matches what is on screen around time_ms. -> (found, missing_ids)."""
    frames = frame_text.load(course_id, video.id, video.version)
    if frames is None:
        return [], [video.id]
    near = [
        f
        for f in frames
        if f["start_ms"] <= time_ms + SCREEN_WINDOW_MS and f["end_ms"] >= time_ms - SCREEN_WINDOW_MS and f["text"]
    ]
    if not near:
        return [], []
    screen_text = " ".join(f["text"] for f in near)
    tokens = topics(screen_text)
    found = []
    for (_, key), page in pages_by_material.items():
        mat = page["mat"]
        score = overlap(tokens, topics(page["text"]))
        if score < SCREEN_MIN_OVERLAP:
            continue
        kind, number = key
        shared = technical_terms(screen_text) & topics(page["text"])
        found.append(
            {
                "source_id": page["id"],
                "material_id": mat.id,
                "title": mat.title,
                "kind": mat.kind,
                "location": {"kind": kind, kind: number},
                "terms": _display_terms(screen_text, page["text"], shared),
                "score": 1.0 + score,
                "preview": re.sub(r"\s+", " ", page["text"]).strip()[:PREVIEW_CHARS],
                "basis": "screen",
            }
        )
    return found, []


def _same_place(a: dict, b: dict) -> bool:
    if a["material_id"] != b["material_id"]:
        return False
    if a["location"]["kind"] == "video":
        x, y = a["location"], b["location"]
        return x["start_ms"] - MERGE_GAP_MS <= y["end_ms"] and y["start_ms"] - MERGE_GAP_MS <= x["end_ms"]
    return a["location"] == b["location"]


def _source(index, body, col):
    """Source text of the page / the video moment, and which kinds may be linked to."""
    manifest = {m.id: m for m in body.materials}
    source = manifest.get(body.material_id)
    if source is None or source.version != body.version:
        raise HTTPException(404, "Material not found")
    rows = col.get(where=_where(body.course_id, material_id=body.material_id), limit=5000)
    chunks = []
    for text, meta in zip(rows["documents"], rows["metadatas"]):
        if meta["version"] == source.version:
            chunks.append((text, json.loads(meta["location"])))
    if body.page is not None:
        if source.kind not in ("PDF", "PPTX"):
            raise HTTPException(422, "page requires a PDF or PPTX material")
        kinds = ["VIDEO"]
        parts = [
            (loc.get("char_start", 0), t) for t, loc in chunks if (loc.get("page") or loc.get("slide")) == body.page
        ]
    else:
        if source.kind != "VIDEO":
            raise HTTPException(422, "time_ms requires a video material")
        kinds = ["PDF", "PPTX"]
        lo, hi = body.time_ms - SOURCE_WINDOW_MS, body.time_ms + SOURCE_WINDOW_MS
        parts = [
            (loc["start_ms"], t)
            for t, loc in chunks
            if "start_ms" in loc and loc["start_ms"] <= hi and loc["end_ms"] >= lo
        ]
    text = " ".join(t for _, t in sorted(parts, key=lambda p: p[0])).strip()
    allowed = {m.id: m for m in body.materials if m.kind in kinds and m.id != body.material_id}
    return source, text, allowed


def _speech(index, body, col, source_text, allowed):
    """Transcript / page text similarity candidates."""
    raw = col.query(
        query_embeddings=[index.c.embedder.embed_query(source_text[:QUERY_CHARS])],
        n_results=min(60, max(1, col.count())),
        where=_where(body.course_id, material_id={"$" + "in": list(allowed)}),
        include=["documents", "metadatas", "distances"],
    )
    source_topics = topics(source_text)
    source_tech = technical_terms(source_text)
    found = []
    for sid, text, meta, distance in zip(raw["ids"][0], raw["documents"][0], raw["metadatas"][0], raw["distances"][0]):
        mat = allowed.get(meta["material_id"])
        if not mat or meta["version"] != mat.version or meta["course_id"] != body.course_id:
            continue
        similarity = 1 - distance
        if similarity < LINK_MIN_SIMILARITY:
            continue
        candidate_topics = topics(text)
        shared = source_topics & candidate_topics
        tech = source_tech & candidate_topics
        if not tech and len(shared) < MIN_SHARED_TOPICS:
            continue
        location = json.loads(meta["location"])
        if mat.kind == "VIDEO":
            if not ("start_ms" in location and "end_ms" in location):
                continue
            loc = {"kind": "video", "start_ms": location["start_ms"], "end_ms": location["end_ms"]}
        elif "page" in location:
            loc = {"kind": "page", "page": location["page"]}
        elif "slide" in location:
            loc = {"kind": "slide", "slide": location["slide"]}
        else:
            continue
        found.append(
            {
                "source_id": sid,
                "material_id": mat.id,
                "title": mat.title,
                "kind": mat.kind,
                "location": loc,
                "terms": _display_terms(source_text, text, tech),
                "score": similarity + 0.02 * min(len(shared), 5),
                "preview": re.sub(r"\s+", " ", text).strip()[:PREVIEW_CHARS],
                "basis": "speech",
            }
        )
    if body.page is not None:
        return _merge_video(found)
    best: dict[tuple, dict] = {}
    for item in found:
        loc = item["location"]
        key = (item["material_id"], loc["kind"], loc.get("page") or loc.get("slide"))
        if key not in best or item["score"] > best[key]["score"]:
            best[key] = item
    return list(best.values())


def find_links(index, body: Links) -> dict:
    with index.lock:
        col = index.collection()
        source, source_text, allowed = _source(index, body, col)

        # 1) Screen signal (OCR of the video frames).
        screen, missing = [], []
        if allowed and body.page is not None:
            videos = list(allowed.values())
            if source_text:
                screen, missing = _screen_page_to_video(source_text, videos, body.course_id, col)
            else:
                missing = [v.id for v in videos if frame_text.load(body.course_id, v.id, v.version) is None]
        elif allowed:
            pages = {}
            got = col.get(where=_where(body.course_id, material_id={"$" + "in": list(allowed)}), limit=5000)
            for cid, text, meta in zip(got["ids"], got["documents"], got["metadatas"]):
                mat = allowed.get(meta["material_id"])
                key = _page_key(json.loads(meta["location"])) if mat and meta["version"] == mat.version else None
                if key is not None:
                    pages.setdefault((mat.id, key), {"id": cid, "text": "", "mat": mat})["text"] += " " + text
            screen, missing = _screen_video_to_page(body.time_ms, source, pages, body.course_id)

        # 2) Speech signal (transcript text similarity).
        found = _speech(index, body, col, source_text, allowed) if source_text and allowed else []

        # Screen matches lead; speech matches fill the rest unless they point at the same place.
        screen.sort(key=lambda e: e["score"], reverse=True)
        found.sort(key=lambda e: e["score"], reverse=True)
        merged = list(screen)
        for item in found:
            if not any(_same_place(item, s) for s in screen):
                merged.append(item)
        links = [
            {
                "source_id": e["source_id"],
                "material_id": e["material_id"],
                "title": e["title"],
                "kind": e["kind"],
                "location": e["location"],
                "shared_terms": e["terms"],
                "preview": e["preview"],
                "basis": e["basis"],
                "estimated": True,
            }
            for e in merged[:MAX_LINKS]
        ]
        return {"links": links, "frames_missing": missing}
