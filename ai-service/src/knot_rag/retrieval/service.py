"""Scoped retrieval: validate scope → prepare query → embed → filtered search →
defence-in-depth scope re-check → optional score floor."""

from __future__ import annotations

from dataclasses import dataclass, field

from knot_rag.config import RetrievalSettings
from knot_rag.errors import IndexNotReady, ScopeViolation
from knot_rag.query.processor import PreparedQuery, QueryProcessor
from knot_rag.retrieval.embedding import Embedder
from knot_rag.retrieval.index import ChunkHit, ChunkIndex, SearchScope
from knot_rag.schemas.retrieval import AuthorizedScope, RetrievalParams


@dataclass
class RetrievalResult:
    query: PreparedQuery
    hits: list[ChunkHit]
    top_k: int
    rejected_out_of_scope: int = 0
    below_min_score: int = 0
    candidates: int = 0
    embedding_model: str | None = None
    notes: list[str] = field(default_factory=list)


class RetrievalService:
    """Reusable by WBS-6 (question generation) and WBS-7 (answer evaluation) as well as by
    the answer pipeline. Holds no per-request state, so one instance serves all requests."""

    def __init__(
        self,
        index: ChunkIndex,
        embedder: Embedder,
        settings: RetrievalSettings,
        query_processor: QueryProcessor | None = None,
    ):
        self._index = index
        self._embedder = embedder
        self._settings = settings
        self._qp = query_processor or QueryProcessor()

    def retrieve(self, question: str, scope: AuthorizedScope, params: RetrievalParams | None = None) -> RetrievalResult:
        params = params or RetrievalParams()
        prepared = self._qp.prepare(question)
        search_scope = SearchScope(course_id=scope.course_id, document_ids=tuple(scope.document_ids))
        top_k = params.top_k or self._settings.top_k
        min_score = params.min_score if params.min_score is not None else self._settings.min_score

        if self._index.count_in_scope(search_scope) == 0:
            if self._index.documents_indexed_elsewhere(search_scope):
                raise ScopeViolation(
                    "The authorized documents do not belong to the requested course.",
                    details={"course_id": scope.course_id},
                )
            raise IndexNotReady(
                "None of the authorized documents has indexed content yet.",
                details={"course_id": scope.course_id, "document_count": len(scope.document_ids)},
            )

        embedding = self._embedder.embed_query(prepared.retrieval_query)
        raw = self._index.search(embedding, search_scope, top_k)

        in_scope = [h for h in raw if search_scope.contains(h.chunk)]
        rejected = len(raw) - len(in_scope)
        kept = in_scope
        below = 0
        if min_score is not None:
            kept = [h for h in in_scope if h.score is None or h.score >= min_score]
            below = len(in_scope) - len(kept)

        return RetrievalResult(
            query=prepared,
            hits=kept,
            top_k=top_k,
            rejected_out_of_scope=rejected,
            below_min_score=below,
            candidates=len(raw),
            embedding_model=self._embedder.model_id,
        )
