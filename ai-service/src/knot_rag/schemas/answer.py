"""Grounded answer contract (POST /api/v1/rag/answer)."""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from knot_rag import SCHEMA_VERSION
from knot_rag.schemas.common import StrictModel, SupportStatus
from knot_rag.schemas.documents import SourceLocation
from knot_rag.schemas.retrieval import (
    MAX_QUESTION_CHARS,
    AuthorizedScope,
    HighlightSpan,
    RetrievalDiagnostics,
    RetrievalParams,
    RetrievedEvidence,
)


class AnswerRequest(StrictModel):
    schema_version: str = SCHEMA_VERSION
    request_id: str | None = Field(default=None, max_length=128)
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    scope: AuthorizedScope
    params: RetrievalParams = Field(default_factory=RetrievalParams)


class Citation(StrictModel):
    """A structured pointer from a claim to one retrieved chunk. Always resolves to an item
    in `GroundedAnswer.evidence` (fabricated ids are removed and reported as issues)."""

    evidence_id: str
    chunk_id: str
    document_id: str
    document_title: str
    location: SourceLocation
    label: str
    quote: str | None = Field(default=None, description="Passage the model quoted, if any.")
    quote_verified: bool = Field(description="`quote` occurs in the chunk text (normalized exact match).")
    highlight: HighlightSpan | None = Field(default=None, description="Only set when quote_verified.")


class VerificationLevel(str, Enum):
    """What kind of check stands behind a support state.

    HEURISTIC          lexical rules only (quote match, coverage, numbers, negation, relevance)
    SEMANTIC_JUDGE     an entailment judge (LLM/NLI) confirmed the verdict on top of the rules
    HEURISTIC_FALLBACK a judge was configured but failed for this claim; rules only
    """

    HEURISTIC = "HEURISTIC"
    SEMANTIC_JUDGE = "SEMANTIC_JUDGE"
    HEURISTIC_FALLBACK = "HEURISTIC_FALLBACK"


class SupportAssessment(StrictModel):
    """How `support_status` was decided. `semantically_verified` is True only when a
    semantic judge produced the verdict (`verification == SEMANTIC_JUDGE`)."""

    method: str
    citations_valid: bool
    quote_verified: bool
    lexical_coverage: float = Field(ge=0.0, le=1.0)
    numbers_consistent: bool
    model_marked_partial: bool
    semantically_verified: bool = False
    # Added in rag.v1.1 (additive):
    verification: VerificationLevel = VerificationLevel.HEURISTIC
    quote_coverage: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Share of claim terms found in the sentence(s) around the verified quote."
    )
    question_relevance: float | None = Field(
        default=None, ge=0.0, le=1.0, description="Share of the question's key terms that the claim mentions."
    )
    negation_consistent: bool = True
    addresses_question: bool | None = Field(
        default=None, description="Rule S7 (lexical). False = the claim is a side remark; it is labelled GEVEŞEK "
        "but does not make the answer incomplete."
    )
    judge_verdict: str | None = Field(default=None, description="ENTAILED / PARTIAL / NOT_ENTAILED when a judge ran.")
    # Added in rag.v1.2 (additive):
    unsupported_terms: list[str] | None = Field(
        default=None, description="Rule S8: claim content terms that occur in none of the cited passages (stem match)."
    )


class Claim(StrictModel):
    claim_id: str
    claim_text: str
    cited_evidence_ids: list[str]
    citations: list[Citation]
    support_status: SupportStatus
    support_label: str = Field(description="UI term: SIKI / GEVEŞEK / KOPUK.")
    support_explanation: str | None = None
    assessment: SupportAssessment
    support_confirmed: bool = Field(
        default=False,
        description="True only if SUPPORTED *and* semantically verified. Heuristic SIKI is never 'confirmed'.",
    )


class AnswerOutcome(str, Enum):
    ANSWERED = "ANSWERED"
    PARTIALLY_ANSWERED = "PARTIALLY_ANSWERED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class InsufficientEvidenceReason(str, Enum):
    NO_RETRIEVED_EVIDENCE = "NO_RETRIEVED_EVIDENCE"
    MODEL_DECLINED = "MODEL_DECLINED"
    NO_SUPPORTED_CLAIMS = "NO_SUPPORTED_CLAIMS"
    PARTIAL_COVERAGE = "PARTIAL_COVERAGE"


class InsufficientEvidence(StrictModel):
    reason: InsufficientEvidenceReason
    message: str
    missing_information: list[str] = Field(default_factory=list)


class CitationIssueType(str, Enum):
    UNKNOWN_EVIDENCE_ID = "UNKNOWN_EVIDENCE_ID"
    QUOTE_NOT_FOUND = "QUOTE_NOT_FOUND"


class CitationIssue(StrictModel):
    claim_id: str
    evidence_id: str
    issue: CitationIssueType


class QuestionCoverage(StrictModel):
    """Which key terms of the question appear in the evidence cited by non-KOPUK claims.
    Lexical signal used to keep partially answered questions from being reported as ANSWERED."""

    method: str = "key-term-stem-v1"
    key_terms: list[str]
    uncovered_terms: list[str] = Field(description="Key terms absent from the evidence cited by non-KOPUK claims.")
    ratio: float = Field(ge=0.0, le=1.0)
    absent_from_context: list[str] = Field(
        default_factory=list,
        description="Key terms absent from ALL evidence given to the model. Informational; not used for the outcome.",
    )


class GenerationInfo(StrictModel):
    provider: str
    model: str
    prompt_version: str
    attempts: int
    latency_ms: int


class GroundedAnswer(StrictModel):
    schema_version: str = SCHEMA_VERSION
    answer_id: str
    request_id: str
    question: str
    course_id: str
    outcome: AnswerOutcome
    support_status: SupportStatus
    support_label: str
    answer_text: str = Field(description="Claims joined in order; convenience for plain rendering.")
    claims: list[Claim]
    evidence: list[RetrievedEvidence] = Field(description="Exactly the evidence shown to the model.")
    insufficient_evidence: InsufficientEvidence | None = None
    citation_issues: list[CitationIssue] = Field(default_factory=list)
    retrieval: RetrievalDiagnostics
    generation: GenerationInfo | None = Field(default=None, description="Null when generation was skipped (no evidence).")
    # Added in rag.v1.1 (additive):
    support_confirmed: bool = Field(
        default=False, description="True only if every claim is SUPPORTED and semantically verified."
    )
    verification: VerificationLevel = Field(
        default=VerificationLevel.HEURISTIC, description="Weakest verification level across claims."
    )
    question_coverage: QuestionCoverage | None = None
