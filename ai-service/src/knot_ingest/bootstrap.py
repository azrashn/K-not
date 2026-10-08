"""Composition for ingestion, mounted into the WBS-3 app behind `INGEST_ENABLED=true`."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Callable, Mapping

import pypdf
from fastapi import FastAPI

from knot_ingest.api import build_router, error_response
from knot_ingest.callbacks import CallbackClient, EventEmitter
from knot_ingest.config import IngestSettings
from knot_ingest.errors import IngestApiError
from knot_ingest.extraction import PINNED_PYPDF_VERSION
from knot_ingest.pipeline import JobRunner, RunnerSettings
from knot_ingest.schemas import IngestionJobRequest
from knot_ingest.service import EmbedderCache, IngestionService, embedder_key
from knot_ingest.storage import LocalStorage
from knot_ingest.worker import IngestionWorker
from knot_rag.errors import ConfigurationError
from knot_rag.retrieval.chroma_index import build_chroma_client
from knot_rag.schemas.embedding import EmbeddingConfiguration

log = logging.getLogger("knot_rag.ingest")


def build_service(
    settings: IngestSettings,
    components: Any,
    *,
    chroma_client: Callable[[], Any] | None = None,
    callback_transport=None,
    callback_sleep=None,
    embedder_factory=None,
    worker_id: str | None = None,
    start: bool = True,
) -> IngestionService:
    if pypdf.__version__ != PINNED_PYPDF_VERSION:
        raise ConfigurationError(
            f"pypdf {pypdf.__version__} is installed but indexing_version c1 is pinned to {PINNED_PYPDF_VERSION}; "
            "a different extractor needs a new indexing_version."
        )
    rag = components.settings
    worker_id = worker_id or f"ai-{uuid.uuid4().hex[:6]}"
    if chroma_client is None:
        cache: dict[str, Any] = {}

        def chroma_client():
            if "client" not in cache:
                cache["client"] = build_chroma_client(rag.chroma_mode, rag.chroma_host, rag.chroma_port, rag.chroma_path)
            return cache["client"]

    extra = {} if callback_sleep is None else {"sleep": callback_sleep}
    callbacks = CallbackClient(settings.nestjs_internal_url, settings.callback_token,
                               timeout=settings.callback_timeout_seconds,
                               terminal_retry_seconds=settings.terminal_retry_seconds,
                               transport=callback_transport, **extra)

    def emitter_factory(req: IngestionJobRequest) -> EventEmitter:
        return EventEmitter(callbacks, job_id=req.job_id, document_id=req.document.document_id,
                            attempt=req.attempt, worker_id=worker_id)

    storage = LocalStorage(settings.storage_root)
    runner = JobRunner(
        RunnerSettings(heartbeat_seconds=settings.heartbeat_seconds, embed_batch_size=settings.embed_batch_size,
                       max_pages=settings.max_pages, max_empty_page_ratio=settings.max_empty_page_ratio),
        storage, chroma_client, emitter_factory,
    )
    worker = IngestionWorker(runner.run, concurrency=settings.worker_concurrency, capacity=settings.queue_capacity,
                             emitter_factory=emitter_factory)
    embedders = EmbedderCache(embedder_factory) if embedder_factory else EmbedderCache()
    # Reuse the WBS-3 query embedder for the same configuration (one model in memory).
    query_cfg = EmbeddingConfiguration(
        backend=rag.embedding_backend, model=rag.embedding_model, revision=rag.embedding_revision or None,
        dimension=components.embedder.dimension if rag.embedding_backend == "hashing" else 1,
        query_prefix=rag.embedding_query_prefix, document_prefix=rag.embedding_document_prefix,
    )
    embedders.seed(embedder_key(query_cfg), components.embedder)
    service = IngestionService(storage=storage, chroma_client=chroma_client, worker=worker, embedders=embedders,
                               worker_id=worker_id, supported_indexing_versions=settings.supported_indexing_versions)
    if start:
        worker.start()
    return service


def mount(app: FastAPI, service: IngestionService, grace_seconds: float = 20.0) -> None:
    app.include_router(build_router(service, app.state.internal_auth))
    app.add_exception_handler(IngestApiError, error_response)
    app.router.on_shutdown.append(lambda: service.worker.shutdown(grace_seconds))
    app.state.ingestion = service


def mount_if_enabled(app: FastAPI, components: Any, env: Mapping[str, str] | None = None) -> IngestionService | None:
    settings = IngestSettings.from_env(env)
    if not settings.enabled:
        return None
    service = build_service(settings, components)
    mount(app, service, settings.shutdown_grace_seconds)
    log.info("ingest.enabled", extra={"worker_id": service.worker_id, "concurrency": settings.worker_concurrency})
    return service
