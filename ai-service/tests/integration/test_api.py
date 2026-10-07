import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.generation.providers import ExtractiveBaselineProvider, ProviderTimeoutError, ScriptedProvider
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from tests.conftest import TOKEN
from tests.fakes import scope

pytestmark = pytest.mark.integration
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def chroma_index(chroma_client, collection_name, corpus, embedder):
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    return ChromaChunkIndex(chroma_client, collection_name, embedder)


@pytest.fixture
def client_for(settings, embedder, chroma_index):
    def _make(provider=None, index=None):
        comps = build_components(settings, index=index or chroma_index, embedder=embedder, provider=provider or ExtractiveBaselineProvider())
        return TestClient(create_app(comps), raise_server_exceptions=False)

    return _make


def body(question="Hash tablosunda çakışma nasıl çözülür?", **kw):
    return {"question": question, "scope": scope(kw.pop("docs", None)), **kw}


def test_health_and_ready(client_for):
    c = client_for()
    assert c.get("/health").json()["status"] == "ok"
    r = c.get("/ready")
    assert r.status_code == 200 and r.json()["checks"]["embedding_model"].startswith("knot-hashing")


def test_ready_reports_missing_index(client_for, chroma_client, embedder):
    c = client_for(index=ChromaChunkIndex(chroma_client, "missing_collection", embedder))
    r = c.get("/ready")
    assert r.status_code == 503 and r.json()["checks"]["index"] == "INDEX_NOT_READY"


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"X-Internal-Token": "wrong"}, {"Authorization": TOKEN}])
def test_rag_endpoints_require_internal_token(client_for, headers):
    r = client_for().post("/api/v1/rag/answer", json=body(), headers=headers)
    assert r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED"


def test_x_internal_token_header_is_accepted(client_for):
    assert client_for().post("/api/v1/rag/retrieve", json=body(), headers={"X-Internal-Token": TOKEN}).status_code == 200


def test_retrieve_contract(client_for):
    r = client_for().post("/api/v1/rag/retrieve", json=body(), headers={**AUTH, "X-Request-ID": "nest-123"})
    assert r.status_code == 200
    data = r.json()
    assert r.headers["X-Request-ID"] == "nest-123" and data["request_id"] == "nest-123"
    assert data["schema_version"] == "rag.v1" and data["outcome"] == "EVIDENCE_FOUND"
    e = data["evidence"][0]
    for key in ["evidence_id", "chunk_id", "document_id", "document_title", "location", "label", "text", "score", "rank"]:
        assert key in e
    assert all(x["course_id"] == "veri-yapilari" for x in data["evidence"])


def test_answer_contract_end_to_end(client_for):
    r = client_for().post("/api/v1/rag/answer", json=body(request_id="nest-req-9"), headers=AUTH)
    assert r.status_code == 200
    a = r.json()
    assert a["request_id"] == "nest-req-9"
    assert a["outcome"] in {"ANSWERED", "PARTIALLY_ANSWERED", "INSUFFICIENT_EVIDENCE"}
    ev = {e["evidence_id"]: e for e in a["evidence"]}
    assert a["claims"]
    for claim in a["claims"]:
        assert claim["support_label"] in {"SIKI", "GEVEŞEK", "KOPUK"}
        for cit in claim["citations"]:
            assert ev[cit["evidence_id"]]["chunk_id"] == cit["chunk_id"]
            if cit["highlight"]:
                h = cit["highlight"]
                assert cit["quote_verified"]
                assert ev[cit["evidence_id"]]["text"][h["chunk_char_start"]:h["chunk_char_end"]]


def test_no_evidence_is_a_successful_response(client_for):
    r = client_for().post("/api/v1/rag/answer", json=body("İstanbul'un nüfusu kaçtır?", params={"min_score": 0.9}), headers=AUTH)
    assert r.status_code == 200
    a = r.json()
    assert a["outcome"] == "INSUFFICIENT_EVIDENCE" and a["claims"] == [] and a["generation"] is None
    assert a["insufficient_evidence"]["reason"] == "NO_RETRIEVED_EVIDENCE"


@pytest.mark.parametrize("payload", [
    {"question": "", "scope": scope()},
    {"question": "   ", "scope": scope()},
    {"question": "AVL?", "scope": {**scope(), "document_ids": []}},
    {"question": "AVL?", "scope": scope(), "admin": True},
    {"question": "AVL?", "scope": {**scope(), "course_id": "x y"}},
    {"question": "AVL?" * 600, "scope": scope()},
    {"question": "AVL?", "scope": scope(), "params": {"top_k": 1000}},
    {"scope": scope()},
])
def test_invalid_requests_are_rejected_predictably(client_for, payload):
    r = client_for().post("/api/v1/rag/answer", json=payload, headers=AUTH)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR" and err["request_id"]
    assert "AVL?AVL?" not in json.dumps(err)  # input is not echoed


