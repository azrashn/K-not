"""Exception taxonomy. Every operational failure maps to one `ErrorCode` and HTTP status.

"No evidence" is deliberately *not* an exception: it is a successful response with
`outcome=INSUFFICIENT_EVIDENCE` (answer) or `NO_EVIDENCE` (retrieve).
"""

from __future__ import annotations

from typing import Any

from knot_rag.schemas.common import ErrorCode


class RagError(Exception):
    code: ErrorCode = ErrorCode.INTERNAL_ERROR
    http_status: int = 500
    retryable: bool = False
    default_message = "Internal error."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: dict[str, Any] | None = None,
        retryable: bool | None = None,
    ):
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.details = details
        if retryable is not None:
            self.retryable = retryable


class RequestValidationFailed(RagError):
    code, http_status = ErrorCode.VALIDATION_ERROR, 422
    default_message = "The request is invalid."


class Unauthorized(RagError):
    code, http_status = ErrorCode.UNAUTHORIZED, 401
    default_message = "Missing or invalid internal service credentials."


class ScopeViolation(RagError):
    code, http_status = ErrorCode.UNAUTHORIZED_SCOPE, 403
    default_message = "The request scope is not valid for this course."


class IndexNotReady(RagError):
    code, http_status, retryable = ErrorCode.INDEX_NOT_READY, 409, True
    default_message = "No indexed material is available for this scope yet."


class RetrievalUnavailable(RagError):
    code, http_status, retryable = ErrorCode.RETRIEVAL_UNAVAILABLE, 503, True
    default_message = "The vector index is unavailable."


class GenerationFailed(RagError):
    code, http_status, retryable = ErrorCode.GENERATION_FAILED, 502, True
    default_message = "The answer could not be generated."


class ProviderTimeout(RagError):
    code, http_status, retryable = ErrorCode.PROVIDER_TIMEOUT, 504, True
    default_message = "The language model did not respond in time."


class ConfigurationError(RagError):
    code, http_status = ErrorCode.INTERNAL_ERROR, 500
    default_message = "The RAG service is misconfigured."
