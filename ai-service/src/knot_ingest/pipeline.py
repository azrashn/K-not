"""One ingestion job, start to finish (wbs2-handoff.md §4).

EXTRACTING → CHUNKING → EMBEDDING → INDEXING (delete-first, tagged writes, read-back
verification, then the atomic page artifact) → SUCCEEDED. Any failure is classified into a
lifecycle error code and reported once as FAILED. A checkpoint before every stage and every
Chroma write stops the job silently when it was cancelled or NestJS answered 409.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from knot_ingest.callbacks import EventEmitter, Heartbeat
from knot_ingest.chunking import build_chunks, build_page_artifact, check_invariants, chunk_spans, layout_pages
from knot_ingest.errors import IngestFailure, JobAborted
from knot_ingest.extraction import extract_pdf
from knot_ingest.schemas import EventType, IngestErrorCode as E, IngestionJobRequest, JobError, JobResult, Stage
from knot_ingest.storage import LocalStorage, UnsafeStorageKey, pages_artifact_key
from knot_rag.errors import ConfigurationError
from knot_rag.retrieval.chroma_index import ChromaChunkWriter
from knot_rag.retrieval.embedding import Embedder

log = logging.getLogger("knot_rag.ingest.pipeline")

PDF_MIME_TYPES = {"application/pdf"}


@dataclass
class JobHandle:
    """A job accepted by this process. `cancel` is set by DELETE …/chunks or shutdown."""

    request: IngestionJobRequest
    embedder: Embedder
    cancel: threading.Event = field(default_factory=threading.Event)
    emitter: EventEmitter | None = None
    state: str = "QUEUED"  # QUEUED | RUNNING | DONE
    outcome: str | None = None  # SUCCEEDED | FAILED:<code> | ABORTED

    @property
    def job_id(self) -> str:
        return self.request.job_id

    @property
    def document_id(self) -> str:
        return self.request.document.document_id


@dataclass(frozen=True)
class RunnerSettings:
    heartbeat_seconds: float = 30.0
    embed_batch_size: int = 32
    write_batch_size: int = 128
    max_pages: int = 400
    max_empty_page_ratio: float = 0.5


class JobRunner:
    def __init__(
        self,
        settings: RunnerSettings,
        storage: LocalStorage,
        chroma_client: Callable[[], Any],
        emitter_factory: Callable[[IngestionJobRequest], EventEmitter],
    ):
        self._s = settings
        self._storage = storage
        self._chroma_client = chroma_client
        self._emitter_factory = emitter_factory

    # -- control ------------------------------------------------------------------------------

    @staticmethod
    def _checkpoint(handle: JobHandle) -> None:
        em = handle.emitter
        if handle.cancel.is_set() or (em is not None and (em.aborted.is_set() or em.closed)):
            raise JobAborted()

    def _enter(self, handle: JobHandle, stage: Stage, progress: float, result: JobResult | None = None) -> None:
        self._checkpoint(handle)
        handle.emitter.emit(EventType.STAGE, stage, progress, result=result)
        self._checkpoint(handle)

    # -- stages -------------------------------------------------------------------------------

    def _read_source(self, req: IngestionJobRequest) -> bytes:
        try:
            data = self._storage.read_bytes(req.source.storage_key)
        except (OSError, UnsafeStorageKey) as exc:
            raise IngestFailure(E.SOURCE_NOT_FOUND, "The source file is missing or unreadable.") from exc
        if hashlib.sha256(data).hexdigest() != req.source.sha256:
            raise IngestFailure(E.SOURCE_CHECKSUM_MISMATCH, "The source file does not match its checksum.")
        if req.source.mime_type not in PDF_MIME_TYPES:
            raise IngestFailure(E.UNSUPPORTED_FORMAT, "Only PDF documents are supported.")
        return data

    def _embed(self, handle: JobHandle, texts: list[str]) -> list[list[float]]:
        dim = handle.request.index.embedding.dimension
        vectors: list[list[float]] = []
        n = len(texts)
        for i in range(0, n, self._s.embed_batch_size):
            self._checkpoint(handle)
            try:
                batch = handle.embedder.embed_documents(texts[i:i + self._s.embed_batch_size])
            except Exception as exc:
                raise IngestFailure(E.EMBEDDING_FAILED, f"Embedding failed ({type(exc).__name__}).") from exc
            if len(batch) != len(texts[i:i + self._s.embed_batch_size]) or any(len(v) != dim for v in batch):
                raise IngestFailure(E.EMBEDDING_FAILED, "The embedder returned vectors of an unexpected shape.")
            vectors.extend([list(map(float, v)) for v in batch])
            handle.emitter.progress = 0.4 + 0.35 * min(1.0, len(vectors) / max(n, 1))
        return vectors

    def _index(self, handle: JobHandle, chunks, vectors) -> None:
        req = handle.request
        job_id, doc_id = req.job_id, req.document.document_id
        try:
            writer = ChromaChunkWriter(self._chroma_client(), req.index.collection, handle.embedder,
                                       configuration=req.index.embedding, index_version_id=req.index.index_version_id)
            self._checkpoint(handle)
            writer.ensure_collection()
            self._checkpoint(handle)
            removed = writer.delete_document(doc_id)  # delete-first: retries are idempotent
            bs = self._s.write_batch_size
            for i in range(0, len(chunks), bs):
                self._checkpoint(handle)
                writer.upsert(chunks[i:i + bs], embeddings=vectors[i:i + bs])
            self._checkpoint(handle)
            found = writer.count(doc_id)
            foreign = writer.count(doc_id, exclude_job_id=job_id)
            if foreign:
                log.warning("ingest.verify.foreign_chunks", extra={"job_id": job_id, "document_id": doc_id, "foreign": foreign})
                self._checkpoint(handle)
                writer.delete_document(doc_id, exclude_job_id=job_id)
                found = writer.count(doc_id)
                foreign = writer.count(doc_id, exclude_job_id=job_id)
        except (IngestFailure, JobAborted):
            raise
        except ConfigurationError as exc:
            raise IngestFailure(E.INDEX_CONFIG_MISMATCH, "The collection is stamped with a different configuration.") from exc
        except Exception as exc:
            raise IngestFailure(E.INDEX_UNAVAILABLE, f"The vector index is unavailable ({type(exc).__name__}).") from exc
        if found != len(chunks) or foreign:
            raise IngestFailure(E.VERIFICATION_FAILED,
                                f"Read-back verification failed: expected {len(chunks)}, found {found}, foreign {foreign}.")
        log.info("ingest.indexed", extra={"job_id": job_id, "document_id": doc_id, "chunks": found, "replaced": removed})

    def _write_artifact(self, handle: JobHandle, artifact) -> str:
        key = pages_artifact_key(handle.document_id, handle.request.document.indexing_version)
        data = json.dumps(artifact.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        try:
            self._storage.write_atomic(key, data)
        except Exception as exc:
            raise IngestFailure(E.STORAGE_WRITE_FAILED, "The page artifact could not be written.") from exc
        return key

    # -- driver -------------------------------------------------------------------------------

    def run(self, handle: JobHandle) -> None:
        req = handle.request
        handle.emitter = handle.emitter or self._emitter_factory(req)
        em = handle.emitter
        heartbeat = Heartbeat(em, self._s.heartbeat_seconds)
        stage = Stage.EXTRACTING
        started = time.monotonic()
        ctx = {"job_id": req.job_id, "document_id": req.document.document_id, "attempt": req.attempt, "kind": req.kind.value}
        try:
            self._checkpoint(handle)
            heartbeat.start()
            log.info("ingest.job.started", extra=ctx)

            self._enter(handle, Stage.EXTRACTING, 0.05)
            data = self._read_source(req)
            extracted = extract_pdf(data, max_pages=self._s.max_pages, max_empty_page_ratio=self._s.max_empty_page_ratio)
            page_count = extracted.page_count
            self._enter(handle, Stage.EXTRACTING, 0.2, JobResult(page_count=page_count))

            stage = Stage.CHUNKING
            self._enter(handle, stage, 0.3)
            document = req.document.model_copy(update={"page_count": page_count})
            layout = layout_pages(extracted.page_texts)
            chunks = build_chunks(document, req.job_id, layout, chunk_spans(layout, document.document_type))
            check_invariants(layout, chunks)
            artifact = build_page_artifact(document.document_id, document.indexing_version, layout)

            stage = Stage.EMBEDDING
            self._enter(handle, stage, 0.4)
            vectors = self._embed(handle, [c.text for c in chunks])

            stage = Stage.INDEXING
            self._enter(handle, stage, 0.8)
            self._index(handle, chunks, vectors)
            self._checkpoint(handle)
            key = self._write_artifact(handle, artifact)  # only after successful verification
            self._checkpoint(handle)

            heartbeat.stop()
            result = JobResult(
                page_count=page_count, chunk_count=len(chunks), indexing_version=document.indexing_version,
                collection=req.index.collection, embedding_fingerprint=req.index.embedding_fingerprint,
                pages_artifact_key=key, warnings=extracted.warnings or None,
            )
            outcome = em.emit(EventType.SUCCEEDED, Stage.INDEXING, 1.0, result=result, final=True)
            handle.outcome = "SUCCEEDED"
            log.info("ingest.job.succeeded", extra={**ctx, "pages": page_count, "chunks": len(chunks),
                                                    "empty_pages": extracted.empty_pages, "callback": outcome.value,
                                                    "seconds": round(time.monotonic() - started, 3)})
        except JobAborted:
            handle.outcome = "ABORTED"
            log.warning("ingest.job.aborted", extra={**ctx, "stage": stage.value,
                                                     "cancelled": handle.cancel.is_set(), "nest_abort": em.aborted.is_set()})
        except Exception as exc:
            failure = exc if isinstance(exc, IngestFailure) else IngestFailure(E.INTERNAL, "Internal ingestion error.")
            heartbeat.stop()
            handle.outcome = f"FAILED:{failure.code.value}"
            # No exc_info: exception messages (e.g. pydantic errors) may quote document text.
            log.log(logging.ERROR if failure.code is E.INTERNAL else logging.WARNING, "ingest.job.failed",
                    extra={**ctx, "stage": stage.value, "code": failure.code.value,
                           "error_type": type(exc.__cause__ or exc).__name__, "where": _origin(exc)})
            if not (handle.cancel.is_set() or em.aborted.is_set()):
                em.emit(EventType.FAILED, stage, em.progress,
                        error=JobError(code=failure.code.value, message=failure.message, retryable=failure.retryable),
                        final=True)
        finally:
            heartbeat.stop()


def _origin(exc: BaseException) -> str | None:
    """`module:line` of the innermost frame (no message, no locals)."""
    root = exc.__cause__ or exc
    tb = root.__traceback__
    while tb is not None and tb.tb_next is not None:
        tb = tb.tb_next
    return None if tb is None else f"{tb.tb_frame.f_globals.get('__name__', '?')}:{tb.tb_lineno}"