def test_malformed_json_body(client_for):
    r = client_for().post("/api/v1/rag/answer", content=b"{not json", headers={**AUTH, "Content-Type": "application/json"})
    assert r.status_code == 422


def test_oversized_body_rejected(client_for):
    big = json.dumps(body()).encode() + b" " * (300 * 1024)
    r = client_for().post("/api/v1/rag/answer", content=big, headers={**AUTH, "Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_maximum_legitimate_scope_fits_body_limit(client_for):
    big = body(docs=[f"doc-{i:04d}-{'x' * 110}" for i in range(1000)])
    assert len(json.dumps(big)) < 256 * 1024
    assert client_for().post("/api/v1/rag/answer", json=big, headers=AUTH).status_code == 409


def test_scope_without_indexed_documents_is_index_not_ready(client_for):
    r = client_for().post("/api/v1/rag/answer", json=body(docs=["doc-yeni-yuklendi"]), headers=AUTH)
    assert r.status_code == 409
    assert r.json()["error"] == {**r.json()["error"], "code": "INDEX_NOT_READY", "retryable": True}


def test_other_course_documents_cannot_be_reached(client_for):
    r = client_for().post("/api/v1/rag/retrieve", json=body("LRU sayfa değiştirme", docs=["doc-os-hafta5"]), headers=AUTH)
    assert r.status_code == 403  # course_id=veri-yapilari + OS document
    assert r.json()["error"]["code"] == "UNAUTHORIZED_SCOPE"
    assert "LRU" not in r.text


def test_provider_timeout_maps_to_504(client_for):
    r = client_for(provider=ScriptedProvider([ProviderTimeoutError()])).post("/api/v1/rag/answer", json=body(), headers=AUTH)
    assert r.status_code == 504 and r.json()["error"]["code"] == "PROVIDER_TIMEOUT"


def test_malformed_model_output_maps_to_502(client_for):
    r = client_for(provider=ScriptedProvider(["nope"])).post("/api/v1/rag/answer", json=body(), headers=AUTH)
    assert r.status_code == 502 and r.json()["error"]["code"] == "GENERATION_FAILED"


def test_chroma_unavailable_maps_to_503(client_for, memory_index):
    from knot_rag.errors import RetrievalUnavailable

    memory_index.fail = RetrievalUnavailable()
    r = client_for(index=memory_index).post("/api/v1/rag/answer", json=body(), headers=AUTH)
    assert r.status_code == 503 and r.json()["error"]["code"] == "RETRIEVAL_UNAVAILABLE"


def test_unexpected_errors_do_not_leak_internals(client_for):
    def boom(_):
        raise RuntimeError("secret stack detail /home/app/db.py")

    r = client_for(provider=ScriptedProvider([boom])).post("/api/v1/rag/answer", json=body(), headers=AUTH)
    assert r.status_code == 500
    assert r.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "secret" not in r.text and "Traceback" not in r.text


def test_openapi_documents_endpoints(client_for):
    paths = client_for().get("/openapi.json").json()["paths"]
    assert {"/health", "/ready", "/api/v1/rag/retrieve", "/api/v1/rag/answer"} <= set(paths)


def test_concurrent_http_requests(client_for):
    c = client_for()
    qs = ["AVL rotasyon", "Zincirleme", "Hızlı sıralama en kötü durum", "Denge faktörü"] * 4

    def call(i):
        return c.post("/api/v1/rag/answer", json=body(qs[i]), headers={**AUTH, "X-Request-ID": f"r-{i}"})

    with ThreadPoolExecutor(max_workers=8) as ex:
        rs = list(ex.map(call, range(len(qs))))
    assert all(r.status_code == 200 for r in rs)
    assert [r.json()["request_id"] for r in rs] == [f"r-{i}" for i in range(len(qs))]


def test_service_starts_while_chroma_is_down(settings, embedder):
    from dataclasses import replace

    comps = build_components(replace(settings, chroma_mode="http", chroma_port=1), embedder=embedder, provider=ExtractiveBaselineProvider())
    c = TestClient(create_app(comps), raise_server_exceptions=False)
    assert c.get("/health").status_code == 200
    assert c.get("/ready").status_code == 503
    r = c.post("/api/v1/rag/answer", json=body(), headers=AUTH)
    assert r.status_code == 503 and r.json()["error"]["code"] == "RETRIEVAL_UNAVAILABLE"
