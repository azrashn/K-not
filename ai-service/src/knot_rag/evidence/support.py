"""Evidence-support assessment with explicit, inspectable criteria.

`HeuristicSupportAssessor` (method `citation-lexical-v3`) decides per claim. Rules are applied
in order; every rule that fires is written into `support_explanation`.

  UNSUPPORTED (KOPUK)
    U1  no citation resolves to retrieved evidence, or
    U2  lexical coverage (claim terms found anywhere in the cited chunks) < coverage_partial
        and the quote was not verified.

  SUPPORTED (SIKI) requires ALL of
    S1  ≥1 valid citation and no fabricated evidence id on the claim;
    S2  the model's quote occurs verbatim in a cited chunk;
    S3  quote coverage ≥ coverage_supported — measured against the *sentence(s) around the
        verified quote*, not the whole chunk, so a claim cannot borrow words from unrelated
        sentences of a long chunk;
    S4  every number in the claim appears in the cited evidence;
    S5  negation polarity of the claim matches the quoted sentence ("kararlı" vs "kararlı değil");
    S6  the model did not mark the claim partial;
    S7  question relevance: the claim mentions ≥ question_relevance_min of the question's key
        terms AND ≥ relative_relevance_min × the best claim's relevance in the same answer.
        (v1 rated any verbatim quote SIKI, including true-but-irrelevant sentences.)
    S8  no unsupported terms: at most max_unsupported_terms (default 0) content terms of the
        claim are absent from all cited passages (incl. their titles). Added in v3 after the
        offline perturbation harness showed v2 rating SIKI for claims with one swapped entity
        ("AVL" → "kırmızı-siyah", 20/25) or an appended unsupported clause (26/50), because S3
        tolerates 40 % unmatched terms (docs/rag-evaluation.md, offline validation).
    S9  the claim is a statement: ≥ 3 content tokens and not just a document/section title.
        (Slide titles such as "Git and GitHub" were presented as answer claims.)
  S7 also requires the claim to contain at least one question key term that is less widespread
  in the retrieved passages than the question's most widespread term (`specific_terms`). For
  "Git status nedir?" over Git slides, "Git is a distributed VCS" shares only the generic "Git"
  and is a side remark, never SIKI. If a NAMED question term
  ("Dijkstra", "Python") occurs in no retrieved passage, no claim is SIKI: the question is about
  something the material does not cover. (v4 = v3 + S9 + focus + named subject.)

  PARTIALLY_SUPPORTED (GEVEŞEK)  everything else.

All of this is lexical. The result is `verification=HEURISTIC`, `semantically_verified=False`,
and `support_confirmed=False` — a heuristic SIKI means "quoted from the cited source and
on-topic by word overlap", never "semantically confirmed". `LLMJudgeSupportAssessor`
(`judge.py`) adds a real entailment verdict on top of the hard rules.
Thresholds are configuration calibrated on eval.v1 (docs/rag-evaluation.md), not constants.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from knot_rag.config import SupportSettings
from knot_rag.evidence.mapper import MappedClaim
from knot_rag.schemas.answer import SupportAssessment, VerificationLevel
from knot_rag.schemas.common import SupportStatus
from knot_rag.text import (
    content_tokens,
    fold,
    has_negation,
    is_statement,
    named_terms,
    numbers,
    question_key_terms,
    sentence_around,
    specific_question_terms,
    stem,
    stem_in,
    stem_set,
)

METHOD = "citation-lexical-v4"

_RANK = {SupportStatus.UNSUPPORTED: 0, SupportStatus.PARTIALLY_SUPPORTED: 1, SupportStatus.SUPPORTED: 2}


def weakest(*statuses: SupportStatus) -> SupportStatus:
    return min(statuses, key=_RANK.__getitem__)


@dataclass(frozen=True)
class SupportDecision:
    status: SupportStatus
    explanation: str | None
    assessment: SupportAssessment
    # True when a rule other than lexical overlap (S3) limited the status. A semantic judge may
    # upgrade overlap-only GEVEŞEK (paraphrases) but never a hard-rule cap.
    capped_by_hard_rule: bool = False
    # True when S7 (relevance) is the ONLY rule that kept this claim from SIKI. Such side
    # remarks keep their GEVEŞEK label but do not count against answer completeness.
    relevance_only_cap: bool = False


class SupportAssessor(Protocol):
    """WBS-8 extension point. Receives all claims of one answer plus the question, so
    assessors can use answer-level context (relative relevance, one batched judge call)."""

    def assess_all(self, claims: list[MappedClaim], question: str, context: list[str] | None = None) -> list[SupportDecision]: ...


def lexical_coverage(claim_text: str, evidence_texts: list[str]) -> float:
    claim = set(content_tokens(claim_text))
    if not claim:
        return 0.0
    ev_tokens: set[str] = set()
    for t in evidence_texts:
        ev_tokens.update(content_tokens(t))
    ev_stems = {stem(t) for t in ev_tokens}
    hit = sum(1 for t in claim if t in ev_tokens or stem(t) in ev_stems)
    return round(hit / len(claim), 4)


def unsupported_terms(claim_text: str, evidence) -> list[str]:
    """Claim content terms (numbers excluded: S4) whose stem occurs in none of the cited
    passages, their document titles or section titles."""
    source: set[str] = set()
    for e in evidence:
        source |= stem_set(f"{e.document_title} {e.location.section_title or ''} {e.text}")
    out: list[str] = []
    for tok in content_tokens(claim_text):
        if tok.replace(".", "").isdigit() or tok in out:
            continue
        if not stem_in(stem(tok), source):
            out.append(tok)
    return out


def specific_terms(question: str, passages: list[str]) -> tuple[bool, list[tuple[str, str]]]:
    """(constrained, [(stem, surface form)]) of the question terms a claim must contain to be
    relevant, judged over the retrieved passages (`text.specific_question_terms`)."""
    constrained, specific = specific_question_terms(question, [stem_set(p) for p in passages])
    return constrained, [(stem(tok), raw) for raw, tok in question_key_terms(question) if stem(tok) in specific]


def question_relevance(claim_text: str, question: str) -> float:
    keys = [stem(t) for _, t in question_key_terms(question)]
    if not keys:
        return 1.0  # nothing to measure against; do not penalise
    claim = stem_set(claim_text)
    return round(sum(1 for k in keys if stem_in(k, claim)) / len(keys), 4)


def quoted_sentences(claim: MappedClaim) -> list[str]:
    """Sentence(s) of the cited chunks that contain the verified quote."""
    by_id = {e.evidence_id: e for e in claim.cited_evidence}
    out = []
    for c in claim.citations:
        if c.quote_verified and c.highlight is not None:
            ev = by_id[c.evidence_id]
            out.append(sentence_around(ev.text, c.highlight.chunk_char_start, c.highlight.chunk_char_end))
    return out


class HeuristicSupportAssessor:
    def __init__(self, settings: SupportSettings):
        self._s = settings

    def assess_all(self, claims: list[MappedClaim], question: str, context: list[str] | None = None) -> list[SupportDecision]:
        """`context`: texts of all evidence shown to the model (for the focus term); defaults to
        the evidence the claims cite."""
        rels = [question_relevance(c.text, question) for c in claims]
        best = max(rels, default=0.0)
        missing_named: list[str] = []
        if context is not None:
            # Only with the full retrieved context: a named subject absent from ALL of it.
            ctx_stems = set().union(*(stem_set(t) for t in context)) if context else set()
            missing_named = [t for t in named_terms(question) if not stem_in(stem(fold(t)), ctx_stems)]
        else:
            seen: dict[str, str] = {}
            for c in claims:
                for e in c.cited_evidence:
                    seen.setdefault(e.evidence_id, e.text)
            context = list(seen.values())
        constrained, focus = specific_terms(question, context) if context else (False, [])
        return [self._assess(c, r, best, focus if constrained else None, missing_named) for c, r in zip(claims, rels)]

    def _assess(self, claim: MappedClaim, relevance: float, best_relevance: float,
                focus: list[tuple[str, str]] | None = None, missing_named: list[str] | None = None) -> SupportDecision:
        s = self._s
        texts = [e.text for e in claim.cited_evidence]
        valid = bool(claim.cited_evidence)
        coverage = lexical_coverage(claim.text, texts) if valid else 0.0
        sentences = quoted_sentences(claim)
        quote_ok = bool(sentences)
        quote_cov = lexical_coverage(claim.text, sentences) if quote_ok else 0.0
        ev_numbers = set().union(*(numbers(t) for t in texts)) if texts else set()
        numbers_ok = numbers(claim.text) <= ev_numbers
        negation_ok = (not quote_ok) or all(has_negation(claim.text) == has_negation(x) for x in sentences)
        relevant = relevance >= s.question_relevance_min and relevance >= s.relative_relevance_min * best_relevance
        claim_stems = stem_set(claim.text)
        focus_ok = focus is None or any(stem_in(st, claim_stems) for st, _ in focus)
        relevant = relevant and focus_ok and not missing_named
        novel = unsupported_terms(claim.text, claim.cited_evidence) if valid else []
        titles = [t for e in claim.cited_evidence for t in (e.document_title, e.location.section_title) if t]
        statement = is_statement(claim.text, titles)

        assessment = SupportAssessment(
            method=METHOD,
            citations_valid=valid and not claim.had_unknown_ids,
            quote_verified=quote_ok,
            lexical_coverage=coverage,
            numbers_consistent=numbers_ok,
            model_marked_partial=claim.model_marked_partial,
            semantically_verified=False,
            verification=VerificationLevel.HEURISTIC,
            quote_coverage=round(quote_cov, 4) if quote_ok else None,
            question_relevance=relevance,
            negation_consistent=negation_ok,
            addresses_question=relevant,
            unsupported_terms=novel if valid else None,
        )

        if not valid:  # U1
            reason = (
                "İddia, getirilen kaynaklarda olmayan bir kanıta atıf yaptı."
                if claim.had_unknown_ids else "İddia herhangi bir kaynağa bağlanmadı."
            )
            return SupportDecision(SupportStatus.UNSUPPORTED, reason, assessment, True)
        if coverage < s.coverage_partial and not quote_ok:  # U2
            return SupportDecision(
                SupportStatus.UNSUPPORTED, "Atıf yapılan kaynak bu iddianın içeriğini yeterince içermiyor.", assessment, True
            )

        reasons = []
        hard = (
            claim.had_unknown_ids or not quote_ok or not numbers_ok or not negation_ok
            or claim.model_marked_partial or not relevant or not statement
        )
        if claim.had_unknown_ids:  # S1
            reasons.append("bazı atıflar getirilen kaynaklarda yok")
        if not quote_ok:  # S2
            reasons.append("alıntı kaynakta birebir bulunamadı" if claim.quote_given else "kaynaktan alıntı verilmedi")
        elif quote_cov < s.coverage_supported:  # S3
            reasons.append("alıntılanan cümle iddianın tamamını içermiyor")
        if not numbers_ok:  # S4
            reasons.append("iddiadaki sayısal değerler kaynakta geçmiyor")
        if not negation_ok:  # S5
            reasons.append("iddia ile kaynak cümlesinin olumsuzluk anlamı farklı")
        if claim.model_marked_partial:  # S6
            reasons.append("kaynak iddianın yalnızca bir kısmını destekliyor")
        if not relevant:  # S7
            if missing_named:
                reasons.append("sorudaki " + ", ".join(missing_named) + " kaynaklarda geçmiyor; iddia soruyu yanıtlamıyor")
            elif focus_ok:
                reasons.append("iddia kaynakta geçiyor ancak soruyu doğrudan yanıtlamıyor")
            else:
                reasons.append("iddia sorunun yalnızca genel terimlerini içeriyor; sorulan kavramı içermiyor"
                               + (" (" + ", ".join(raw for _, raw in focus) + ")" if focus else ""))
        if not statement:  # S9
            reasons.append("iddia tam bir ifade değil (başlık ya da parça)")
        if len(novel) > s.max_unsupported_terms:  # S8 (lexical, like S3: a judge may upgrade paraphrases)
            reasons.append("iddiada kaynakta geçmeyen ifadeler var: " + ", ".join(novel[:5]))

        if not reasons:
            return SupportDecision(SupportStatus.SUPPORTED, None, assessment)
        return SupportDecision(
            SupportStatus.PARTIALLY_SUPPORTED, "Kısmen destekleniyor: " + "; ".join(reasons) + ".", assessment, hard,
            relevance_only_cap=not relevant and len(reasons) == 1,
        )


def aggregate_status(statuses: list[SupportStatus]) -> SupportStatus:
    """Answer-level state, mirroring the frontend's KnotStrength rule: all supported → SIKI;
    none supported (or no claims) → KOPUK; otherwise GEVEŞEK."""
    if not statuses or all(s == SupportStatus.UNSUPPORTED for s in statuses):
        return SupportStatus.UNSUPPORTED
    if all(s == SupportStatus.SUPPORTED for s in statuses):
        return SupportStatus.SUPPORTED
    return SupportStatus.PARTIALLY_SUPPORTED
