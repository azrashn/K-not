"""Vector index port. Retrieval code depends on this protocol, not on ChromaDB."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from knot_rag.schemas.documents import IndexedChunk


@dataclass(frozen=True)
class SearchScope:
    """Mandatory filter for every index read. There is intentionally no unscoped search."""

    course_id: str
    document_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.course_id or not self.document_ids:
            raise ValueError("SearchScope requires a course_id and at least one document_id")

    def contains(self, chunk: IndexedChunk) -> bool:
        return chunk.document.course_id == self.course_id and chunk.document.document_id in self.document_ids


@dataclass(frozen=True)
class ChunkHit:
    chunk: IndexedChunk
    score: float | None  # Higher is more similar. Not a probability.
    rank: int


@dataclass(frozen=True)
class IndexInfo:
    collection: str
    embedding_model: str | None
    embedding_dim: int | None
    chunk_count: int


class ChunkIndex(Protocol):
    def info(self) -> IndexInfo: ...

    def count_in_scope(self, scope: SearchScope) -> int: ...

    def documents_indexed_elsewhere(self, scope: SearchScope) -> bool:
        """True if any scope document id is indexed under a *different* course. Returns no
        content; used only to tell a scope mismatch apart from "not indexed yet"."""
        ...

    def search(self, query_embedding: list[float], scope: SearchScope, k: int) -> list[ChunkHit]: ...

    def get_chunks(self, chunk_ids: list[str], scope: SearchScope) -> list[IndexedChunk]: ...
