"""Test doubles. `InMemoryIndex` implements the `ChunkIndex` protocol without ChromaDB."""

from __future__ import annotations

import json
import math
from pathlib import Path

from knot_rag.errors import IndexNotReady
from knot_rag.retrieval.index import ChunkHit, IndexInfo, KeywordHit, SearchScope
from knot_rag.schemas.documents import IndexedChunk

FIXTURES = Path(__file__).parent / "fixtures"

COURSE = "veri-yapilari"
USER = "u-ayse"
# Documents NestJS would authorize for u-ayse in veri-yapilari (not Mehmet's private notes,
# not the suspicious shared summary unless a test adds it explicitly).
SCOPE_DOCS = ["doc-vy-hafta4", "doc-vy-notlar", "doc-vy-hafta6", "doc-vy-kitap-siralama", "doc-vy-sinav-2024"]


def load_corpus() -> list[IndexedChunk]:
    data = json.loads((FIXTURES / "corpus.json").read_text(encoding="utf-8"))
    return [IndexedChunk.model_validate(c) for c in data["chunks"]]


def scope(document_ids=None, course_id=COURSE, user_id=USER) -> dict:
    return {"user_id": user_id, "course_id": course_id, "document_ids": list(SCOPE_DOCS if document_ids is None else document_ids)}


def _cos(a, b):
    return sum(x * y for x, y in zip(a, b)) / ((math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))) or 1.0)


class InMemoryIndex:
    def __init__(self, chunks, embedder, *, leak: bool = False, fail: Exception | None = None):
        self._chunks = list(chunks)
        self._emb = embedder
        self._vecs = embedder.embed_documents([c.text for c in self._chunks]) if self._chunks else []
        self.leak = leak  # Simulate a buggy index that ignores the filter.
        self.fail = fail
        self.searches: list[tuple[SearchScope, int]] = []

    def info(self) -> IndexInfo:
        if self.fail:
            raise self.fail
        if not self._chunks:
            raise IndexNotReady()
        return IndexInfo("memory", self._emb.model_id, self._emb.dimension, len(self._chunks))

    def count_in_scope(self, scope: SearchScope) -> int:
        if self.fail:
            raise self.fail
        return sum(1 for c in self._chunks if scope.contains(c))

    def documents_indexed_elsewhere(self, scope: SearchScope) -> bool:
        return any(c.document.document_id in scope.document_ids and c.document.course_id != scope.course_id for c in self._chunks)

    def search(self, query_embedding, scope: SearchScope, k: int):
        if self.fail:
            raise self.fail
        self.searches.append((scope, k))
        pool = [(c, v) for c, v in zip(self._chunks, self._vecs) if self.leak or scope.contains(c)]
        scored = sorted(((round(_cos(query_embedding, v), 6), c) for c, v in pool), key=lambda x: (-x[0], x[1].chunk_id))
        return [ChunkHit(chunk=c, score=s, rank=i) for i, (s, c) in enumerate(scored[:k], start=1)]

    def get_chunks(self, chunk_ids, scope):
        return [c for c in self._chunks if c.chunk_id in chunk_ids and scope.contains(c)]

    def keyword_search(self, needle, scope, limit):
        # Mirrors Chroma `$contains` with case variants (lower / Capitalised / UPPER / as given).
        if self.fail:
            raise self.fail
        variants = {needle, needle.lower(), needle[:1].upper() + needle[1:].lower(), needle.upper()}
        pool = [(c, v) for c, v in zip(self._chunks, self._vecs) if self.leak or scope.contains(c)]
        hits = [KeywordHit(chunk=c, embedding=list(v)) for c, v in pool if any(x in c.text for x in variants)]
        return sorted(hits, key=lambda h: h.chunk.chunk_id)[:limit]
