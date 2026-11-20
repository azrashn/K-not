"""WBS-2 → WBS-3 integration (T4, wbs2-handoff.md §12): PDF → extraction → chunking → embedding
→ ChromaDB → the existing `/api/v1/rag/*` endpoints, with exact ids, pages, offsets and excerpts.

Embeddings are the deterministic HashingEmbedder (MOCK); no real embedding model is involved."""

import httpx
import pytest
from fastapi.testclient import TestClient

from knot_ingest.bootstrap import build_service, mount
from knot_rag.api.app import create_app
from knot_rag.bootstrap import build_components
from knot_rag.generation.providers import ExtractiveBaselineProvider
from tests.conftest import TOKEN

AUTH = {"Authorization": f"Bearer {TOKEN}"}
COURSE = "course-vy"


def ingest(h, doc, pdf="slides_tr.pdf", **kw):
    req = h.request(doc, pdf, **kw)
    h.submit_and_run(req)
    assert h.stub.jobs[req["job_id"]].status == "SUCCEEDED", h.stub.jobs[req["job_id"]]
    return req


@pytest.fixture
def indexed(harness):
    h = harness
    ingest(h, "doc-avl")
    ingest(h, "doc-hash", "notes_tr.pdf", document_type="notes", title="Karma Tabloları Notları")
    ingest(h, "doc-os", "notes_tr.pdf", document_type="notes", course_id="course-os", title="İşletim Sistemleri")
    ingest(h, "doc-private", "notes_tr.pdf", document_type="notes", owner_id="u-mehmet", title="Mehmet'in notları")
    return h


def app_for(h, provider=None):
    comps = build_components(h.rag_settings, embedder=h.components.embedder, chroma_client=h.chroma,
                             provider=provider or ExtractiveBaselineProvider())
    return TestClient(create_app(comps))


