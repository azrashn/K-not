"""Ingestion configuration (wbs2-handoff.md §10). Read once at startup."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping

from knot_rag.errors import ConfigurationError


def _bool(v: str | None) -> bool:
    return (v or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class IngestSettings:
    enabled: bool = False
    storage_root: str = ""
    nestjs_internal_url: str = ""
    callback_token: str = field(default="", repr=False)
    worker_concurrency: int = 1
    queue_capacity: int = 20
    heartbeat_seconds: float = 30.0
    embed_batch_size: int = 32
    max_pages: int = 400
    max_empty_page_ratio: float = 0.5
    supported_indexing_versions: tuple[str, ...] = ("c1",)
    callback_timeout_seconds: float = 10.0
    terminal_retry_seconds: float = 120.0  # SUCCEEDED/FAILED are retried this long on 5xx/timeout
    shutdown_grace_seconds: float = 20.0

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "IngestSettings":
        e = os.environ if env is None else env
        g = e.get
        try:
            s = cls(
                enabled=_bool(g("INGEST_ENABLED")),
                storage_root=g("STORAGE_ROOT", ""),
                nestjs_internal_url=g("NESTJS_INTERNAL_URL", ""),
                callback_token=g("INGEST_CALLBACK_TOKEN", ""),
                worker_concurrency=int(g("INGEST_WORKER_CONCURRENCY", "1")),
                queue_capacity=int(g("INGEST_QUEUE_CAPACITY", "20")),
                heartbeat_seconds=float(g("INGEST_HEARTBEAT_SECONDS", "30")),
                embed_batch_size=int(g("INGEST_EMBED_BATCH_SIZE", "32")),
                max_pages=int(g("INGEST_MAX_PAGES", "400")),
                max_empty_page_ratio=float(g("INGEST_MAX_EMPTY_PAGE_RATIO", "0.5")),
                supported_indexing_versions=tuple(
                    v.strip() for v in g("INGEST_SUPPORTED_INDEXING_VERSIONS", "c1").split(",") if v.strip()
                ),
            )
        except ValueError as exc:
            raise ConfigurationError(f"Invalid numeric ingestion setting: {exc}") from exc
        if s.enabled:
            s.validate()
        return s

    def validate(self) -> None:
        if not self.storage_root or not Path(self.storage_root).is_dir():
            raise ConfigurationError("STORAGE_ROOT must be an existing directory when INGEST_ENABLED=true.")
        if not self.nestjs_internal_url.startswith(("http://", "https://")):
            raise ConfigurationError("NESTJS_INTERNAL_URL must be an http(s) URL when INGEST_ENABLED=true.")
        if not self.callback_token:
            raise ConfigurationError("INGEST_CALLBACK_TOKEN is required when INGEST_ENABLED=true.")
        if self.worker_concurrency < 1 or self.queue_capacity < 1 or self.embed_batch_size < 1:
            raise ConfigurationError("Ingestion concurrency, queue capacity and batch size must be >= 1.")
        if self.heartbeat_seconds <= 0 or self.max_pages < 1 or not 0 <= self.max_empty_page_ratio <= 1:
            raise ConfigurationError("Invalid ingestion heartbeat, page limit or empty-page ratio.")
        unsupported = set(self.supported_indexing_versions) - {"c1"}
        if unsupported:
            raise ConfigurationError(f"This build implements indexing_version c1 only, not {sorted(unsupported)}.")
