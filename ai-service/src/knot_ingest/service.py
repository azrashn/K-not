"""Ingestion API operations (api-contracts.md §8): accept a job, delete a document's chunks,
reconcile orphans, verify written documents. Chroma is only read for counts, verification,
deletion and reconcile — never searched."""

from __future__ import annotations

import logging
import threading
from typing import Any, Callable

from pydantic import ValidationError

from knot_ingest.errors import IngestApiError
from knot_ingest.pipeline import JobHandle
from knot_ingest.schemas import (
    DeleteChunksResponse,
    IngestErrorCode as E,
    IngestionJobRequest,
    JobAccepted,
    ReconcileRequest,
    ReconcileResponse,
    VerifyRequest,
    VerifyResponse,
    VerifyResult,
)
from knot_ingest.storage import LocalStorage, UnsafeStorageKey
from knot_ingest.worker import IngestionWorker
from knot_rag.errors import ConfigurationError
from knot_rag.retrieval.chroma_index import ChromaChunkWriter, delete_document_chunks, document_chunk_job_ids
from knot_rag.retrieval.embedding import Embedder, build_embedder
from knot_rag.schemas.documents import META_DOCUMENT_ID
from knot_rag.schemas.embedding import STAMP_FINGERPRINT, EmbeddingConfiguration

log = logging.getLogger("knot_rag.ingest.service")

MAX_CHUNK_ORDINAL_DIGITS = 4  # chunk ids must stay valid Identifiers (≤ 128 characters)


def _validation_details(exc: ValidationError) -> dict:
    # Locations and messages only; never echo submitted values.
    return {"errors": [{"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", "")} for e in exc.errors()][:20]}


def embedder_key(config: EmbeddingConfiguration) -> tuple:
    """Which embedder instance a configuration needs (hashing ignores the model name)."""
    if config.backend == "hashing":
        return ("hashing", config.dimension)
    return (config.backend, config.model, config.revision or None, config.query_prefix, config.document_prefix)


class EmbedderCache:
    """One loaded embedder per configuration (two models only during a migration, R6). The
    WBS-3 query embedder is reused when the configuration matches, so the model is loaded
    once per process."""

    def __init__(self, factory: Callable[..., Embedder] = build_embedder):
        self._factory = factory
        self._items: dict[tuple, Embedder] = {}
        self._lock = threading.Lock()

    def seed(self, config_key: tuple, embedder: Embedder) -> None:
        with self._lock:
            self._items.setdefault(config_key, embedder)

    def get(self, config: EmbeddingConfiguration) -> Embedder:
        key = embedder_key(config)
        with self._lock:
            if key not in self._items:
                self._items[key] = self._factory(config.backend, config.model, config.query_prefix,
                                                  config.document_prefix, config.revision, config.dimension)
            return self._items[key]


