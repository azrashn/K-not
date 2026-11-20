"""Retrieval request/response contract (POST /api/v1/rag/retrieve)."""

from __future__ import annotations

from enum import Enum

from pydantic import Field, field_validator

from knot_rag import SCHEMA_VERSION
from knot_rag.schemas.common import Identifier, StrictModel
from knot_rag.schemas.documents import DocumentType, SourceLocation

MAX_QUESTION_CHARS = 2000
MAX_SCOPE_DOCUMENTS = 1000


class AuthorizedScope(StrictModel):
    """The set of materials a request may search.

    Built by NestJS from its own database (enrolment + document ownership + index status),
    never copied from the student's request body. The Python service additionally enforces it
    as a mandatory metadata filter and re-checks every returned record.
    """

    user_id: Identifier
    course_id: Identifier
    document_ids: list[Identifier] = Field(min_length=1, max_length=MAX_SCOPE_DOCUMENTS)

    @field_validator("document_ids")
    @classmethod
    def _dedupe(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(v))


class RetrievalParams(StrictModel):
    """Optional per-request overrides. `None` means "use the server default"."""

    top_k: int | None = Field(default=None, ge=1, le=50, description="Candidates fetched from the index.")
    max_evidence: int | None = Field(default=None, ge=1, le=20, description="Max evidence items after selection.")
    min_score: float | None = Field(
        default=None, ge=-1.0, le=1.0,
        description="Candidates below this score are dropped. Uncalibrated ranking signal; see docs/rag-evaluation.md.",
    )
    max_context_tokens: int | None = Field(default=None, ge=200, le=32000)


class RetrieveRequest(StrictModel):
    schema_version: str = SCHEMA_VERSION
    request_id: str | None = Field(default=None, max_length=128)
    question: str = Field(min_length=1, max_length=MAX_QUESTION_CHARS)
    scope: AuthorizedScope
    params: RetrievalParams = Field(default_factory=RetrievalParams)


class HighlightSpan(StrictModel):
    """Character span of a verified quote. Present only when it was found by exact matching;
    coordinates are never estimated."""

    chunk_char_start: int = Field(ge=0, description="Offset within the evidence `text`.")
    chunk_char_end: int = Field(ge=0)
    document_char_start: int | None = Field(default=None, description="Offset in the document text, if the chunk's offset is known.")
    document_char_end: int | None = None


class RetrievedEvidence(StrictModel):
    evidence_id: str = Field(description="Response-local id (E1, E2, …) used by claims to cite this item.")
    chunk_id: str = Field(description="Stable WBS-2 chunk id; use this to persist or re-open the source.")
    document_id: str
    course_id: str
    document_title: str
    document_type: DocumentType
    indexing_version: str
    location: SourceLocation
    label: str = Field(description="Display convenience, e.g. `Slayt · s.18`. Do not parse; use `location`.")
    text: str
    score: float | None = Field(
        default=None, description="Similarity ranking signal (1 - cosine distance). Not a probability.",
    )
    rank: int = Field(ge=1, description="Rank in the original retrieval order.")
    truncated: bool = Field(default=False, description="Text was shortened to fit the context budget.")


class RetrievalOutcome(str, Enum):
    EVIDENCE_FOUND = "EVIDENCE_FOUND"
    NO_EVIDENCE = "NO_EVIDENCE"


class RetrievalDiagnostics(StrictModel):
    candidates: int = 0
    rejected_out_of_scope: int = 0
    below_min_score: int = 0
    duplicates_removed: int = 0
    dropped_by_limits: int = Field(default=0, description="Candidates cut by max_evidence, the per-document cap or the token budget.")
    context_tokens_estimate: int = 0
    embedding_model: str | None = None


class RetrieveResponse(StrictModel):
    schema_version: str = SCHEMA_VERSION
    request_id: str
    question: str = Field(description="The original question, unchanged.")
    retrieval_query: str = Field(description="The normalized text actually embedded.")
    outcome: RetrievalOutcome
    evidence: list[RetrievedEvidence]
    diagnostics: RetrievalDiagnostics
