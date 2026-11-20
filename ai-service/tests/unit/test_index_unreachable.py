"""An unreachable Chroma is reported with its concrete cause, logged once, and /ready says stamp=unknown."""

import logging

import pytest
from fastapi.testclient import TestClient

from knot_rag.api import create_app
from knot_rag.errors import RetrievalUnavailable
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaTarget

HTTP_TARGET = ChromaTarget("http", "localhost", 8000, "./.chroma")


def _refused():
    raise ConnectionRefusedError("[WinError 10061] connection refused")


def test_http_reason_names_the_address_and_the_likely_fix():
    reason = HTTP_TARGET.unreachable_reason(ConnectionRefusedError())
    assert reason == "chroma_http_unreachable localhost:8000 — CHROMA_MODE=persistent olmalı mı?"


def test_persistent_reason_names_the_folder_and_error_type():
    reason = ChromaTarget("persistent", path="./.chroma").unreachable_reason(PermissionError())
    assert reason == "chroma_persistent_unavailable ./.chroma (PermissionError)"


def test_unreachable_client_carries_the_reason_and_warns_once(embedder, caplog):
    idx = ChromaChunkIndex(_refused, "knot_chunks_v1", embedder, target=HTTP_TARGET)
    caplog.set_level(logging.WARNING, logger="knot_rag.retrieval.chroma_index")
    for _ in range(3):  # /ready polls every few seconds: one warning, not one per poll
        with pytest.raises(RetrievalUnavailable) as err:
            idx.info()
        assert err.value.details == {"reason": HTTP_TARGET.unreachable_reason(ConnectionRefusedError())}
    warnings = [r for r in caplog.records if r.getMessage() == "rag.index.unreachable"]
    assert len(warnings) == 1
    assert warnings[0].reason.startswith("chroma_http_unreachable localhost:8000")
    assert warnings[0].error_type == "ConnectionRefusedError"


def test_without_target_the_reason_is_still_explicit(embedder):
    with pytest.raises(RetrievalUnavailable) as err:
        ChromaChunkIndex(_refused, "c", embedder).info()
    assert err.value.details == {"reason": "chroma_unavailable (ConnectionRefusedError)"}


def test_ready_reports_reason_and_unknown_stamp(make_components, embedder):
    idx = ChromaChunkIndex(_refused, "knot_chunks_v1", embedder, target=HTTP_TARGET)
    body = TestClient(create_app(make_components(index=idx))).get("/ready")
    assert body.status_code == 503
    data = body.json()
    assert data["status"] == "not_ready"
    assert data["checks"]["index"] == "RETRIEVAL_UNAVAILABLE"  # stable code for existing callers
    assert data["checks"]["index_reason"].startswith("chroma_http_unreachable localhost:8000")
    assert data["index"]["stamp"] == "unknown"
    assert data["index"]["index_version_id"] is None


def test_ready_reason_for_other_index_errors_is_their_message(make_components, memory_index):
    from knot_rag.errors import IndexNotReady

    memory_index.fail = IndexNotReady("Collection 'x' does not exist yet.")
    data = TestClient(create_app(make_components())).get("/ready").json()
    assert data["checks"]["index"] == "INDEX_NOT_READY"
    assert data["checks"]["index_reason"] == "Collection 'x' does not exist yet."
    assert data["index"]["stamp"] == "unknown"
