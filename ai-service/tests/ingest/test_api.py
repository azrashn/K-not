"""`/api/v1/ingestion/*` over HTTP (api-contracts.md §8): T8, T9, T10, T12, verify, delete,
auth, back-pressure, mounting."""

import pytest
from fastapi.testclient import TestClient

from knot_ingest.bootstrap import mount, mount_if_enabled
from knot_rag.api.app import create_app
from knot_rag.retrieval.chroma_index import ChromaChunkWriter
from knot_rag.retrieval.embedding import HashingEmbedder
from knot_rag.schemas.embedding import EmbeddingConfiguration
from tests.conftest import TOKEN

AUTH = {"Authorization": f"Bearer {TOKEN}"}
DOC = "doc-avl-1"


@pytest.fixture
def api(harness):
    app = create_app(harness.components)
    mount(app, harness.service)
    return TestClient(app), harness


def post_job(c, req):
    return c.post("/api/v1/ingestion/jobs", json=req, headers=AUTH)


def assert_error(r, status, code):
    assert r.status_code == status, r.text
    body = r.json()
    assert body["schema_version"] == "ingest.v1" and body["error"]["code"] == code
    return body["error"]


def test_routes_are_mounted_only_when_enabled(harness):
    app = create_app(harness.components)
    assert mount_if_enabled(app, harness.components, env={"INGEST_ENABLED": "false"}) is None
    c = TestClient(app)
    assert not [p for p in c.get("/openapi.json").json()["paths"] if p.startswith("/api/v1/ingestion")]
    assert c.post("/api/v1/ingestion/jobs", json={}, headers=AUTH).status_code == 404
    mount(app, harness.service)
    paths = TestClient(app).get("/openapi.json").json()["paths"]
    assert {"/api/v1/ingestion/jobs", "/api/v1/ingestion/reconcile", "/api/v1/ingestion/verify",
            "/api/v1/ingestion/documents/{document_id}/chunks"} <= set(paths)


def test_requires_internal_auth(api):
    c, h = api
    assert c.post("/api/v1/ingestion/jobs", json=h.request(DOC)).status_code == 401
    assert c.post("/api/v1/ingestion/jobs", json=h.request(DOC), headers={"Authorization": "Bearer nope"}).status_code == 401


def test_accept_then_duplicate_runs_once(api):
    """T8: a repeated job_id → 200 duplicate and a single execution."""
    c, h = api
    req = h.request(DOC)
    r1 = post_job(c, req)
    assert r1.status_code == 202 and r1.json() == {"schema_version": "ingest.v1", "job_id": req["job_id"], "accepted": True,
                                                   "duplicate": False, "worker_id": "ai-test01", "queue_position": 0}
    r2 = post_job(c, req)
    assert r2.status_code == 200 and r2.json()["duplicate"] is True
    assert h.service.worker.run_pending() == 1
    assert post_job(c, req).json()["duplicate"] is True  # also after it finished
    assert h.service.worker.run_pending() == 0
    assert [t for t, _ in h.stub.types(req["job_id"])].count("SUCCEEDED") == 1


def test_second_job_for_the_same_document_is_busy(api):
    c, h = api
    post_job(c, h.request(DOC))
    err = assert_error(post_job(c, h.request(DOC, job_id="job-other", attempt=2, kind="RETRY")), 409, "DOCUMENT_BUSY")
    assert err["retryable"] is True


def test_queue_full(api):
    c, h = api
    h.build(queue_capacity=1)
    app = create_app(h.components)
    mount(app, h.service)
    c = TestClient(app)
    assert post_job(c, h.request("doc-a")).status_code == 202
    assert_error(post_job(c, h.request("doc-b")), 503, "QUEUE_FULL")


@pytest.mark.parametrize("change", [
    lambda r: r["index"].update(embedding_fingerprint="sha256:" + "a" * 64),
    lambda r: r["index"]["embedding"].update(normalize=False),
    lambda r: r["index"]["embedding"].update(distance="l2"),
])
def test_configuration_mismatch_is_409_and_writes_nothing(api, change):
    """T9."""
    c, h = api
    req = h.request(DOC)
    change(req)
    if req["index"]["embedding_fingerprint"] != "sha256:" + "a" * 64:
        req["index"]["embedding_fingerprint"] = EmbeddingConfiguration.model_validate(req["index"]["embedding"]).fingerprint()
    assert_error(post_job(c, req), 409, "INDEX_CONFIG_MISMATCH")
    assert h.service.worker.run_pending() == 0
    assert h.collection not in {col.name for col in h.chroma.list_collections()}


def test_model_dimension_differing_from_the_configuration_is_409(api):
    c, h = api
    h.service.embedders._factory = lambda *a, **k: HashingEmbedder(384)  # e.g. a model that is not 768-d
    cfg = EmbeddingConfiguration(backend="sentence_transformers", model="some/model", dimension=768)
    err = assert_error(post_job(c, h.request(DOC, config=cfg)), 409, "INDEX_CONFIG_MISMATCH")
    assert err["details"] == {"model_dimension": 384}


def test_unloadable_model_is_409(api):
    c, h = api
    cfg = EmbeddingConfiguration(backend="no_such_backend", model="x", dimension=384)
    assert_error(post_job(c, h.request(DOC, config=cfg)), 409, "INDEX_CONFIG_MISMATCH")


def test_existing_collection_with_another_stamp_is_409(api):
    c, h = api
    other = h.config.model_copy(update={"query_prefix": "query: "})
    ChromaChunkWriter(h.chroma, h.collection, h.components.embedder, configuration=other).ensure_collection()
    err = assert_error(post_job(c, h.request(DOC)), 409, "INDEX_CONFIG_MISMATCH")
    assert "embedding_query_prefix" in err["details"]["mismatched_keys"]
    assert h.chroma.get_collection(h.collection).count() == 0


