"""Shared enums, identifier types and the error envelope."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from knot_rag import SCHEMA_VERSION

# Stable identifiers issued by NestJS / WBS-2. Deliberately conservative so they are
# safe inside Chroma metadata filters, log lines and URLs.
Identifier = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$"),
]


class StrictModel(BaseModel):
    """Base for every wire model: unknown fields are rejected, not silently dropped."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)


class SupportStatus(str, Enum):
    """Evidence-support state of a claim or answer.

    UI mapping (frontend `KnotStrength`): SUPPORTED→SIKI, PARTIALLY_SUPPORTED→GEVEŞEK,
    UNSUPPORTED→KOPUK. The state is decided by explicit criteria in
    `knot_rag.evidence.support`, never by a raw similarity score.
    """

    SUPPORTED = "SUPPORTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    UNSUPPORTED = "UNSUPPORTED"

    @property
    def ui_label(self) -> str:
        return {
            SupportStatus.SUPPORTED: "SIKI",
            SupportStatus.PARTIALLY_SUPPORTED: "GEVEŞEK",
            SupportStatus.UNSUPPORTED: "KOPUK",
        }[self]


class ErrorCode(str, Enum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHORIZED = "UNAUTHORIZED"
    UNAUTHORIZED_SCOPE = "UNAUTHORIZED_SCOPE"
    INDEX_NOT_READY = "INDEX_NOT_READY"
    NO_EVIDENCE = "NO_EVIDENCE"
    GENERATION_FAILED = "GENERATION_FAILED"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    RETRIEVAL_UNAVAILABLE = "RETRIEVAL_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorBody(StrictModel):
    code: ErrorCode
    message: str = Field(description="Human-readable, safe to show; never contains stack traces.")
    request_id: str | None = None
    retryable: bool = False
    details: dict[str, Any] | None = None


class ErrorResponse(StrictModel):
    schema_version: str = SCHEMA_VERSION
    error: ErrorBody
