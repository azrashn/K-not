"""Scoped retrieval: validate scope → prepare query → embed → filtered dense search, plus an
optional lexical channel (exact question terms, IDF-weighted) fused by reciprocal rank fusion
→ defence-in-depth scope re-check → optional score floor.

Why the lexical channel: with intfloat/multilingual-e5-small the only chunk containing
"git status" ranked 10th–16th of 45 for "Git status nedir ne işe yarar?", "What does git status
do?" and "git status" (top_k = 8), below slide titles. Dense similarity alone does not weight a
rare, exact term. Both channels use the same scope filter; `score` stays the dense cosine
similarity (computed for lexical-only hits) so the score floor keeps its meaning.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from knot_rag.config import RetrievalSettings
from knot_rag.errors import IndexNotReady, ScopeViolation
from knot_rag.query.processor import PreparedQuery, QueryProcessor
from knot_rag.retrieval.embedding import Embedder
from knot_rag.retrieval.index import ChunkHit, ChunkIndex, KeywordHit, SearchScope
from knot_rag.schemas.retrieval import AuthorizedScope, RetrievalParams
from knot_rag.text import question_key_terms, stem, stem_in, stem_set

RRF_K = 60  # standard reciprocal-rank-fusion constant
LEXICAL_RESERVED = 2  # the best exact-term matches always make the cut (plain RRF can drop them)
MAX_LEXICAL_TERMS = 8
NEEDLE_CHARS = 6  # substring used to fetch candidates (prefix covers Turkish suffixes); verified by stem


def _cosine(a: list[float], b: list[float] | None) -> float | None:
    if b is None or len(a) != len(b):
        return None
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return round(sum(x * y for x, y in zip(a, b)) / (na * nb), 6) if na and nb else None


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
    lexical_candidates: int = 0


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
        lexical, lex_rejected = self._lexical(prepared.normalized, search_scope)
        fused = self._fuse(raw, lexical[:top_k], embedding, top_k) if lexical else raw

        in_scope = [h for h in fused if search_scope.contains(h.chunk)]
        rejected = sum(1 for h in raw if not search_scope.contains(h.chunk)) + lex_rejected
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
            lexical_candidates=len(lexical),
        )

    def _lexical(self, question: str, scope: SearchScope) -> tuple[list[KeywordHit], int]:
        """Chunks containing question key terms, ranked by the summed IDF of the terms they
        contain (IDF from the candidate counts). Returns (ranked hits, out-of-scope rejects)."""
        if not self._settings.lexical_channel or not hasattr(self._index, "keyword_search"):
            return [], 0
        terms = question_key_terms(question)[:MAX_LEXICAL_TERMS]
        pool: dict[str, KeywordHit] = {}
        stems_of: dict[str, set[str]] = {}
        df: dict[str, int] = {}
        rejected = 0
        for raw, tok in terms:
            needle = raw.strip()[:NEEDLE_CHARS]
            if len(needle) < 2:
                continue
            st = stem(tok)
            matched = 0
            for h in self._index.keyword_search(needle, scope, self._settings.lexical_pool):
                if not scope.contains(h.chunk):
                    rejected += 1
                    continue
                cid = h.chunk.chunk_id
                if cid not in stems_of:
                    stems_of[cid] = stem_set(f"{h.chunk.location.section_title or ''} {h.chunk.text}")
                if stem_in(st, stems_of[cid]):  # substring candidate → verified term match
                    matched += 1
                    pool.setdefault(cid, h)
            if matched:
                df[st] = matched
        if not pool:
            return [], rejected
        n = max(max(df.values()), len(pool))
        idf = {st: math.log(1 + n / d) for st, d in df.items()}
        scored = [(sum(w for st, w in idf.items() if stem_in(st, stems_of[cid])), cid, h) for cid, h in pool.items()]
        scored.sort(key=lambda x: (-x[0], x[1]))
        return [h for s, _, h in scored if s > 0], rejected

    @staticmethod
    def _fuse(dense: list[ChunkHit], lexical: list[KeywordHit], embedding: list[float], top_k: int) -> list[ChunkHit]:
        fused: dict[str, list] = {}
        for r, h in enumerate(dense, start=1):
            fused[h.chunk.chunk_id] = [h.chunk, h.score, 1.0 / (RRF_K + r)]
        for r, h in enumerate(lexical, start=1):
            cid = h.chunk.chunk_id
            if cid in fused:
                fused[cid][2] += 1.0 / (RRF_K + r)
            else:
                fused[cid] = [h.chunk, _cosine(embedding, h.embedding), 1.0 / (RRF_K + r)]
        ranked = sorted(fused.items(), key=lambda kv: (-kv[1][2], -(kv[1][1] or 0.0), kv[0]))
        order = ranked[:top_k]
        reserved = [h.chunk.chunk_id for h in lexical[:min(LEXICAL_RESERVED, top_k // 2)]]
        missing = [kv for kv in ranked[top_k:] if kv[0] in reserved]
        if missing:
            # Replace the lowest-ranked entries that are not themselves reserved.
            keep = [kv for kv in order if kv[0] in reserved]
            rest = [kv for kv in order if kv[0] not in reserved][: top_k - len(keep) - len(missing)]
            order = sorted(keep + rest + missing, key=lambda kv: (-kv[1][2], -(kv[1][1] or 0.0), kv[0]))
        return [ChunkHit(chunk=c, score=sc, rank=i, fused=round(f, 8)) for i, (_, (c, sc, f)) in enumerate(order, start=1)]
