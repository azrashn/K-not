"""Wire models for `ingest.v1` and `pages.v1` (document-contract.md §6–8, api-contracts.md §8–9).

`DocumentMetadata` and `EmbeddingConfiguration` are imported from `knot_rag`, never copied.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from knot_ingest import INGEST_SCHEMA_VERSION, PAGES_SCHEMA_VERSION
from knot_rag.schemas.common import Identifier, StrictModel
from knot_rag.schemas.documents import DocumentMetadata
from knot_rag.schemas.embedding import EmbeddingConfiguration

PAGE_SEPARATOR = "\n\n"

# Chroma collection names: 3–63 characters, alphanumeric at both ends.
CollectionName = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._\-]{1,61}[A-Za-z0-9]$")]
Fingerprint = Annotated[str, StringConstraints(pattern=r"^sha256:[0-9a-f]{64}$")]


class JobKind(str, Enum):
    INITIAL = "INITIAL"
    RETRY = "RETRY"
    REINDEX = "REINDEX"
    MIGRATION = "MIGRATION"


class Stage(str, Enum):
    EXTRACTING = "EXTRACTING"
    CHUNKING = "CHUNKING"
    EMBEDDING = "EMBEDDING"
    INDEXING = "INDEXING"


class EventType(str, Enum):
    STAGE = "STAGE"
    HEARTBEAT = "HEARTBEAT"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class IngestErrorCode(str, Enum):
    # Job failures (document-lifecycle.md §5)
    SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND"
    SOURCE_CHECKSUM_MISMATCH = "SOURCE_CHECKSUM_MISMATCH"
    UNSUPPORTED_FORMAT = "UNSUPPORTED_FORMAT"
    ENCRYPTED_PDF = "ENCRYPTED_PDF"
    CORRUPT_PDF = "CORRUPT_PDF"
    NO_TEXT_LAYER = "NO_TEXT_LAYER"
    EMPTY_DOCUMENT = "EMPTY_DOCUMENT"
    TOO_LARGE = "TOO_LARGE"
    UNSUPPORTED_INDEXING_VERSION = "UNSUPPORTED_INDEXING_VERSION"
    INDEX_CONFIG_MISMATCH = "INDEX_CONFIG_MISMATCH"
    EMBEDDING_FAILED = "EMBEDDING_FAILED"
    INDEX_UNAVAILABLE = "INDEX_UNAVAILABLE"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    STORAGE_WRITE_FAILED = "STORAGE_WRITE_FAILED"
    STALLED = "STALLED"
    WORKER_SHUTDOWN = "WORKER_SHUTDOWN"
    INTERNAL = "INTERNAL"
    # API-only responses (api-contracts.md §8.1)
    VALIDATION_ERROR = "VALIDATION_ERROR"
    DOCUMENT_BUSY = "DOCUMENT_BUSY"
    QUEUE_FULL = "QUEUE_FULL"


RETRYABLE_CODES = frozenset({
    IngestErrorCode.EMBEDDING_FAILED, IngestErrorCode.INDEX_UNAVAILABLE, IngestErrorCode.VERIFICATION_FAILED,
    IngestErrorCode.STORAGE_WRITE_FAILED, IngestErrorCode.STALLED, IngestErrorCode.WORKER_SHUTDOWN,
    IngestErrorCode.INTERNAL,
})


# ---- NestJS → Python ------------------------------------------------------------------------

class SourceFile(StrictModel):
    storage_key: str = Field(min_length=1, max_length=1024, description="Relative to STORAGE_ROOT.")
    mime_type: str = Field(min_length=1, max_length=127)
    sha256: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
    size_bytes: int = Field(ge=0)
    original_filename: str | None = Field(default=None, max_length=512, description="Diagnostics only; never a path.")


class IndexTarget(StrictModel):
    index_version_id: Identifier
    collection: CollectionName
    embedding: EmbeddingConfiguration
    embedding_fingerprint: Fingerprint


class IngestionJobRequest(StrictModel):
    schema_version: Literal["ingest.v1"] = INGEST_SCHEMA_VERSION
    job_id: Identifier
    attempt: int = Field(ge=1)
    kind: JobKind
    document: DocumentMetadata
    source: SourceFile
    index: IndexTarget


class JobAccepted(StrictModel):
    schema_version: Literal["ingest.v1"] = INGEST_SCHEMA_VERSION
    job_id: Identifier
    accepted: bool = True
    duplicate: bool
    worker_id: str
    queue_position: int = Field(ge=0)


class DeleteChunksResponse(StrictModel):
    document_id: Identifier
    collection: CollectionName
    deleted: int = Field(ge=0)


class ReconcileRequest(StrictModel):
    collection: CollectionName
    live_document_ids: list[Identifier]
    dry_run: bool = False
    allow_empty: bool = False


class ReconcileResponse(StrictModel):
    orphan_document_ids: list[Identifier]
    deleted_chunks: int = Field(ge=0)
    dry_run: bool


class VerifyItem(StrictModel):
    document_id: Identifier
    chunk_count: int = Field(ge=0)
    job_id: Identifier


class VerifyRequest(StrictModel):
    collection: CollectionName
    documents: list[VerifyItem] = Field(min_length=1, max_length=5000)


class VerifyResult(StrictModel):
    document_id: Identifier
    expected: int
    found: int
    foreign_job_chunks: int
    ok: bool


class VerifyResponse(StrictModel):
    results: list[VerifyResult]
    collection_fingerprint: str | None
    ok: bool


# ---- Python → NestJS ------------------------------------------------------------------------

class JobResult(StrictModel):
    """`SUCCEEDED` carries all fields; a `STAGE` event after extraction may carry `page_count`."""

    page_count: int | None = Field(default=None, ge=1)
    chunk_count: int | None = Field(default=None, ge=0)
    indexing_version: str | None = None
    collection: str | None = None
    embedding_fingerprint: str | None = None
    pages_artifact_key: str | None = None
    warnings: list[str] | None = None


class JobError(StrictModel):
    code: str
    message: str = Field(description="Safe for logs; never contains document text.")
    retryable: bool


class IngestionEvent(StrictModel):
    schema_version: Literal["ingest.v1"] = INGEST_SCHEMA_VERSION
    job_id: Identifier
    document_id: Identifier
    attempt: int = Field(ge=1)
    seq: int = Field(ge=1)
    worker_id: str
    type: EventType
    stage: Stage | None = None
    progress: float | None = Field(default=None, ge=0.0, le=1.0)
    emitted_at: datetime
    result: JobResult | None = None
    error: JobError | None = None

    @model_validator(mode="after")
    def _payload(self) -> "IngestionEvent":
        if self.type is EventType.SUCCEEDED:
            r = self.result
            required = ("page_count", "chunk_count", "indexing_version", "collection", "embedding_fingerprint",
                        "pages_artifact_key")
            if r is None or any(getattr(r, f) is None for f in required):
                raise ValueError("SUCCEEDED requires a complete result")
            if self.stage is not Stage.INDEXING:
                raise ValueError("SUCCEEDED is only sent from stage INDEXING")
        if self.type is EventType.FAILED and self.error is None:
            raise ValueError("FAILED requires an error")
        if self.type in (EventType.STAGE, EventType.HEARTBEAT) and self.error is not None:
            raise ValueError("only FAILED carries an error")
        return self


# ---- Storage artifact -----------------------------------------------------------------------

class PageText(StrictModel):
    page: int = Field(ge=1)
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    text: str


class PageArtifact(StrictModel):
    schema_version: Literal["pages.v1"] = PAGES_SCHEMA_VERSION
    document_id: Identifier
    indexing_version: str = Field(min_length=1, max_length=64)
    page_count: int = Field(ge=1)
    separator: Literal["\n\n"] = PAGE_SEPARATOR
    pages: list[PageText]

    @model_validator(mode="after")
    def _invariants(self) -> "PageArtifact":
        if len(self.pages) != self.page_count:
            raise ValueError("len(pages) must equal page_count")
        expected_start = 0
        for i, p in enumerate(self.pages, start=1):
            if p.page != i:
                raise ValueError("pages must be numbered 1..page_count without gaps")
            if p.char_start != expected_start or p.char_end - p.char_start != len(p.text):
                raise ValueError(f"page {i}: offsets do not match the text")
            expected_start = p.char_end + len(PAGE_SEPARATOR)
        return self

    def document_text(self) -> str:
        return PAGE_SEPARATOR.join(p.text for p in self.pages)
