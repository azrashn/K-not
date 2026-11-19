"""Course-scoped, typed material projections. No subject-specific rules.

Extraction remains material-specific. This index stores text, not visual vectors.
The internal API is called with a fresh authoritative manifest by NestJS.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import threading
import uuid
import zipfile
import httpx
from xml.etree import ElementTree as ET
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import Field, model_validator

from knot_rag.schemas.common import StrictModel, Identifier
from knot_rag.retrieval.chroma_index import build_chroma_client
from knot_rag.text import content_tokens, fold, stem
from knot_rag.generation.providers.base import LLMRequest, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.generation.providers.policy import is_local_endpoint


# Açık materyalin sıralama puanına eklenen pay (rank_score 0–1.25 aralığında).
ACTIVE_MATERIAL_BOOST = 0.4
# En iyi doğal sonucun bu oranından düşük skorlu kaynaklar elenir.
LOW_SCORE_RATIO = 0.5
# Açık sayfaya (+0.2) ve komşu sayfalarına (±1, +0.1) ek pay.
ACTIVE_PAGE_BOOST = 0.2

class Segment(StrictModel):
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    text: str = Field(min_length=1, max_length=2200)
    location: dict


class Material(StrictModel):
    id: str = Field(pattern=r"^(pdf|video|file)_[A-Za-z0-9_-]{1,80}$")
    version: str = Field(pattern=r"^[a-f0-9]{64}$")
    kind: Literal["PDF", "VIDEO", "PPTX", "TXT"]
    title: str = Field(max_length=300)


class Manifest(StrictModel):
    course_id: Identifier
    materials: list[Material] = Field(max_length=100)

    @model_validator(mode="after")
    def unique(self):
        if len({m.id for m in self.materials}) != len(self.materials):
            raise ValueError("Duplicate material")
        return self


class Projection(StrictModel):
    course_id: Identifier
    material: Material
    segments: list[Segment] = Field(max_length=1000)


class Search(Manifest):
    question: str = Field(min_length=1, max_length=2000)
    active_material_id: str | None = None
    active_source_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    current_time_ms: int | None = Field(default=None, ge=0, le=604800000)
    strategy: Literal["single", "unified", "aligned"] = "aligned"
    context_evidence: list[dict] = Field(default_factory=list, max_length=3)
    explicit_evidence: list[dict] = Field(default_factory=list, max_length=8)
    reference_mode: Literal["auto", "viewport", "conversation"] = "auto"
    eligible_source_ids: list[str] | None = Field(default=None, max_length=4000)
    selected_text: str | None = Field(default=None, max_length=1500)


class Explain(StrictModel):
    question: str = Field(min_length=1, max_length=2000)
    evidence: list[dict] = Field(max_length=8)
    conversation_context: str = Field(default="", max_length=3000)
    response_mode: Literal[
        "default", "short", "step_by_step", "detailed", "example"
    ] = "default"
    image_base64: str | None = Field(default=None, max_length=8_000_000)
    image_source_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    image_region: dict | None = None
    image_location: dict | None = None
    selected_text: str | None = Field(default=None, max_length=1500)


def _extract_limit() -> int:
    """KNOWLEDGE_EXTRACT_MAX_BYTES (default 20 MiB) must match the backend's STUDY_FILE_MAX_BYTES."""
    try:
        value = int(os.environ.get("KNOWLEDGE_EXTRACT_MAX_BYTES", ""))
    except ValueError:
        return 20 * 1024 * 1024
    return value if 1024 <= value <= 50 * 1024 * 1024 else 20 * 1024 * 1024


EXTRACT_MAX_BYTES = _extract_limit()


