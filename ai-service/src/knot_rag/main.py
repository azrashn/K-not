"""ASGI entry point: `uvicorn knot_rag.main:app --host 0.0.0.0 --port 8100`."""

from __future__ import annotations

import os

from knot_rag.api.app import create_app
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_ingest.bootstrap import mount_if_enabled
from knot_rag.logging_setup import configure_logging

configure_logging(os.environ.get("LOG_LEVEL", "INFO"))
components = build_components(Settings.from_env())
app = create_app(components)
mount_if_enabled(app, components)  # WBS-2 ingestion router, only with INGEST_ENABLED=true