def retrieve(c, question, docs, course=COURSE, user="u-ayse"):
    body = {"question": question, "scope": {"user_id": user, "course_id": course, "document_ids": docs}}
    r = c.post("/api/v1/rag/retrieve", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    return r.json()


def test_ingested_chunks_are_retrieved_with_exact_source_locations(indexed):
    """T4: ids, page range, label, offsets and excerpt survive the whole flow."""
    h = indexed
    c = app_for(h)
    res = retrieve(c, "AVL ağacında denge faktörü ve yükseklik farkı en fazla kaç olabilir?", ["doc-avl", "doc-hash"])
    top = res["evidence"][0]
    assert top["chunk_id"] == "doc-avl:c1:003" and top["document_id"] == "doc-avl"
    assert top["location"]["page_start"] == top["location"]["page_end"] == 4
    assert top["label"] == "Slayt · s.4" and top["indexing_version"] == "c1"
    assert top["location"]["section_title"] == "AVL Ağaçları: Denge Koşulu"
    art = h.artifact("doc-avl")
    text = "\n\n".join(p["text"] for p in art["pages"])
    for ev in res["evidence"]:
        loc = ev["location"]
        doc_text = text if ev["document_id"] == "doc-avl" else "\n\n".join(p["text"] for p in h.artifact(ev["document_id"])["pages"])
        if not ev["truncated"]:
            assert ev["text"] == doc_text[loc["char_start"]:loc["char_end"]]


def test_multi_page_prose_chunk_label(indexed):
    c = app_for(indexed)
    res = retrieve(c, "Açık adresleme doğrusal sondalama birincil kümelenme", ["doc-hash"])
    ev = res["evidence"][0]
    assert ev["document_id"] == "doc-hash" and ev["label"].startswith("Notlar · s.")
    if ev["location"]["page_end"] > ev["location"]["page_start"]:
        assert "–" in ev["label"]


def test_citation_highlight_maps_to_the_page_via_the_artifact(indexed):
    """T4: a WBS-3 citation highlight (document offsets) resolves to page-relative text."""
    h = indexed
    c = app_for(h)
    body = {"question": "AVL ağacında sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?",
            "scope": {"user_id": "u-ayse", "course_id": COURSE, "document_ids": ["doc-avl"]}}
    r = c.post("/api/v1/rag/answer", json=body, headers=AUTH)
    assert r.status_code == 200, r.text
    answer = r.json()
    cites = [ct for cl in answer["claims"] for ct in cl["citations"] if ct.get("highlight")]
    assert cites, "the extractive baseline quotes verbatim, so a highlight must exist"
    art = h.artifact("doc-avl")
    for ct in cites:
        hl, loc = ct["highlight"], ct["location"]
        page = art["pages"][loc["page_start"] - 1]
        start = hl["document_char_start"] - page["char_start"]
        end = hl["document_char_end"] - page["char_start"]
        assert 0 <= start < end <= len(page["text"])
        assert page["text"][start:end] == ct["quote"]  # same as the frontend's code-point slice


def test_cross_course_isolation(indexed):
    c = app_for(indexed)
    # Ask about the other course's document while scoped to course-vy (even listing its id).
    res = retrieve(c, "Karma tabloları zincirleme yük faktörü", ["doc-avl", "doc-os"])
    assert {e["document_id"] for e in res["evidence"]} <= {"doc-avl"}
    assert all(e["course_id"] == COURSE for e in res["evidence"])
    r = c.post("/api/v1/rag/retrieve", headers=AUTH, json={
        "question": "Karma tabloları", "scope": {"user_id": "u-ayse", "course_id": COURSE, "document_ids": ["doc-os"]}})
    assert r.status_code in (403, 409)  # scope mismatch is refused, nothing leaks


def test_cross_user_isolation(indexed):
    """A private document of another user is never returned unless NestJS puts it in scope."""
    c = app_for(indexed)
    res = retrieve(c, "Karma tabloları zincirleme yük faktörü açık adresleme", ["doc-avl", "doc-hash"])
    assert "doc-private" not in {e["document_id"] for e in res["evidence"]}
    mehmet = retrieve(c, "Karma tabloları zincirleme yük faktörü", ["doc-private"], user="u-mehmet")
    assert {e["document_id"] for e in mehmet["evidence"]} == {"doc-private"}


def test_deleted_and_reindexed_documents_through_retrieval(indexed):
    h = indexed
    c = app_for(h)
    h.service.delete_chunks("doc-hash", h.collection)
    r = c.post("/api/v1/rag/retrieve", headers=AUTH, json={
        "question": "Karma tabloları", "scope": {"user_id": "u-ayse", "course_id": COURSE, "document_ids": ["doc-hash"]}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "INDEX_NOT_READY"
    ingest(h, "doc-hash", "notes_tr.pdf", document_type="notes", job_id="job-reindex", kind="REINDEX")
    res = retrieve(c, "Karma tabloları zincirleme", ["doc-hash"])
    assert res["evidence"] and all(e["chunk_id"].startswith("doc-hash:c1:") for e in res["evidence"])


def test_threaded_end_to_end_smoke(tmp_path, chroma_client, collection_name, settings, embedder):
    """wbs2-handoff.md §12: POST a job over HTTP → real worker thread → events at the stub →
    POST /api/v1/rag/retrieve returns the document's chunks."""
    from tests.ingest.support import make_harness

    h = make_harness(tmp_path, chroma_client, collection_name, settings, embedder)
    service = build_service(h.ingest_settings, h.components, chroma_client=h.chroma_factory,
                            callback_transport=httpx.MockTransport(h.stub.handler), worker_id="ai-thread")
    app = create_app(h.components)
    mount(app, service)
    c = TestClient(app)
    req = h.request("doc-e2e")
    assert c.post("/api/v1/ingestion/jobs", json=req, headers=AUTH).status_code == 202
    assert service.worker.wait_idle(timeout=30)
    assert [t for t, _ in h.stub.types(req["job_id"])][-1] == "SUCCEEDED"
    res = retrieve(c, "İkili arama ağacı dengesizleşirse en kötü durum", ["doc-e2e"])
    assert res["evidence"][0]["chunk_id"] == "doc-e2e:c1:002" and res["evidence"][0]["label"] == "Slayt · s.2"
    service.worker.shutdown(1)