class IngestionService:
    def __init__(
        self,
        *,
        storage: LocalStorage,
        chroma_client: Callable[[], Any],
        worker: IngestionWorker,
        embedders: EmbedderCache,
        worker_id: str,
        supported_indexing_versions: tuple[str, ...] = ("c1",),
    ):
        self.storage = storage
        self._chroma_client = chroma_client
        self.worker = worker
        self.embedders = embedders
        self.worker_id = worker_id
        self._supported = supported_indexing_versions

    # -- POST /jobs -------------------------------------------------------------------------

    def accept(self, payload: Any) -> tuple[int, JobAccepted]:
        try:
            req = IngestionJobRequest.model_validate(payload)
        except ValidationError as exc:
            raise IngestApiError(422, E.VALIDATION_ERROR, "The ingestion job request is invalid.",
                                 details=_validation_details(exc)) from None
        if self.worker.is_known(req.job_id):  # idempotent re-dispatch: no re-validation, no second run
            return 200, JobAccepted(job_id=req.job_id, duplicate=True, worker_id=self.worker_id,
                                    queue_position=self.worker.queue_position(req.job_id))
        try:
            self.storage.resolve(req.source.storage_key)
        except UnsafeStorageKey as exc:
            raise IngestApiError(422, E.VALIDATION_ERROR, "source.storage_key is not a safe relative path.",
                                 details={"reason": str(exc)}) from None
        iv = req.document.indexing_version
        if iv not in self._supported:
            raise IngestApiError(422, E.UNSUPPORTED_INDEXING_VERSION, f"indexing_version {iv!r} is not implemented.",
                                 details={"supported": list(self._supported)})
        if len(req.document.document_id) + len(iv) + 2 + MAX_CHUNK_ORDINAL_DIGITS > 128:
            raise IngestApiError(422, E.VALIDATION_ERROR, "document_id is too long to form chunk ids.")

        embedder = self._check_configuration(req)
        self._check_collection(req, embedder)

        handle = JobHandle(request=req, embedder=embedder)
        duplicate, pos = self.worker.submit(handle)
        log.info("ingest.job.accepted", extra={"job_id": req.job_id, "document_id": req.document.document_id,
                                               "kind": req.kind.value, "attempt": req.attempt, "duplicate": duplicate})
        return (200 if duplicate else 202), JobAccepted(job_id=req.job_id, duplicate=duplicate,
                                                        worker_id=self.worker_id, queue_position=pos)

    def _mismatch(self, message: str, **details) -> IngestApiError:
        return IngestApiError(409, E.INDEX_CONFIG_MISMATCH, message, details=details or None)

    def _check_configuration(self, req: IngestionJobRequest) -> Embedder:
        config = req.index.embedding
        reason = config.unsupported_reason()
        if reason:
            raise self._mismatch(reason)
        if config.fingerprint() != req.index.embedding_fingerprint:
            raise self._mismatch("embedding_fingerprint does not match the embedding configuration.",
                                 expected=config.fingerprint())
        try:
            embedder = self.embedders.get(config)
            dimension = embedder.dimension  # forces the model to load
        except Exception as exc:
            log.error("ingest.embedder.unavailable", extra={"backend": config.backend, "error_type": type(exc).__name__})
            raise self._mismatch("The embedding model for this configuration cannot be loaded.") from None
        if dimension != config.dimension:
            raise self._mismatch("The embedding model dimension differs from the configuration.", model_dimension=dimension)
        return embedder

    def _check_collection(self, req: IngestionJobRequest, embedder: Embedder) -> None:
        writer = ChromaChunkWriter(self._client(), req.index.collection, embedder,
                                   configuration=req.index.embedding, index_version_id=req.index.index_version_id)
        try:
            writer.existing_collection()
        except ConfigurationError as exc:
            raise self._mismatch("The collection exists with a different stamp.", **(exc.details or {})) from None
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None

    # -- maintenance ------------------------------------------------------------------------

    def _client(self):
        try:
            return self._chroma_client()
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None

    def _collection(self, name: str):
        client = self._client()
        try:
            names = {getattr(c, "name", c) for c in client.list_collections()}
            return client.get_collection(name) if name in names else None
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None

    def delete_chunks(self, document_id: str, collection: str) -> DeleteChunksResponse:
        self.worker.cancel_document(document_id)
        col = self._collection(collection)
        try:
            deleted = 0 if col is None else delete_document_chunks(col, document_id)
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None
        log.info("ingest.document.chunks_deleted", extra={"document_id": document_id, "collection": collection, "deleted": deleted})
        return DeleteChunksResponse(document_id=document_id, collection=collection, deleted=deleted)

    def reconcile(self, req: ReconcileRequest) -> ReconcileResponse:
        col = self._collection(req.collection)
        if col is None:
            return ReconcileResponse(orphan_document_ids=[], deleted_chunks=0, dry_run=req.dry_run)
        try:
            indexed = self._indexed_document_counts(col)
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None
        if not req.live_document_ids and indexed and not req.allow_empty:
            raise IngestApiError(422, E.VALIDATION_ERROR,
                                 "Refusing to reconcile a non-empty collection against an empty live list (set allow_empty).")
        live = set(req.live_document_ids) | self.worker.active_document_ids()  # never touch in-flight jobs
        orphans = sorted(d for d in indexed if d not in live)
        deleted = 0
        if not req.dry_run:
            try:
                for doc in orphans:
                    deleted += delete_document_chunks(col, doc)
            except Exception:
                raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None
        log.info("ingest.reconcile", extra={"collection": req.collection, "orphans": len(orphans),
                                            "deleted": deleted, "dry_run": req.dry_run})
        return ReconcileResponse(orphan_document_ids=orphans, deleted_chunks=deleted, dry_run=req.dry_run)

    @staticmethod
    def _indexed_document_counts(col, page: int = 1000) -> dict[str, int]:
        counts: dict[str, int] = {}
        offset = 0
        while True:
            res = col.get(include=["metadatas"], limit=page, offset=offset)
            metas = res.get("metadatas") or []
            for m in metas:
                doc = (m or {}).get(META_DOCUMENT_ID)
                if doc:
                    counts[doc] = counts.get(doc, 0) + 1
            if len(res.get("ids") or []) < page:
                return counts
            offset += page

    def verify(self, req: VerifyRequest) -> VerifyResponse:
        col = self._collection(req.collection)
        results = []
        try:
            for item in req.documents:
                tags = {} if col is None else document_chunk_job_ids(col, item.document_id)
                foreign = sum(1 for job in tags.values() if job != item.job_id)
                results.append(VerifyResult(document_id=item.document_id, expected=item.chunk_count, found=len(tags),
                                            foreign_job_chunks=foreign, ok=len(tags) == item.chunk_count and foreign == 0))
        except Exception:
            raise IngestApiError(503, E.INDEX_UNAVAILABLE, "The vector index is unavailable.", retryable=True) from None
        fingerprint = None if col is None else (col.metadata or {}).get(STAMP_FINGERPRINT)
        return VerifyResponse(results=results, collection_fingerprint=fingerprint, ok=all(r.ok for r in results))

