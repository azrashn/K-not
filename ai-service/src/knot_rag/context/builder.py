"""Deterministic evidence selection and context rendering.

Selection order: score desc (None last) → original rank → chunk_id. Then:
  1. drop exact chunk_id duplicates;
  2. drop text duplicates (folded text equal, or contained in an already selected chunk);
  3. cap chunks per document (keeps one long document from crowding out others);
  4. greedy token budget; an over-budget *first* item is truncated rather than dropped so
     a relevant but long chunk never yields an empty context.
Evidence ids (E1, E2, …) are assigned in final order and are local to one response.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from knot_rag.config import RetrievalSettings
from knot_rag.retrieval.index import ChunkHit
from knot_rag.schemas.documents import IndexedChunk
from knot_rag.schemas.retrieval import RetrievalParams, RetrievedEvidence
from knot_rag.text import estimate_tokens, fold

_DELIM = re.compile(r"<(\s*/?\s*evidence)", re.IGNORECASE)
_HEADER_TOKENS = 40  # Allowance for the <evidence ...> wrapper of each item.


def citation_label(chunk: IndexedChunk) -> str:
    page = chunk.location.page_label()
    base = chunk.document.document_type.short_label
    return f"{base} · {page}" if page else base


def _sort_key(h: ChunkHit):
    return (h.score is None, -(h.score or 0.0), h.rank, h.chunk.chunk_id)


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    space = cut.rfind(" ")
    if space > max_chars * 0.6:
        cut = cut[:space]
    return cut.rstrip() + " …"


@dataclass
class BuiltContext:
    evidence: list[RetrievedEvidence]
    duplicates_removed: int
    dropped_by_limits: int
    tokens_estimate: int


class ContextBuilder:
    def __init__(self, settings: RetrievalSettings):
        self._s = settings

    def build(self, hits: list[ChunkHit], params: RetrievalParams | None = None) -> BuiltContext:
        params = params or RetrievalParams()
        max_evidence = params.max_evidence or self._s.max_evidence
        budget = params.max_context_tokens or self._s.max_context_tokens
        cpt = self._s.chars_per_token

        seen_ids: set[str] = set()
        selected_texts: list[str] = []
        per_doc: dict[str, int] = {}
        dupes = dropped = used = 0
        out: list[RetrievedEvidence] = []

        for hit in sorted(hits, key=_sort_key):
            c = hit.chunk
            if c.chunk_id in seen_ids:
                dupes += 1
                continue
            folded = fold(c.text)
            if any(folded == t or folded in t for t in selected_texts):
                dupes += 1
                seen_ids.add(c.chunk_id)
                continue
            if len(out) >= max_evidence:
                dropped += 1
                continue
            if per_doc.get(c.document.document_id, 0) >= self._s.max_chunks_per_document:
                dropped += 1
                continue

            text, truncated = c.text, False
            cost = estimate_tokens(text, cpt) + _HEADER_TOKENS
            if used + cost > budget:
                if out:
                    dropped += 1
                    continue
                allowed_chars = int(max(0, budget - _HEADER_TOKENS) * cpt)
                if allowed_chars < 40:
                    dropped += 1
                    continue
                text, truncated = _truncate(text, allowed_chars), True
                cost = estimate_tokens(text, cpt) + _HEADER_TOKENS

            seen_ids.add(c.chunk_id)
            selected_texts.append(folded)
            per_doc[c.document.document_id] = per_doc.get(c.document.document_id, 0) + 1
            used += cost
            out.append(
                RetrievedEvidence(
                    evidence_id=f"E{len(out) + 1}",
                    chunk_id=c.chunk_id,
                    document_id=c.document.document_id,
                    course_id=c.document.course_id,
                    document_title=c.document.title,
                    document_type=c.document.document_type,
                    indexing_version=c.document.indexing_version,
                    location=c.location,
                    label=citation_label(c),
                    text=text,
                    score=hit.score,
                    rank=hit.rank,
                    truncated=truncated,
                )
            )
        return BuiltContext(evidence=out, duplicates_removed=dupes, dropped_by_limits=dropped, tokens_estimate=used)


def _attr(value: str) -> str:
    return value.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", " ")


def render_evidence_context(evidence: list[RetrievedEvidence]) -> str:
    """Render evidence as clearly delimited, untrusted data blocks. Any `<evidence` /
    `</evidence` inside source text is escaped so a document cannot close its own block
    and inject text that looks like trusted instructions."""
    blocks = []
    for e in evidence:
        pages = e.location.page_label() or "bilinmiyor"
        body = _DELIM.sub(r"&lt;\1", e.text)
        blocks.append(
            f'<evidence id="{e.evidence_id}" document="{_attr(e.document_title)}" '
            f'type="{e.document_type.value}" pages="{_attr(pages)}">\n{body}\n</evidence>'
        )
    return "\n\n".join(blocks)
