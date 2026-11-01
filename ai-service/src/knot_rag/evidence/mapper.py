"""Citation integrity: every citation must resolve to evidence that was actually shown to the
model. This step answers "does the reference exist and does the quote occur there?" —
NOT "does the evidence semantically support the claim?" (see `support.py`)."""

from __future__ import annotations

from dataclasses import dataclass, field

from knot_rag.generation.generator import ModelAnswer
from knot_rag.schemas.answer import Citation, CitationIssue, CitationIssueType
from knot_rag.schemas.retrieval import HighlightSpan, RetrievedEvidence
from knot_rag.text import find_folded


@dataclass
class MappedClaim:
    claim_id: str
    text: str
    citations: list[Citation]
    cited_evidence: list[RetrievedEvidence]
    model_marked_partial: bool
    had_unknown_ids: bool
    quote_given: bool
    issues: list[CitationIssue] = field(default_factory=list)

    @property
    def quote_verified(self) -> bool:
        return any(c.quote_verified for c in self.citations)


class EvidenceMapper:
    def map(self, answer: ModelAnswer, evidence: list[RetrievedEvidence]) -> list[MappedClaim]:
        by_id = {e.evidence_id: e for e in evidence}
        mapped: list[MappedClaim] = []
        for i, mc in enumerate(answer.claims, start=1):
            claim_id = f"c{i}"
            issues: list[CitationIssue] = []
            cited: list[RetrievedEvidence] = []
            for eid in dict.fromkeys(x.strip() for x in mc.evidence_ids):
                ev = by_id.get(eid)
                if ev is None:
                    issues.append(CitationIssue(claim_id=claim_id, evidence_id=eid, issue=CitationIssueType.UNKNOWN_EVIDENCE_ID))
                else:
                    cited.append(ev)

            quote = (mc.quote or "").strip() or None
            citations: list[Citation] = []
            quote_found_anywhere = False
            for ev in cited:
                span = find_folded(ev.text, quote) if quote else None
                highlight = None
                if span is not None:
                    quote_found_anywhere = True
                    doc_start = doc_end = None
                    # Document offsets only when the chunk text is the untruncated document slice.
                    if ev.location.char_start is not None and not ev.truncated:
                        doc_start, doc_end = ev.location.char_start + span[0], ev.location.char_start + span[1]
                    highlight = HighlightSpan(
                        chunk_char_start=span[0], chunk_char_end=span[1],
                        document_char_start=doc_start, document_char_end=doc_end,
                    )
                citations.append(
                    Citation(
                        evidence_id=ev.evidence_id,
                        chunk_id=ev.chunk_id,
                        document_id=ev.document_id,
                        document_title=ev.document_title,
                        location=ev.location,
                        label=ev.label,
                        quote=quote,
                        quote_verified=span is not None,
                        highlight=highlight,
                    )
                )
            if quote and cited and not quote_found_anywhere:
                issues.append(CitationIssue(claim_id=claim_id, evidence_id=cited[0].evidence_id, issue=CitationIssueType.QUOTE_NOT_FOUND))

            mapped.append(
                MappedClaim(
                    claim_id=claim_id,
                    text=mc.text.strip(),
                    citations=citations,
                    cited_evidence=cited,
                    model_marked_partial=mc.support == "partial",
                    had_unknown_ids=any(x.issue == CitationIssueType.UNKNOWN_EVIDENCE_ID for x in issues),
                    quote_given=quote is not None,
                    issues=issues,
                )
            )
        return mapped
