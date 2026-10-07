"""The WBS-2 → WBS-3 indexing contract: how documents and chunks are described.

WBS-2 (ingestion) owns producing `IndexedChunk`s and writing them to ChromaDB. WBS-3 only
reads them. `IndexedChunk.to_chroma_metadata()` / `from_chroma()` are the single source of
truth for metadata key names so both sides stay consistent.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import Field, model_validator

from knot_rag.schemas.common import Identifier, StrictModel


class DocumentType(str, Enum):
    SLIDE = "slide"
    NOTES = "notes"
    TEXTBOOK = "textbook"
    PAST_EXAM = "past_exam"
    OTHER = "other"

    @property
    def short_label(self) -> str:
        """Turkish label used by the frontend citation pill, e.g. `Slayt · s.18`."""
        return {
            DocumentType.SLIDE: "Slayt",
            DocumentType.NOTES: "Notlar",
            DocumentType.TEXTBOOK: "Kitap",
            DocumentType.PAST_EXAM: "Sınav",
            DocumentType.OTHER: "Belge",
        }[self]


class SourceLocation(StrictModel):
    """Where a chunk lives in its original document. Every field is optional on purpose:
    unknown locations stay `null` and are never guessed."""

    page_start: int | None = Field(default=None, ge=1, description="1-based first page, if known.")
    page_end: int | None = Field(default=None, ge=1, description="1-based last page (== page_start for single-page chunks).")
    char_start: int | None = Field(default=None, ge=0, description="Offset of the chunk in the extracted document text.")
    char_end: int | None = Field(default=None, ge=0)
    section_title: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _ranges(self) -> "SourceLocation":
        if self.page_start is None and self.page_end is not None:
            raise ValueError("page_end requires page_start")
        if self.page_start is not None and self.page_end is None:
            self.page_end = self.page_start
        if self.page_start is not None and self.page_end is not None and self.page_end < self.page_start:
            raise ValueError("page_end must be >= page_start")
        if (self.char_start is None) != (self.char_end is None):
            raise ValueError("char_start and char_end must be provided together")
        if self.char_start is not None and self.char_end is not None and self.char_end < self.char_start:
            raise ValueError("char_end must be >= char_start")
        return self

    def page_label(self) -> str | None:
        if self.page_start is None:
            return None
        if self.page_end and self.page_end != self.page_start:
            return f"s.{self.page_start}–{self.page_end}"
        return f"s.{self.page_start}"


class DocumentMetadata(StrictModel):
    document_id: Identifier
    course_id: Identifier
    owner_id: Identifier | None = Field(default=None, description="Uploader; informational. Access is decided by NestJS scope.")
    title: str = Field(min_length=1, max_length=300)
    document_type: DocumentType
    indexing_version: str = Field(min_length=1, max_length=64)
    page_count: int | None = Field(default=None, ge=1)


# Metadata keys stored on every Chroma record. Changing these is a breaking contract change.
META_CHUNK_ID = "chunk_id"
META_DOCUMENT_ID = "document_id"
META_COURSE_ID = "course_id"
META_OWNER_ID = "owner_id"
META_TITLE = "document_title"
META_TYPE = "document_type"
META_INDEXING_VERSION = "indexing_version"
META_PAGE_COUNT = "page_count"
META_PAGE_START = "page_start"
META_PAGE_END = "page_end"
META_CHAR_START = "char_start"
META_CHAR_END = "char_end"
META_SECTION = "section_title"
META_EXTRA_PREFIX = "x_"


class IndexedChunk(StrictModel):
    chunk_id: Identifier = Field(description="Stable across re-reads; recommended `{document_id}:{indexing_version}:{ordinal}`.")
    document: DocumentMetadata
    text: str = Field(min_length=1)
    location: SourceLocation = Field(default_factory=SourceLocation)
    extra: dict[str, str | int | float | bool] = Field(
        default_factory=dict, description="Optional scalar extras, stored with an `x_` prefix."
    )

    def to_chroma_metadata(self) -> dict[str, str | int | float | bool]:
        d = self.document
        meta: dict[str, Any] = {
            META_CHUNK_ID: self.chunk_id,
            META_DOCUMENT_ID: d.document_id,
            META_COURSE_ID: d.course_id,
            META_OWNER_ID: d.owner_id,
            META_TITLE: d.title,
            META_TYPE: d.document_type.value,
            META_INDEXING_VERSION: d.indexing_version,
            META_PAGE_COUNT: d.page_count,
            META_PAGE_START: self.location.page_start,
            META_PAGE_END: self.location.page_end,
            META_CHAR_START: self.location.char_start,
            META_CHAR_END: self.location.char_end,
            META_SECTION: self.location.section_title,
        }
        meta.update({f"{META_EXTRA_PREFIX}{k}": v for k, v in self.extra.items()})
        # Chroma metadata cannot hold None: absent means unknown.
        return {k: v for k, v in meta.items() if v is not None}

    @classmethod
    def from_chroma(cls, chunk_id: str, text: str, meta: dict[str, Any]) -> "IndexedChunk":
        return cls(
            chunk_id=meta.get(META_CHUNK_ID, chunk_id),
            text=text,
            document=DocumentMetadata(
                document_id=meta[META_DOCUMENT_ID],
                course_id=meta[META_COURSE_ID],
                owner_id=meta.get(META_OWNER_ID),
                title=meta.get(META_TITLE) or meta[META_DOCUMENT_ID],
                document_type=DocumentType(meta.get(META_TYPE, DocumentType.OTHER.value)),
                indexing_version=str(meta.get(META_INDEXING_VERSION, "unknown")),
                page_count=meta.get(META_PAGE_COUNT),
            ),
            location=SourceLocation(
                page_start=meta.get(META_PAGE_START),
                page_end=meta.get(META_PAGE_END),
                char_start=meta.get(META_CHAR_START),
                char_end=meta.get(META_CHAR_END),
                section_title=meta.get(META_SECTION),
            ),
            extra={
                k[len(META_EXTRA_PREFIX):]: v for k, v in meta.items() if k.startswith(META_EXTRA_PREFIX)
            },
        )