class Extract(StrictModel):
    kind: Literal["PPTX", "TXT"]
    # base64 grows the payload by 4/3
    content: str = Field(max_length=EXTRACT_MAX_BYTES * 4 // 3 + 16)


class ExamFile(StrictModel):
    kind: Literal["PDF", "DOCX", "TXT"]
    content: str = Field(max_length=8_000_000)


class Summary(StrictModel):
    focus: Literal["summary", "concepts"] = "summary"
    language: Literal["tr", "en"] = "tr"
    evidence: list[dict] = Field(min_length=1, max_length=8)


class QuizDraft(Explain):
    kind: Literal["MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE", "SHORT_ANSWER", "OPEN"]
    language: Literal["tr", "en"] = "tr"
    # Server-built exam-style guidance (format and phrasing only); facts still come from evidence.
    style_hint: str | None = Field(default=None, max_length=1200)


def chunk_text(text: str, location: dict) -> list[dict]:
    return [
        {
            "text": text[i : i + 1800],
            "location": {
                **location,
                "char_start": i,
                "char_end": min(i + 1800, len(text)),
            },
        }
        for i in range(0, len(text), 1650)
        if text[i : i + 1800].strip()
    ]


def extract_file(kind: str, content: bytes) -> list[dict]:
    """No archive extraction, macros, embedded links, images or XML entities executed."""
    if len(content) > EXTRACT_MAX_BYTES:
        raise ValueError(f"File exceeds {EXTRACT_MAX_BYTES // (1024 * 1024)} MiB")
    if kind == "TXT":
        text = content.decode("utf-8-sig", errors="strict").strip()
        if not text or "\x00" in text or len(text) > 300000:
            raise ValueError("Text must be nonempty UTF-8, at most 300000 characters")
        return chunk_text(text, {"kind": "text", "section": 1})
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        infos = archive.infolist()
        if len(infos) > 2000 or len({i.filename for i in infos}) != len(infos):
            raise ValueError("Archive entry limit or duplicate name")
        if sum(i.file_size for i in infos) > max(20 * 1024 * 1024, 3 * EXTRACT_MAX_BYTES):
            raise ValueError("Expanded archive is too large")
        if any(i.flag_bits & 1 or i.file_size > 2 * 1024 * 1024 for i in infos):
            raise ValueError("Encrypted or oversized archive entry")
        names = {i.filename for i in infos}
        if "ppt/presentation.xml" not in names or "[Content_Types].xml" not in names:
            raise ValueError("Not an OOXML presentation")

        def xml(name):
            raw = archive.read(name)
            if (
                b"\x00" in raw
                or b"<!DOCTYPE" in raw.upper()
                or b"<!ENTITY" in raw.upper()
            ):
                raise ValueError("XML entities are not allowed")
            return ET.fromstring(raw)

        ns = {
            "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        }
        relationships = {
            r.attrib["Id"]: r.attrib.get("Target", "")
            for r in xml("ppt/_rels/presentation.xml.rels")
            if r.attrib.get("TargetMode") != "External"
        }
        out = []
        slides = xml("ppt/presentation.xml").findall(".//p:sldId", ns)
        if not 1 <= len(slides) <= 300:
            raise ValueError("Presentation needs 1–300 slides")
        for number, item in enumerate(slides, 1):
            target = relationships.get(item.attrib.get("{" + ns["r"] + "}id"), "")
            if not re.fullmatch(r"slides/slide\d+\.xml", target):
                raise ValueError("Invalid slide relationship")
            root = xml("ppt/" + target)
            text = "\n".join(
                " ".join(p.itertext()) for p in root.findall(".//a:t", ns)
            ).strip()
            # Notes are explicitly separate from the visible slide text.
            notes = ""
            rel = "ppt/slides/_rels/" + target.split("/")[-1] + ".rels"
            if rel in names:
                for link in xml(rel):
                    note = link.attrib.get("Target", "")
                    if (
                        link.attrib.get("Type", "").endswith("/notesSlide")
                        and link.attrib.get("TargetMode") != "External"
                    ):
                        if not re.fullmatch(
                            r"\.\./notesSlides/notesSlide\d+\.xml", note
                        ):
                            raise ValueError("Invalid notes relationship")
                        notes = "\n".join(
                            n.text or ""
                            for n in xml("ppt/" + note[3:]).findall(".//a:t", ns)
                        ).strip()
            if not text and not notes:
                out.append(
                    {
                        "text": "[Bu slaytta çıkarılabilir metin yok.]",
                        "location": {"kind": "slide", "slide": number, "empty": True},
                    }
                )
            for section, value in [("slide_text", text), ("speaker_notes", notes)]:
                out.extend(
                    chunk_text(
                        value, {"kind": "slide", "slide": number, "section": section}
                    )
                )
        if len(out) > 1000 or sum(len(s["text"]) for s in out) > 600000:
            raise ValueError("Extracted text limit exceeded")
        return out


_QUERY_GLUE = {
    stem(t)
    for t in content_tokens(
        "içinde sırasında yapar yapmak anlatıyor anlatılan anlatıldığı açıkla açıklama açıklaması konusu örnek örneği önceki ikinci birinci videodaki slayttaki pdf karşılaştır compare explain example video slide previous second step material document"
    )
}


def technical_terms(text: str) -> set[str]:
    return {stem(fold(t)) for t in re.findall(r"\b[A-Z][A-Z0-9]{1,9}\b", text)} - _QUERY_GLUE


def topics(text: str) -> set[str]:
    return ({
        stem(t) for t in content_tokens(text) if len(t) >= 3 and not t.isdigit()
    } | technical_terms(text)) - _QUERY_GLUE


def duplicate_evidence(a: dict, b: dict) -> bool:
    if a["material_id"] != b["material_id"]:
        return False
    if fold(a["text"]) == fold(b["text"]):
        return True
    x, y = a["location"], b["location"]
    if a["kind"] != "VIDEO" or b["kind"] != "VIDEO":
        return False
    overlap = min(x["end_ms"], y["end_ms"]) - max(x["start_ms"], y["start_ms"])
    shortest = min(x["end_ms"] - x["start_ms"], y["end_ms"] - y["start_ms"])
    ta, tb = topics(a["text"]), topics(b["text"])
    # Suppress an overlapping near-repeat, retaining the better ranked original
    # citation. Never widen its timestamps or merge unrelated distant sections.
    return (
        overlap > 0
        and shortest > 0
        and overlap / shortest >= 0.6
        and len(ta | tb) >= 8
        and len(ta & tb) / len(ta | tb) >= 0.85
    )


def suspected_conflicts(evidence: list[dict]) -> list[dict]:
    """Conservative, non-semantic warnings: never call different prose a contradiction."""
    found = []
    for i, a in enumerate(evidence):
        for b in evidence[i + 1 :]:
            if a["material_id"] == b["material_id"]:
                continue
            ta, tb = topics(a["text"]), topics(b["text"])
            overlap = len(ta & tb) / max(1, len(ta | tb))
            # Near-identical assertions with opposite negation warrant inspection,
            # not an automatic correction or selection of the "true" source.
            neg = lambda t: bool(
                re.search(r"\b(?:değildir|degildir|değil|degil|not|never)\b", fold(t))
            )
            if overlap >= 0.65 and neg(a["text"]) != neg(b["text"]):
                found.append(
                    {
                        "kind": "POSSIBLE_CONFLICT",
                        "sources": [a["id"], b["id"]],
                        "confirmed": False,
                        "message": "Benzer kaynak ifadelerinde farklı olumsuzlama var; özgün materyalleri karşılaştırın.",
                    }
                )
    return found[:6]


class UnifiedIndex:
    def __init__(self, components, client=None):
        self.c = components
        self.client = client
        self.lock = threading.RLock()

    def collection(self):
        if self.client is None:
            s = self.c.settings
            self.client = build_chroma_client(
                s.chroma_mode, s.chroma_host, s.chroma_port, s.chroma_path
            )
        cfg = self.c.embedding_configuration()
        name = "knot_unified_" + cfg.fingerprint().split(":")[-1][:20]
        return self.client.get_or_create_collection(
            name, metadata={"hnsw:space": "cosine", "fingerprint": cfg.fingerprint()}
        )

    def state(self, body: Manifest):
        with self.lock:
            col = self.collection()
            result = {}
            for material in body.materials:
                rows = col.get(
                    where={
                        "$and": [
                            {"course_id": body.course_id},
                            {"material_id": material.id},
                            {"marker": True},
                        ]
                    }
                )
                if rows["metadatas"]:
                    result[material.id] = rows["metadatas"][0]["version"]
            return {"versions": result}

    def upsert(self, body: Projection):
        with self.lock:
            col = self.collection()
            scope = {
                "$and": [
                    {"course_id": body.course_id},
                    {"material_id": body.material.id},
                ]
            }
            previous = col.get(where={"$and": [*scope["$and"], {"marker": True}]})
            if any(m.get("deleted") for m in previous["metadatas"]):
                raise HTTPException(
                    409, "Material has been deleted; stale indexing rejected"
                )
            # Old revisions are never returned: search also checks the manifest version.
            # Publish the completion marker only AFTER every batch succeeds.
            col.delete(where=scope)
            entries = [s for s in body.segments if not s.location.get("empty")]
            for offset in range(0, len(entries), 48):
                batch = entries[offset : offset + 48]
                col.upsert(
                    ids=[s.id for s in batch],
                    documents=[s.text for s in batch],
                    embeddings=self.c.embedder.embed_documents([s.text for s in batch]),
                    metadatas=[
                        {
                            "course_id": body.course_id,
                            "material_id": body.material.id,
                            "version": body.material.version,
                            "kind": body.material.kind,
                            "title": body.material.title,
                            "location": json.dumps(s.location),
                            "marker": False,
                        }
                        for s in batch
                    ],
                )
            marker = hashlib.sha256(
                (body.course_id + body.material.id + ":manifest").encode()
            ).hexdigest()
            col.upsert(
                ids=[marker],
                documents=["manifest"],
                embeddings=[[0.0] * self.c.embedder.dimension],
                metadatas=[
                    {
                        "course_id": body.course_id,
                        "material_id": body.material.id,
                        "version": body.material.version,
                        "marker": True,
                    }
                ],
            )
            return {"indexed": len(entries), "version": body.material.version}

    def delete(self, course_id: str, material_id: str):
        from knot_rag.visuals import purge

        if os.environ.get("STORAGE_ROOT"):
            purge(course_id, material_id)
        with self.lock:
            col = self.collection()
            col.delete(
                where={"$and": [{"course_id": course_id}, {"material_id": material_id}]}
            )
            # Non-content tombstone rejects a delayed publisher after deletion,
            # including after restart. New uploads always have a new material id.
            marker = hashlib.sha256(
                (course_id + material_id + ":manifest").encode()
            ).hexdigest()
            col.upsert(
                ids=[marker],
                documents=["deleted"],
                embeddings=[[0.0] * self.c.embedder.dimension],
                metadatas=[
                    {
                        "course_id": course_id,
                        "material_id": material_id,
                        "marker": True,
                        "version": "deleted",
                        "deleted": True,
                    }
                ],
            )
        return {"deleted": True}

    def search(self, body: Search):
        with self.lock:
            col = self.collection()
            allowed = {m.id: m for m in body.materials}
            if body.strategy == "single":
                allowed = {
                    k: v for k, v in allowed.items() if k == body.active_material_id
                }
            if not allowed:
                return {"evidence": [], "associations": [], "conflicts": []}
            where = {
                "$and": [
                    {"course_id": body.course_id},
                    {"material_id": {"$in": list(allowed)}},
                    {"marker": False},
                ]
            }
            contextual = bool(
                re.search(
                    r"\b(burada|buray\w*|bura\w*|az önce|şu an|bu bölüm\w*|bu sayfa\w*|bu slayt\w*|this section|this page|this step|just now)\b",
                    fold(body.question),
                )
            )
            # Typed viewport is independent of lexical matches or a nonempty text chunk.
            # Generic reference stems cover spatial/temporal pointers, not test questions.
            reference_words = fold(body.question).split()
            pointed = any(
                w.startswith(
                    (
                        "altt",
                        "üst",
                        "yukar",
                        "aşağ",
                        "burad",
                        "buray",
                        "buras",
                        "şurad",
                        "şuray",
                        "bunu",
                        "şunu",
                        "bölüm",
                        "sayfa",
                        "slayt",
                        "seçil",
                        "seçt",
                        "here",
                        "above",
                        "below",
                        "selected",
                        "göster",
                        "işaret",
                        "izledi",
                        "şekil",
                        "grafik",
                        "diyagram",
                        "formül",
                    )
                )
                for w in reference_words
            )
            contextual = body.reference_mode == "viewport" or (
                body.reference_mode != "conversation"
                and (contextual or pointed or bool(body.selected_text))
            )
            excluded = []

            def trusted(items):
                return [
                    e
                    for e in items
                    if (
                        body.eligible_source_ids is None
                        or e.get("id") in body.eligible_source_ids
                    )
                    and e.get("material_id") in allowed
                    and e.get("version") == allowed[e["material_id"]].version
                    and e.get("kind") == allowed[e["material_id"]].kind
                    and re.fullmatch(r"[a-f0-9]{64}", e.get("id", ""))
                ]

            contexts = trusted(body.context_evidence) if contextual else []
            explicit = trusted(body.explicit_evidence)
            if contextual and not contexts and body.active_source_id:
                found = col.get(ids=[body.active_source_id], where=where)
                for sid, text, meta in zip(
                    found["ids"], found["documents"], found["metadatas"]
                ):
                    if (
                        meta["material_id"] == body.active_material_id
                        and meta["version"] == allowed[meta["material_id"]].version
                    ):
                        contexts.append(
                            {
                                "id": sid,
                                "material_id": meta["material_id"],
                                "kind": meta["kind"],
                                "version": meta["version"],
                                "title": meta["title"],
                                "text": text,
                                "location": json.loads(meta["location"]),
                                "rank_score": 10.0,
                                "similarity": None,
                            }
                        )
            if (
                contextual
                and not contexts
                and body.active_material_id in allowed
                and body.current_time_ms is not None
            ):
                loc = col.get(
                    where={
                        "$and": [
                            *where["$and"],
                            {"material_id": body.active_material_id},
                        ]
                    },
                    limit=5000,
                )
                for sid, text, meta in zip(
                    loc["ids"], loc["documents"], loc["metadatas"]
                ):
                    location = json.loads(meta["location"])
                    if meta["version"] == allowed[
                        meta["material_id"]
                    ].version and location.get(
                        "start_ms", -1
                    ) <= body.current_time_ms < location.get(
                        "end_ms", -1
                    ):
                        contexts.append(
                            {
                                "id": sid,
                                "material_id": meta["material_id"],
                                "kind": meta["kind"],
                                "version": meta["version"],
                                "title": meta["title"],
                                "text": text,
                                "location": location,
                                "rank_score": 10.0,
                                "similarity": None,
                            }
                        )
            if contextual and not contexts:
                return {
                    "evidence": [],
                    "associations": [],
                    "conflicts": [],
                    "clarification": "Hangi sayfa, slayt veya video anını kastediyorsun? İlgili kaynağı açıp bölümü seçebilir misin?",
                    "debug": {
                        "context_state": "MISSING_VIEWPORT",
                        "candidates": [],
                        "excluded": [],
                    },
                }
            query = body.question + (
                "\n" + contexts[0]["text"][:1200] if contexts else ""
            )
            count = col.count()
            query_vector = self.c.embedder.embed_query(query)
            if body.eligible_source_ids is not None:
                if not body.eligible_source_ids:
                    return {
                        "evidence": [],
                        "associations": [],
                        "conflicts": [],
                        "debug": {"excluded": [{"reason": "NO_FULLY_WATCHED_SOURCE"}]},
                    }
                rows = col.get(
                    ids=body.eligible_source_ids,
                    where=where,
                    include=["documents", "metadatas", "embeddings"],
                )
                raw = {
                    "ids": [rows["ids"]],
                    "documents": [rows["documents"]],
                    "metadatas": [rows["metadatas"]],
                    "distances": [
                        [
                            1
                            - sum(float(a) * float(b) for a, b in zip(query_vector, v))
                            for v in rows["embeddings"]
                        ]
                    ],
                }
            else:
                raw = col.query(
                    query_embeddings=[query_vector],
                    n_results=min(60, max(1, count)),
                    where=where,
                    include=["documents", "metadatas", "distances"],
                )
            pool = {}
            terms = topics(query)
            anchors = technical_terms(body.question)

            def add(ids, docs, metas, distances=None):
                for n, (sid, text, meta) in enumerate(zip(ids, docs, metas)):
                    if (
                        body.eligible_source_ids is not None
                        and sid not in body.eligible_source_ids
                    ):
                        continue
                    mat = allowed.get(meta["material_id"])
                    if (
                        not mat
                        or meta["version"] != mat.version
                        or meta["course_id"] != body.course_id
                    ):
                        continue
                    matches = terms & topics(text)
                    score = 1 - distances[n] if distances else 0.0
                    if anchors and not (anchors & topics(text)):
                        excluded.append({"id": sid, "material_id": mat.id,
                                         "reason": "MISSING_EXPLICIT_TERM"})
                        continue
                    # Dense cosine is not calibrated truth/relevance. Require
                    # an actual topic anchor; semantic-only matches abstain.
                    if not matches:
                        excluded.append(
                            {
                                "id": sid,
                                "material_id": mat.id,
                                "reason": "NO_TOPIC_ANCHOR",
                            }
                        )
                        continue
                    if sid in pool and distances is None:
                        continue
                    pool[sid] = {
                        "id": sid,
                        "material_id": mat.id,
                        "kind": mat.kind,
                        "version": mat.version,
                        "title": mat.title,
                        "text": text,
                        "location": json.loads(meta["location"]),
                        "similarity": score,
                        "rank_score": len(matches) / max(1, len(terms))
                        + max(0.0, score) * 0.25,
                    }

            add(
                raw["ids"][0],
                raw["documents"][0],
                raw["metadatas"][0],
                raw["distances"][0],
            )
            # Indexed lexical channel, bounded records; no full-file extraction at query time.
            lexical_terms = list(dict.fromkeys([
                *sorted(anchors), *(t.upper() for t in sorted(anchors)),
                *content_tokens(query)[:4],
            ]))
            for term in lexical_terms[:12]:
                if len(term) < 3:
                    continue
                lex = col.get(
                    where=where, where_document={"$contains": term[:7]}, limit=24
                )
                add(lex["ids"], lex["documents"], lex["metadatas"])
            if body.strategy == "aligned":
                # Small, auditable cross-material corroboration signal. Shared
                # vocabulary is still an estimate, not a factual entailment score.
                for a in pool.values():
                    shared = set()
                    for b in pool.values():
                        common = topics(a["text"]) & topics(b["text"])
                        if (
                            a["material_id"] != b["material_id"]
                            and len(common) >= 2
                            and common & terms
                        ):
                            shared.add(b["material_id"])
                    a["rank_score"] += min(len(shared), 3) * 0.03
            # Açık olan materyal, soruda "burada" gibi bir işaret olmasa da önceliklidir:
            # öğrenci o belgeyi okurken soru sorar. Diğer materyaller elenmez, yalnızca geride kalır.
            if body.active_material_id and not contextual:
                active_page = None
                if body.active_source_id:
                    try:
                        found = col.get(ids=[body.active_source_id], where=where)
                        if found["metadatas"]:
                            active_page = json.loads(found["metadatas"][0]["location"]).get("page")
                    except Exception:  # boost is best-effort; ranking still works without it
                        active_page = None
                for e in pool.values():
                    if e["material_id"] == body.active_material_id:
                        e["rank_score"] += ACTIVE_MATERIAL_BOOST
                        page = e["location"].get("page")
                        if active_page is not None and page is not None:
                            gap = abs(page - active_page)
                            if gap <= 1:
                                e["rank_score"] += ACTIVE_PAGE_BOOST if gap == 0 else ACTIVE_PAGE_BOOST / 2
            ranked = sorted(pool.values(), key=lambda e: e["rank_score"], reverse=True)
            if contextual:
                ranked = contexts + [
                    e for e in ranked if e["id"] not in {c["id"] for c in contexts}
                ]
            ranked = explicit + [
                e for e in ranked if e["id"] not in {x["id"] for x in explicit}
            ]
            deduplicated = []
            for item in ranked:
                duplicate = next(
                    (p for p in deduplicated if duplicate_evidence(p, item)), None
                )
                if duplicate and item["id"] not in {e["id"] for e in explicit}:
                    excluded.append(
                        {
                            "id": item["id"],
                            "material_id": item["material_id"],
                            "reason": "DUPLICATE_TEXT",
                        }
                    )
                    continue
                deduplicated.append(item)
            ranked = deduplicated
            # Çok düşük skorlu kaynaklar gösterilmez: en iyi doğal sonucun yarısından azını alan
            # (ör. soruyla ilgisiz başka bir bölümün sayfası) listeye girmez. Açık bağlam ve
            # kullanıcının seçtiği kaynaklar korunur.
            protected = {e["id"] for e in explicit} | {e["id"] for e in contexts}
            organic = [e["rank_score"] for e in ranked if e["id"] not in protected]
            if organic:
                floor = max(organic) * LOW_SCORE_RATIO
                for e in ranked:
                    if e["id"] not in protected and e["rank_score"] < floor:
                        excluded.append({"id": e["id"], "material_id": e["material_id"], "reason": "LOW_SCORE"})
                ranked = [e for e in ranked if e["id"] in protected or e["rank_score"] >= floor]
            selected, seen = list(explicit), {e["material_id"] for e in explicit}
            # Preserve relevant material diversity; do not force unrelated sources.
            for item in ranked:
                if len(selected) >= max(4, len(explicit)):
                    break
                if item["material_id"] not in seen:
                    selected.append(item)
                    seen.add(item["material_id"])
                    if len(selected) == 4:
                        break
            selected += [
                e for e in ranked if e["id"] not in {s["id"] for s in selected}
            ][: max(0, max(6, len(explicit)) - len(selected))]
            associations = []
            if body.strategy == "aligned":
                for i, a in enumerate(selected):
                    for b in selected[i + 1 :]:
                        common = topics(a["text"]) & topics(b["text"])
                        if a["material_id"] != b["material_id"] and len(common) >= 2:
                            associations.append(
                                {
                                    "kind": "RELATED_TOPIC",
                                    "source_ids": [a["id"], b["id"]],
                                    "terms": sorted(common)[:6],
                                    "estimated": True,
                                }
                            )
            selected_ids = {e["id"] for e in selected}
            excluded += [
                {
                    "id": e["id"],
                    "material_id": e["material_id"],
                    "reason": "EVIDENCE_BUDGET",
                }
                for e in ranked
                if e["id"] not in selected_ids
            ]
            return {
                "evidence": selected,
                "associations": associations[:10],
                "conflicts": suspected_conflicts(selected),
                "debug": {
                    "query": body.question,
                    "context_state": "VIEWPORT" if contexts else "COURSE",
                    "context_source_ids": [e["id"] for e in contexts],
                    "candidate_ids": [e["id"] for e in ranked],
                    "selected_ids": list(selected_ids),
                    "excluded": excluded[:80],
                },
            }


def install(app, components, auth):
    index = UnifiedIndex(components)
    app.state.unified = index
    router = APIRouter(prefix="/api/v1/knowledge", dependencies=[Depends(auth)])
    router.add_api_route("/state", index.state, methods=["POST"])
    router.add_api_route("/index", index.upsert, methods=["POST"])
    router.add_api_route("/search", index.search, methods=["POST"])

    @router.post("/extract")
    def extract(body: Extract):
        try:
            return {
                "segments": extract_file(
                    body.kind, base64.b64decode(body.content, validate=True)
                ),
                "visual_extraction": False,
                "version": "typed-text-v1",
            }
        except (
            ValueError,
            zipfile.BadZipFile,
            KeyError,
            ET.ParseError,
            UnicodeError,
        ) as exc:
            raise HTTPException(
                422, "Invalid or unsupported material structure"
            ) from exc

    @router.delete("/{course_id}/{material_id}")
    def delete(course_id: str, material_id: str):
        return index.delete(course_id, material_id)

    @router.post("/explain")
    def explain(body: Explain):
        from knot_rag.explanations import explain as generate_explanation

        return generate_explanation(body)

    @router.post("/exam-text")
    def exam_text(body: ExamFile):
        from knot_rag.exam_text import extract_exam_text

        try:
            raw = base64.b64decode(body.content, validate=True)
            return {"text": extract_exam_text(body.kind, raw)}
        except (ValueError, zipfile.BadZipFile, KeyError, ET.ParseError, UnicodeError) as exc:
            raise HTTPException(422, "Exam file could not be read") from exc
        except Exception as exc:  # pypdf raises its own error types for damaged PDFs
            if type(exc).__module__.startswith("pypdf"):
                raise HTTPException(422, "Exam file could not be read") from exc
            raise

    @router.post("/summary")
    def summary(body: Summary):
        from knot_rag.summary import summarize

        return summarize(body)

    @router.post("/quiz")
    def quiz(body: dict = Body(...)):
        # Two request shapes share this internal route. A body with "items" is the v2 engine
        # (quiz_engine.py); the original single-question body is the legacy engine (quiz_quality.py),
        # kept unchanged. QUIZ_ENGINE=legacy turns v2 requests away so only the old engine runs.
        from pydantic import ValidationError
        from fastapi.exceptions import RequestValidationError
        from knot_rag.quiz_engine import QuizRequest, engine_setting, quiz_v2

        try:
            if "items" in body:
                if engine_setting() == "legacy":
                    raise HTTPException(409, {"code": "QUIZ_ENGINE_DISABLED",
                                              "message": "QUIZ_ENGINE=legacy: the v2 quiz engine is turned off"})
                request = QuizRequest.model_validate(body)
            else:
                draft = QuizDraft.model_validate(body)
        except ValidationError as exc:
            raise RequestValidationError(exc.errors(include_url=False)) from exc
        if "items" in body:
            return quiz_v2(request)
        from knot_rag.quiz_quality import quiz as quality_quiz

        return quality_quiz(draft)

    app.include_router(router)
    from knot_rag.visuals import install as install_visuals

    install_visuals(app, auth)
