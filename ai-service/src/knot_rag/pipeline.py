"""RAG pipeline orchestration.

Question → scoped retrieval → context construction → structured generation →
schema validation → citation validation → evidence-support assessment → response.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid

from knot_rag.config import SupportSettings
from knot_rag.context.builder import BuiltContext, ContextBuilder
from knot_rag.evidence.conflicts import detect_claim_conflicts, model_conflicts
from knot_rag.evidence.coverage import question_coverage
from knot_rag.evidence.mapper import EvidenceMapper
from knot_rag.evidence.support import SupportAssessor, SupportDecision, aggregate_status, weakest
from knot_rag.generation.generator import GroundedGenerator
from knot_rag.retrieval.service import RetrievalResult, RetrievalService
from knot_rag.schemas.answer import (
    AnswerOutcome,
    AnswerRequest,
    Claim,
    GenerationInfo,
    GroundedAnswer,
    InsufficientEvidence,
    InsufficientEvidenceReason,
    VerificationLevel,
)
from knot_rag.schemas.common import SupportStatus
from knot_rag.schemas.retrieval import (
    RetrievalDiagnostics,
    RetrievalOutcome,
    RetrieveRequest,
    RetrieveResponse,
)

log = logging.getLogger(__name__)

MSG_NO_EVIDENCE = (
    "Yüklediğin materyallerde bu soruyu yanıtlamaya yetecek bilgi bulunamadı. "
    "Tahmin yürütmek yerine durdum."
)
MSG_MODEL_DECLINED = "Getirilen kaynak bölümleri bu soruyu yanıtlamıyor. Tahmin yürütülmedi."
MSG_NO_SUPPORTED = "Üretilen ifadelerin hiçbiri kaynaklarla doğrulanamadı; yanıt kanıta dayalı kabul edilmedi."
MSG_PARTIAL = "Yanıtın yalnızca bir kısmı için yeterli kanıt var."
MSG_UNCOVERED = "Materyallerde karşılığı bulunamayan kavramlar: {terms}"
MSG_NOT_CONFIRMED = "Kaynak alıntısı doğrulandı ancak anlamsal destek ayrıca doğrulanmadı."
MSG_CONFLICT = "Kaynaklar bu konuda çelişiyor ({ids}); hangisinin doğru olduğu materyallerden belirlenemiyor."
MSG_CONFLICT_CLAIM = "Bu ifade başka bir kaynakla çelişiyor ({ids})."


def _cap_for_conflict(d: SupportDecision, ids: str) -> SupportDecision:
    """A claim contradicted by another source is at most GEVEŞEK (never raised)."""
    status = weakest(d.status, SupportStatus.PARTIALLY_SUPPORTED)
    note = MSG_CONFLICT_CLAIM.format(ids=ids)
    explanation = f"{d.explanation} {note}" if d.explanation else note
    return SupportDecision(status, explanation, d.assessment, True, relevance_only_cap=False)


def _overall_verification(levels: list[VerificationLevel]) -> VerificationLevel:
    if not levels or VerificationLevel.HEURISTIC in levels:
        return VerificationLevel.HEURISTIC
    if VerificationLevel.HEURISTIC_FALLBACK in levels:
        return VerificationLevel.HEURISTIC_FALLBACK
    return VerificationLevel.SEMANTIC_JUDGE


def _apply_confirmation_policy(d: SupportDecision, require_semantic: bool) -> SupportDecision:
    """Strict mode: a SIKI that no semantic judge confirmed is shown as GEVEŞEK."""
    if require_semantic and d.status == SupportStatus.SUPPORTED and not d.assessment.semantically_verified:
        return SupportDecision(SupportStatus.PARTIALLY_SUPPORTED, MSG_NOT_CONFIRMED, d.assessment, d.capped_by_hard_rule)
    if require_semantic and d.relevance_only_cap and not d.assessment.semantically_verified:
        return SupportDecision(d.status, d.explanation, d.assessment, d.capped_by_hard_rule, relevance_only_cap=False)
    return d


def _qfingerprint(q: str) -> str:
    return hashlib.sha256(q.encode("utf-8")).hexdigest()[:12]


class RagService:
    def __init__(
        self,
        retrieval: RetrievalService,
        context_builder: ContextBuilder,
        generator: GroundedGenerator,
        mapper: EvidenceMapper,
        assessor: SupportAssessor,
        log_questions: bool = False,
        support_settings: SupportSettings | None = None,
    ):
        self.retrieval = retrieval
        self.context_builder = context_builder
        self.generator = generator
        self.mapper = mapper
        self.assessor = assessor
        self._log_questions = log_questions
        self._support = support_settings or SupportSettings()

    # ── retrieval (also the reusable entry point for WBS-6 / WBS-7) ────────────────
    def _retrieve_and_build(self, req: RetrieveRequest | AnswerRequest) -> tuple[RetrievalResult, BuiltContext]:
        result = self.retrieval.retrieve(req.question, req.scope, req.params)
        built = self.context_builder.build(result.hits, req.params)
        return result, built

    @staticmethod
    def _diagnostics(result: RetrievalResult, built: BuiltContext) -> RetrievalDiagnostics:
        return RetrievalDiagnostics(
            candidates=result.candidates,
            rejected_out_of_scope=result.rejected_out_of_scope,
            below_min_score=result.below_min_score,
            duplicates_removed=built.duplicates_removed,
            dropped_by_limits=built.dropped_by_limits,
            context_tokens_estimate=built.tokens_estimate,
            embedding_model=result.embedding_model,
        )

    def _log(self, event: str, request_id: str, req, started: float, **fields) -> None:
        extra = {
            "request_id": request_id,
            "course_id": req.scope.course_id,
            "user_id": req.scope.user_id,
            "scope_documents": len(req.scope.document_ids),
            "question_chars": len(req.question),
            "question_sha": _qfingerprint(req.question),
            "latency_ms": int((time.monotonic() - started) * 1000),
            **fields,
        }
        if self._log_questions:
            extra["question"] = req.question
        log.info(event, extra=extra)

    def retrieve(self, req: RetrieveRequest, request_id: str) -> RetrieveResponse:
        started = time.monotonic()
        result, built = self._retrieve_and_build(req)
        resp = RetrieveResponse(
            request_id=request_id,
            question=req.question,
            retrieval_query=result.query.retrieval_query,
            outcome=RetrievalOutcome.EVIDENCE_FOUND if built.evidence else RetrievalOutcome.NO_EVIDENCE,
            evidence=built.evidence,
            diagnostics=self._diagnostics(result, built),
        )
        self._log("rag.retrieve", request_id, req, started, evidence=len(built.evidence), outcome=resp.outcome.value)
        return resp

    # ── grounded answer ────────────────────────────────────────────────────────────
    def answer(self, req: AnswerRequest, request_id: str) -> GroundedAnswer:
        started = time.monotonic()
        result, built = self._retrieve_and_build(req)
        diagnostics = self._diagnostics(result, built)
        base = dict(
            answer_id=str(uuid.uuid4()),
            request_id=request_id,
            question=req.question,
            course_id=req.scope.course_id,
            evidence=built.evidence,
            retrieval=diagnostics,
        )

        if not built.evidence:
            self._log("rag.answer", request_id, req, started, outcome="INSUFFICIENT_EVIDENCE", claims=0)
            return GroundedAnswer(
                **base,
                outcome=AnswerOutcome.INSUFFICIENT_EVIDENCE,
                support_status=SupportStatus.UNSUPPORTED,
                support_label=SupportStatus.UNSUPPORTED.ui_label,
                answer_text="",
                claims=[],
                insufficient_evidence=InsufficientEvidence(
                    reason=InsufficientEvidenceReason.NO_RETRIEVED_EVIDENCE, message=MSG_NO_EVIDENCE
                ),
                generation=None,
            )

        gen = self.generator.generate(result.query.normalized, req.scope.course_id, built.evidence)
        mapped = self.mapper.map(gen.answer, built.evidence)
        decisions = self.assessor.assess_all(mapped, result.query.normalized)
        known = {e.evidence_id for e in built.evidence}
        conflicts = model_conflicts([c.evidence_ids for c in gen.answer.conflicts], mapped, known)
        conflicts += detect_claim_conflicts(mapped)
        conflict_ids: dict[str, set[str]] = {}
        for cf in conflicts:
            for cid in cf.claim_ids:
                conflict_ids.setdefault(cid, set()).update(cf.evidence_ids)
        decisions = [
            _cap_for_conflict(d, ", ".join(sorted(conflict_ids[m.claim_id]))) if m.claim_id in conflict_ids else d
            for m, d in zip(mapped, decisions)
        ]
        claims: list[Claim] = []
        issues = []
        backing_texts: list[str] = []
        counted: list[SupportStatus] = []  # claims that bear on completeness (side remarks excluded)
        for m, decision in zip(mapped, decisions):
            decision = _apply_confirmation_policy(decision, self._support.require_semantic_confirmation)
            issues.extend(m.issues)
            if not decision.relevance_only_cap:
                counted.append(decision.status)
            if decision.status != SupportStatus.UNSUPPORTED:
                # Titles count as source context ("Hafta 4 — AVL Ağaçları" covers "AVL").
                backing_texts.extend(
                    f"{e.document_title} {e.location.section_title or ''} {e.text}" for e in m.cited_evidence
                )
            claims.append(
                Claim(
                    claim_id=m.claim_id,
                    claim_text=m.text,
                    cited_evidence_ids=[c.evidence_id for c in m.citations],
                    citations=m.citations,
                    support_status=decision.status,
                    support_label=decision.status.ui_label,
                    support_explanation=decision.explanation,
                    assessment=decision.assessment,
                    support_confirmed=decision.status == SupportStatus.SUPPORTED and decision.assessment.semantically_verified,
                )
            )

        # Answer-level state ignores side remarks (claims capped only by relevance). If every
        # claim is a side remark, the answer is off-target but true: GEVEŞEK, never SIKI, and
        # never an abstention (lexical relevance alone must not refuse, e.g. mixed-language).
        if counted or not claims:
            overall = aggregate_status(counted)
        else:
            overall = SupportStatus.PARTIALLY_SUPPORTED
        missing = list(gen.answer.missing)
        for cf in conflicts:
            msg = MSG_CONFLICT.format(ids=", ".join(cf.evidence_ids))
            if msg not in missing:
                missing.append(msg)
        context_texts = [f"{e.document_title} {e.location.section_title or ''} {e.text}" for e in built.evidence]
        coverage = question_coverage(result.query.normalized, backing_texts, context_texts)
        # Not ANSWERED if the cited evidence covers too little of the question. `absent_from_context`
        # is reported for analysis only: as a hard rule ("any absent term blocks ANSWERED") it
        # fired on ordinary function words in held-out questions (docs/rag-evaluation.md §4.3).
        under_covered = bool(claims) and coverage.ratio < self._support.question_coverage_answered
        if under_covered and coverage.uncovered_terms:
            missing.append(MSG_UNCOVERED.format(terms=", ".join(coverage.uncovered_terms)))
        insufficient: InsufficientEvidence | None = None
        if not claims:
            outcome = AnswerOutcome.INSUFFICIENT_EVIDENCE
            insufficient = InsufficientEvidence(
                reason=InsufficientEvidenceReason.MODEL_DECLINED, message=MSG_MODEL_DECLINED, missing_information=missing
            )
        elif overall == SupportStatus.UNSUPPORTED:
            outcome = AnswerOutcome.INSUFFICIENT_EVIDENCE
            insufficient = InsufficientEvidence(
                reason=InsufficientEvidenceReason.NO_SUPPORTED_CLAIMS, message=MSG_NO_SUPPORTED, missing_information=missing
            )
        elif overall == SupportStatus.SUPPORTED and gen.answer.status == "answered" and not missing and not under_covered:
            outcome = AnswerOutcome.ANSWERED
        else:
            outcome = AnswerOutcome.PARTIALLY_ANSWERED
            if overall == SupportStatus.SUPPORTED:
                # Every stated claim is supported, but the answer itself is incomplete.
                overall = SupportStatus.PARTIALLY_SUPPORTED
            insufficient = InsufficientEvidence(
                reason=InsufficientEvidenceReason.PARTIAL_COVERAGE, message=MSG_PARTIAL, missing_information=missing
            )

        answer = GroundedAnswer(
            **base,
            outcome=outcome,
            support_status=overall,
            support_label=overall.ui_label,
            answer_text=" ".join(c.claim_text for c in claims),
            claims=claims,
            insufficient_evidence=insufficient,
            citation_issues=issues,
            generation=GenerationInfo(
                provider=gen.provider, model=gen.model, prompt_version=gen.prompt_version,
                attempts=gen.attempts, latency_ms=gen.latency_ms,
            ),
            support_confirmed=bool(claims) and overall == SupportStatus.SUPPORTED and all(c.support_confirmed for c in claims),
            verification=_overall_verification([c.assessment.verification for c in claims]),
            question_coverage=coverage,
        )
        self._log(
            "rag.answer", request_id, req, started,
            outcome=outcome.value, support=overall.value, claims=len(claims),
            citation_issues=len(issues), evidence=len(built.evidence),
            question_coverage=coverage.ratio, verification=answer.verification.value,
        )
        return answer
