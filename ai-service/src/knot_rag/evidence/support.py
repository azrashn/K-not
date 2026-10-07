"""Evidence-support assessment with explicit, inspectable criteria.

`HeuristicSupportAssessor` (method `citation-lexical-v1`) decides per claim:

  UNSUPPORTED          no citation resolves to retrieved evidence, OR
                       lexical coverage < coverage_partial and the quote was not verified.
  SUPPORTED            all of: ≥1 valid citation; the model's quote occurs verbatim in a cited
                       chunk; lexical coverage ≥ coverage_supported; every number in the claim
                       appears in the cited evidence; the model did not mark it partial;
                       no fabricated evidence id was attached to the claim.
  PARTIALLY_SUPPORTED  anything in between.

Lexical coverage = share of the claim's content tokens that also occur (5-char prefix match,
a crude Turkish stemming) in the cited evidence. This is a *proxy*: it can be fooled by
negation or reordering. Hence `semantically_verified=False` on every result until an NLI or
LLM-judge assessor is plugged in through the `SupportAssessor` protocol (WBS-8 hook).
Thresholds are configuration, not calibrated constants; calibrate on the evaluation set.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from knot_rag.config import SupportSettings
from knot_rag.evidence.mapper import MappedClaim
from knot_rag.schemas.answer import SupportAssessment
from knot_rag.schemas.common import SupportStatus
from knot_rag.text import content_tokens, numbers

METHOD = "citation-lexical-v1"
_PREFIX = 5


@dataclass(frozen=True)
class SupportDecision:
    status: SupportStatus
    explanation: str | None
    assessment: SupportAssessment


class SupportAssessor(Protocol):
    def assess(self, claim: MappedClaim) -> SupportDecision: ...


def _stem(t: str) -> str:
    return t[:_PREFIX]


def lexical_coverage(claim_text: str, evidence_texts: list[str]) -> float:
    claim = set(content_tokens(claim_text))
    if not claim:
        return 0.0
    ev_tokens = set()
    for t in evidence_texts:
        ev_tokens.update(content_tokens(t))
    ev_stems = {_stem(t) for t in ev_tokens}
    hit = sum(1 for t in claim if t in ev_tokens or _stem(t) in ev_stems)
    return round(hit / len(claim), 4)


class HeuristicSupportAssessor:
    def __init__(self, settings: SupportSettings):
        self._s = settings

    def assess(self, claim: MappedClaim) -> SupportDecision:
        texts = [e.text for e in claim.cited_evidence]
        valid = bool(claim.cited_evidence)
        coverage = lexical_coverage(claim.text, texts) if valid else 0.0
        claim_numbers = numbers(claim.text)
        ev_numbers = set().union(*(numbers(t) for t in texts)) if texts else set()
        numbers_ok = claim_numbers <= ev_numbers
        quote_ok = claim.quote_verified

        assessment = SupportAssessment(
            method=METHOD,
            citations_valid=valid and not claim.had_unknown_ids,
            quote_verified=quote_ok,
            lexical_coverage=coverage,
            numbers_consistent=numbers_ok,
            model_marked_partial=claim.model_marked_partial,
            semantically_verified=False,
        )

        if not valid:
            reason = (
                "İddia, getirilen kaynaklarda olmayan bir kanıta atıf yaptı."
                if claim.had_unknown_ids else "İddia herhangi bir kaynağa bağlanmadı."
            )
            return SupportDecision(SupportStatus.UNSUPPORTED, reason, assessment)

        if coverage < self._s.coverage_partial and not quote_ok:
            return SupportDecision(
                SupportStatus.UNSUPPORTED,
                "Atıf yapılan kaynak bu iddianın içeriğini yeterince içermiyor.",
                assessment,
            )

        if (
            quote_ok and numbers_ok and not claim.model_marked_partial and not claim.had_unknown_ids
            and coverage >= self._s.coverage_supported
        ):
            return SupportDecision(SupportStatus.SUPPORTED, None, assessment)

        reasons = []
        if not quote_ok:
            reasons.append("alıntı kaynakta birebir bulunamadı" if claim.quote_given else "kaynaktan alıntı verilmedi")
        if not numbers_ok:
            reasons.append("iddiadaki sayısal değerler kaynakta geçmiyor")
        if claim.model_marked_partial:
            reasons.append("kaynak iddianın yalnızca bir kısmını destekliyor")
        if claim.had_unknown_ids:
            reasons.append("bazı atıflar getirilen kaynaklarda yok")
        if coverage < self._s.coverage_supported:
            reasons.append("iddianın bir kısmı kaynakta geçmiyor")
        return SupportDecision(
            SupportStatus.PARTIALLY_SUPPORTED,
            "Kısmen destekleniyor: " + "; ".join(reasons) + ".",
            assessment,
        )


def aggregate_status(statuses: list[SupportStatus]) -> SupportStatus:
    """Answer-level state, mirroring the frontend's KnotStrength rule: all supported → SIKI;
    none supported (or no claims) → KOPUK; otherwise GEVEŞEK."""
    if not statuses or all(s == SupportStatus.UNSUPPORTED for s in statuses):
        return SupportStatus.UNSUPPORTED
    if all(s == SupportStatus.SUPPORTED for s in statuses):
        return SupportStatus.SUPPORTED
    return SupportStatus.PARTIALLY_SUPPORTED