@pytest.mark.parametrize("key", ["../../etc/passwd", "/etc/passwd", "documents/../../x.pdf", "documents\\x.pdf"])
def test_unsafe_storage_keys_are_422(api, key):
    """T10."""
    c, h = api
    req = h.request(DOC)
    req["source"]["storage_key"] = key
    assert_error(post_job(c, req), 422, "VALIDATION_ERROR")


def test_unsupported_indexing_version_and_malformed_bodies(api):
    c, h = api
    err = assert_error(post_job(c, h.request(DOC, indexing_version="c2")), 422, "UNSUPPORTED_INDEXING_VERSION")
    assert err["details"]["supported"] == ["c1"]
    assert_error(post_job(c, {"job_id": "x"}), 422, "VALIDATION_ERROR")
    assert_error(c.post("/api/v1/ingestion/jobs", json=[1, 2], headers=AUTH), 422, "VALIDATION_ERROR")
    req = h.request(DOC)
    req["document"]["title"] = "İçerik"
    req["extra_field"] = "gizli içerik"
    err = assert_error(post_job(c, req), 422, "VALIDATION_ERROR")
    assert "gizli" not in str(err)  # submitted values are never echoed


def test_chroma_down_at_accept_is_503(api):
    c, h = api
    h.client_ok["up"] = False
    assert_error(post_job(c, h.request(DOC)), 503, "INDEX_UNAVAILABLE")


def test_delete_endpoint(api):
    c, h = api
    post_job(c, h.request(DOC))
    h.service.worker.run_pending()
    url = f"/api/v1/ingestion/documents/{DOC}/chunks?collection={h.collection}"
    assert c.delete(url, headers=AUTH).json() == {"document_id": DOC, "collection": h.collection, "deleted": 4}
    assert c.delete(url, headers=AUTH).json()["deleted"] == 0
    assert c.delete(f"/api/v1/ingestion/documents/{DOC}/chunks?collection=x", headers=AUTH).status_code == 422
    assert c.delete(f"/api/v1/ingestion/documents/{DOC}/chunks", headers=AUTH).status_code == 422


def test_reconcile(api):
    """T12."""
    c, h = api
    for doc in ("doc-live", "doc-dead"):
        post_job(c, h.request(doc))
        h.service.worker.run_pending()
    body = {"collection": h.collection, "live_document_ids": [], "dry_run": False}
    assert_error(c.post("/api/v1/ingestion/reconcile", json=body, headers=AUTH), 422, "VALIDATION_ERROR")

    body = {"collection": h.collection, "live_document_ids": ["doc-live"], "dry_run": True}
    r = c.post("/api/v1/ingestion/reconcile", json=body, headers=AUTH).json()
    assert r == {"orphan_document_ids": ["doc-dead"], "deleted_chunks": 0, "dry_run": True}
    assert len(h.collection_records("doc-dead")["ids"]) == 4  # dry run deleted nothing

    post_job(c, h.request("doc-inflight"))  # queued locally, not yet in NestJS's live list
    body["dry_run"] = False
    r = c.post("/api/v1/ingestion/reconcile", json=body, headers=AUTH).json()
    assert r == {"orphan_document_ids": ["doc-dead"], "deleted_chunks": 4, "dry_run": False}
    assert h.collection_records("doc-dead")["ids"] == [] and len(h.collection_records("doc-live")["ids"]) == 4

    h.service.worker.run_pending()
    allow = {"collection": h.collection, "live_document_ids": [], "dry_run": False, "allow_empty": True}
    r = c.post("/api/v1/ingestion/reconcile", json=allow, headers=AUTH).json()
    assert sorted(r["orphan_document_ids"]) == ["doc-inflight", "doc-live"] and r["deleted_chunks"] == 8
    missing = {"collection": "absent_collection", "live_document_ids": []}
    assert c.post("/api/v1/ingestion/reconcile", json=missing, headers=AUTH).json()["deleted_chunks"] == 0


def test_verify(api):
    c, h = api
    req = h.request(DOC)
    post_job(c, req)
    h.service.worker.run_pending()
    body = {"collection": h.collection, "documents": [
        {"document_id": DOC, "chunk_count": 4, "job_id": req["job_id"]},
        {"document_id": DOC, "chunk_count": 4, "job_id": "job-someone-else"},
        {"document_id": "doc-unknown", "chunk_count": 2, "job_id": "j"},
    ]}
    r = c.post("/api/v1/ingestion/verify", json=body, headers=AUTH).json()
    assert r["collection_fingerprint"] == h.config.fingerprint() and r["ok"] is False
    assert [x["ok"] for x in r["results"]] == [True, False, False]
    assert r["results"][1]["foreign_job_chunks"] == 4 and r["results"][2]["found"] == 0


def test_shutdown_hook_is_registered(api):
    c, h = api
    with c:  # runs startup and shutdown
        post_job(c, h.request(DOC))
    ev = h.stub.events(f"job-{DOC}-1")
    assert ev and ev[-1]["error"]["code"] == "WORKER_SHUTDOWN"


def test_hashing_model_name_is_irrelevant_but_dimension_is_not(harness):
    """The WBS-3 query embedder is reused when the configuration matches (one model in memory)."""
    h = harness
    assert h.service.embedders.get(h.config) is h.components.embedder
    other = h.service.embedders.get(EmbeddingConfiguration(backend="hashing", model="m", dimension=128))
    assert isinstance(other, HashingEmbedder) and other.dimension == 128
