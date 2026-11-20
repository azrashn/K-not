"""Video <-> page/slide links: "where did the teacher explain this page?" and back.

A link is an ESTIMATE from text similarity, never evidence. A candidate is returned only if
(1) its dense cosine similarity reaches LINK_MIN_SIMILARITY and (2) it shares at least one
anchoring key term with the source text, as in the NO_TOPIC_ANCHOR rule of unified.search.
When nothing qualifies the answer is an empty list; nothing is invented.
"""

from __future__ import annotations

import json
import os
import re
from typing import Literal

from fastapi import HTTPException
from pydantic import Field, model_validator

from knot_rag.schemas.common import Identifier
from knot_rag.text import fold, stem
from knot_rag.unified import Manifest, technical_terms, topics

# Minimum cosine similarity (1 - cosine distance) between the source text and a candidate.
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
# Ordinary vocabulary overlap alone is weak: without a technical term, this many shared
# key terms are required.
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


def find_links(index, body: Links) -> dict:
    with index.lock:
        manifest = {m.id: m for m in body.materials}
        source = manifest.get(body.material_id)
        if source is None or source.version != body.version:
            raise HTTPException(404, "Material not found")
        col = index.collection()
        base = [{"course_id": body.course_id}, {"marker": False}]
        rows = col.get(where={"$and": [*base, {"material_id": body.material_id}]}, limit=5000)
        chunks = []
        for text, meta in zip(rows["documents"], rows["metadatas"]):
            if meta["version"] != source.version:
                continue
            chunks.append((text, json.loads(meta["location"])))

        if body.page is not None:
            if source.kind not in ("PDF", "PPTX"):
                raise HTTPException(422, "page requires a PDF or PPTX material")
            target_kinds = ["VIDEO"]
            parts = [
                (loc.get("char_start", 0), t)
                for t, loc in chunks
                if (loc.get("page") or loc.get("slide")) == body.page
            ]
        else:
            if source.kind != "VIDEO":
                raise HTTPException(422, "time_ms requires a video material")
            target_kinds = ["PDF", "PPTX"]
            lo, hi = body.time_ms - SOURCE_WINDOW_MS, body.time_ms + SOURCE_WINDOW_MS
            parts = [
                (loc["start_ms"], t)
                for t, loc in chunks
                if "start_ms" in loc and loc["start_ms"] <= hi and loc["end_ms"] >= lo
            ]
        source_text = " ".join(t for _, t in sorted(parts, key=lambda p: p[0])).strip()
        candidates_allowed = {
            m.id: m for m in body.materials if m.kind in target_kinds and m.id != body.material_id
        }
        if not source_text or not candidates_allowed:
            return {"links": []}
        total = col.count()
        raw = col.query(
            query_embeddings=[index.c.embedder.embed_query(source_text[:QUERY_CHARS])],
            n_results=min(60, max(1, total)),
            where={"$and": [*base, {"material_id": {"$in": list(candidates_allowed)}}]},
            include=["documents", "metadatas", "distances"],
        )
        source_topics = topics(source_text)
        source_tech = technical_terms(source_text)
        found = []
        for sid, text, meta, distance in zip(
            raw["ids"][0], raw["documents"][0], raw["metadatas"][0], raw["distances"][0]
        ):
            mat = candidates_allowed.get(meta["material_id"])
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
                }
            )
        # Keep the best chunk of a page/slide; merge neighbouring video chunks.
        if body.page is not None:
            found = _merge_video(found)
        else:
            best: dict[tuple, dict] = {}
            for item in found:
                key = (item["material_id"], item["location"]["kind"], item["location"].get("page") or item["location"].get("slide"))
                if key not in best or item["score"] > best[key]["score"]:
                    best[key] = item
                elif best[key]["terms"] != item["terms"]:
                    best[key]["terms"] = list(dict.fromkeys(best[key]["terms"] + item["terms"]))[:5]
            found = list(best.values())
        found.sort(key=lambda e: e["score"], reverse=True)
        return {
            "links": [
                {
                    "source_id": e["source_id"],
                    "material_id": e["material_id"],
                    "title": e["title"],
                    "kind": e["kind"],
                    "location": e["location"],
                    "shared_terms": e["terms"],
                    "preview": e["preview"],
                    "estimated": True,
                }
                for e in found[:MAX_LINKS]
            ]
        }
