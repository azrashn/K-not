"""RAG pipeline orchestration.

Question → scoped retrieval → context construction → structured generation →
schema validation → citation validation → evidence-support assessment → response.
"""

from __future__ import annotations

import hashlib
import logging
import time
import uuid

from knot_rag.context.builder import BuiltContext, ContextBuilder
from knot_rag.evidence.mapper import EvidenceMapper
from knot_rag.evidence.support import SupportAssessor, aggregate_status
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
    ):
        self.retrieval = retrieval
        self.context_builder = context_builder
        self.generator = generator
        self.mapper = mapper
        self.assessor = assessor
        self._log_questions = log_questions

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
        claims: list[Claim] = []
        issues = []
        for m in mapped:
            decision = self.assessor.assess(m)
            issues.extend(m.issues)
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
                )
            )

        statuses = [c.support_status for c in claims]
        overall = aggregate_status(statuses)
        missing = gen.answer.missing
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
        elif overall == SupportStatus.SUPPORTED and gen.answer.status == "answered" and not missing:
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
        )
        self._log(
            "rag.answer", request_id, req, started,
            outcome=outcome.value, support=overall.value, claims=len(claims),
            citation_issues=len(issues), evidence=len(built.evidence),
        )
        return answer
