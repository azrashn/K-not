"""Ingestion failures. Messages are safe for logs and callbacks: never document text."""

from __future__ import annotations

from typing import Any

from knot_ingest.schemas import RETRYABLE_CODES, IngestErrorCode


class IngestFailure(Exception):
    """A job failure with a lifecycle error code (document-lifecycle.md §5)."""

    def __init__(self, code: IngestErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message

    @property
    def retryable(self) -> bool:
        return self.code in RETRYABLE_CODES


class JobAborted(Exception):
    """Stop without further writes or events (cancel flag, 409 STALE_JOB/INVALID_TRANSITION)."""


class IngestApiError(Exception):
    """A synchronous API refusal, rendered with the common error envelope (`ingest.v1`)."""

    def __init__(
        self,
        status: int,
        code: IngestErrorCode,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
