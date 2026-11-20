"""The job algorithm against the NestJS stub, an in-memory Chroma and temp storage
(wbs2-handoff.md §4, §11: T3, T5–T7, T9, T11, T13, T15, T16; plus failure, interruption,
reindex, deletion and migration scenarios). Embeddings use HashingEmbedder (deterministic mock)."""

import json
import logging
import time

import pytest

from knot_ingest.errors import IngestApiError
from knot_rag.retrieval.chroma_index import ChromaChunkWriter
from knot_rag.retrieval.embedding import HashingEmbedder
from knot_rag.schemas.documents import IndexedChunk
from knot_rag.schemas.embedding import EmbeddingConfiguration
from tests.ingest.support import fixture_bytes

DOC = "doc-avl-1"
SUCCESS_FLOW = [("STAGE", "EXTRACTING"), ("STAGE", "EXTRACTING"), ("STAGE", "CHUNKING"), ("STAGE", "EMBEDDING"),
                ("STAGE", "INDEXING"), ("SUCCEEDED", "INDEXING")]


def failed_error(h, job_id):
    (ev,) = [e for e in h.stub.events(job_id) if e["type"] == "FAILED"]
    return ev["stage"], ev["error"]


def test_success_events_chunks_and_artifact(harness):
    h = harness
    req = h.request(DOC)
    status, accepted = h.submit_and_run(req)
    assert status == 202 and not accepted.duplicate
    assert h.stub.types(req["job_id"]) == SUCCESS_FLOW
    assert h.stub.events(req["job_id"])[1]["result"]["page_count"] == 5
    assert h.stub.documents[DOC].status == "READY"
    result = h.stub.jobs[req["job_id"]].result
    assert result["chunk_count"] == 4 and result["warnings"] == ["PAGES_WITHOUT_TEXT:1"]
    assert result["embedding_fingerprint"] == h.config.fingerprint()

    recs = h.collection_records(DOC)
    assert sorted(recs["ids"]) == [f"{DOC}:c1:00{i}" for i in range(1, 5)]
    assert {m["x_job_id"] for m in recs["metadatas"]} == {req["job_id"]}
    assert {m["page_count"] for m in recs["metadatas"]} == {5}

    art = h.artifact(DOC)
    text = "\n\n".join(p["text"] for p in art["pages"])
    for cid, chunk_text, m in zip(recs["ids"], recs["documents"], recs["metadatas"]):
        assert chunk_text == text[m["char_start"]:m["char_end"]]
        page = art["pages"][m["page_start"] - 1]
        assert page["char_start"] <= m["char_start"] < page["char_end"]
    meta = h.chroma.get_collection(h.collection).metadata
    assert meta["embedding_fingerprint"] == h.config.fingerprint() and meta["index_version_id"] == "iv-test-1"


def test_determinism_two_runs_identical(harness):
    """T3: same file + same indexing_version → identical chunk ids, texts, offsets and artifact."""
    h = harness
    h.submit_and_run(h.request(DOC))
    first = h.collection_records(DOC)
    art1 = (h.root / f"documents/{DOC}/pages.c1.json").read_bytes()
    h.submit_and_run(h.request(DOC, attempt=2, kind="RETRY"))
    second = h.collection_records(DOC)
    art2 = (h.root / f"documents/{DOC}/pages.c1.json").read_bytes()
    strip = lambda r: sorted((i, d, {k: v for k, v in m.items() if k != "x_job_id"})  # noqa: E731
                             for i, d, m in zip(r["ids"], r["documents"], r["metadatas"]))
    assert strip(first) == strip(second) and art1 == art2
    assert {m["x_job_id"] for m in second["metadatas"]} == {f"job-{DOC}-2"}


def test_delete_first_removes_partial_earlier_writes(harness):
    """T5: a partial earlier write (incl. an id the new run will not produce) + rerun → exactly chunk_count."""
    h = harness
    req = h.request(DOC)
    writer = ChromaChunkWriter(h.chroma, h.collection, h.components.embedder, configuration=h.config,
                               index_version_id="iv-test-1")
    junk = IndexedChunk.model_validate({
        "chunk_id": f"{DOC}:c1:099", "text": "eski yarım yazım",
        "document": {**req["document"], "page_count": 5}, "location": {"page_start": 1},
        "extra": {"job_id": "job-crashed"},
    })
    writer.upsert([junk, junk.model_copy(update={"chunk_id": f"{DOC}:c1:001"})])
    h.submit_and_run(req)
    recs = h.collection_records(DOC)
    assert len(recs["ids"]) == h.stub.jobs[req["job_id"]].result["chunk_count"] == 4
    assert f"{DOC}:c1:099" not in recs["ids"]
    assert {m["x_job_id"] for m in recs["metadatas"]} == {req["job_id"]}


def test_foreign_chunk_written_concurrently_is_removed(harness, monkeypatch):
    """T6: a stale worker's write appearing before verification is detected and deleted."""
    h = harness
    req = h.request(DOC)
    original = ChromaChunkWriter.upsert

    def upsert_with_stale_writer(self, chunks, embeddings=None, batch_size=128):
        n = original(self, chunks, embeddings=embeddings, batch_size=batch_size)
        stale = chunks[0].model_copy(update={"chunk_id": f"{DOC}:c1:777", "extra": {"job_id": "job-stale"}})
        original(self, [stale], embeddings=[embeddings[0]])
        return n

    monkeypatch.setattr(ChromaChunkWriter, "upsert", upsert_with_stale_writer)
    h.submit_and_run(req)
    assert h.stub.jobs[req["job_id"]].status == "SUCCEEDED"
    recs = h.collection_records(DOC)
    assert len(recs["ids"]) == 4 and {m["x_job_id"] for m in recs["metadatas"]} == {req["job_id"]}


def test_unrecoverable_verification_mismatch_fails_retryable(harness, monkeypatch):
    """T6: foreign chunks that cannot be removed → VERIFICATION_FAILED (retryable), no artifact."""
    h = harness
    req = h.request(DOC)
    original_upsert = ChromaChunkWriter.upsert
    original_delete = ChromaChunkWriter.delete_document

    def upsert(self, chunks, embeddings=None, batch_size=128):
        n = original_upsert(self, chunks, embeddings=embeddings, batch_size=batch_size)
        stale = chunks[0].model_copy(update={"chunk_id": f"{DOC}:c1:777", "extra": {"job_id": "job-stale"}})
        original_upsert(self, [stale], embeddings=[embeddings[0]])
        return n

    def delete(self, document_id, exclude_job_id=None):
        return 0 if exclude_job_id else original_delete(self, document_id)

    monkeypatch.setattr(ChromaChunkWriter, "upsert", upsert)
    monkeypatch.setattr(ChromaChunkWriter, "delete_document", delete)
    h.submit_and_run(req)
    stage, error = failed_error(h, req["job_id"])
    assert stage == "INDEXING" and error["code"] == "VERIFICATION_FAILED" and error["retryable"] is True
    assert h.artifact(DOC) is None


def test_stale_job_response_stops_before_the_next_write(harness):
    """T7: NestJS answers 409 STALE_JOB (document deleted / job superseded) → no Chroma writes."""
    h = harness
    req = h.request(DOC)

    def supersede(event):
        if event["type"] == "STAGE" and event["stage"] == "EMBEDDING":
            h.stub.cancel(req["job_id"])

    h.stub.on_event = supersede
    h.submit_and_run(req)
    events = h.stub.events(req["job_id"])
    assert events[-1]["stage"] == "EMBEDDING" and h.stub.responses[-1][0] == 409  # nothing after the 409
    assert h.collection_records(DOC)["ids"] == []
    assert h.artifact(DOC) is None
    assert DOC not in h.service.worker.active_document_ids()  # lock released


def test_local_cancel_flag_stops_the_job_without_events(harness):
    h = harness
    req = h.request(DOC)
    h.service.accept(req)
    h.service.delete_chunks(DOC, h.collection)  # DELETE …/chunks while queued
    h.service.worker.run_pending()
    assert h.stub.events(req["job_id"]) == []
    assert h.collection_records(DOC)["ids"] == [] and h.artifact(DOC) is None


def test_stamp_change_between_accept_and_run_fails_without_writing(harness):
    """T9 (runtime): the collection appears with another stamp after the job was accepted."""
    h = harness
    req = h.request(DOC)
    h.service.accept(req)
    other = h.config.model_copy(update={"revision": "different-revision"})
    ChromaChunkWriter(h.chroma, h.collection, h.components.embedder, configuration=other).ensure_collection()
    h.service.worker.run_pending()
    stage, error = failed_error(h, req["job_id"])
    assert stage == "INDEXING" and error == {"code": "INDEX_CONFIG_MISMATCH", "message": error["message"], "retryable": False}
    assert h.chroma.get_collection(h.collection).count() == 0


@pytest.mark.parametrize("pdf,code", [
    ("scanned.pdf", "NO_TEXT_LAYER"),
    ("encrypted.pdf", "ENCRYPTED_PDF"),
    (b"%PDF-1.7\nnot really a pdf", "CORRUPT_PDF"),
    (b"GIF89a not a pdf", "UNSUPPORTED_FORMAT"),
])
def test_unusable_sources_fail_not_retryable(harness, pdf, code):
    """T11 (job level) and corrupted PDFs."""
    h = harness
    req = h.request(DOC, pdf)
    h.submit_and_run(req)
    stage, error = failed_error(h, req["job_id"])
    assert (stage, error["code"], error["retryable"]) == ("EXTRACTING", code, False)
    assert h.stub.documents[DOC].status == "FAILED"
    assert h.collection_records(DOC)["ids"] == [] and h.artifact(DOC) is None


def test_too_many_pages(harness):
    h = harness.build(max_pages=3)
    req = h.request(DOC)
    h.submit_and_run(req)
    assert failed_error(h, req["job_id"])[1]["code"] == "TOO_LARGE"


def test_checksum_mismatch_and_missing_source(harness):
    h = harness
    req = h.request(DOC)
    (h.root / req["source"]["storage_key"]).write_bytes(fixture_bytes("notes_tr.pdf"))  # replaced on disk
    h.submit_and_run(req)
    assert failed_error(h, req["job_id"])[1] == {
        "code": "SOURCE_CHECKSUM_MISMATCH", "message": "The source file does not match its checksum.", "retryable": False}

    req2 = h.request("doc-missing")
    (h.root / req2["source"]["storage_key"]).unlink()
    h.submit_and_run(req2)
    assert failed_error(h, req2["job_id"])[1]["code"] == "SOURCE_NOT_FOUND"


def test_embedding_failure_is_retryable(harness):
    h = harness
    req = h.request(DOC)

    class Broken(HashingEmbedder):
        def embed_documents(self, texts):
            raise RuntimeError("CUDA out of memory")

    h.service.embedders._items.clear()
    h.service.embedders._factory = lambda *a, **k: Broken()
    h.submit_and_run(req)
    stage, error = failed_error(h, req["job_id"])
    assert (stage, error["code"], error["retryable"]) == ("EMBEDDING", "EMBEDDING_FAILED", True)
    assert "out of memory" not in error["message"]  # only the exception type is reported


def test_chroma_unavailable_during_indexing_is_retryable(harness, monkeypatch):
    """Failed indexing: Chroma goes down after the job was accepted."""
    h = harness
    req = h.request(DOC)
    h.service.accept(req)
    h.client_ok["up"] = False
    h.service.worker.run_pending()
    stage, error = failed_error(h, req["job_id"])
    assert (stage, error["code"], error["retryable"]) == ("INDEXING", "INDEX_UNAVAILABLE", True)
    assert h.artifact(DOC) is None


class Crash(BaseException):
    """Simulates the process dying (not an Exception, so nothing classifies it)."""


def test_interrupted_job_is_recovered_by_the_retry(harness, monkeypatch):
    """Python dies mid-INDEXING after a partial write; NestJS's sweeper marks it STALLED and
    dispatches a RETRY, which leaves exactly the right chunks (document-lifecycle.md §4.3)."""
    h = harness.build(embed_batch_size=1)
    req = h.request("doc-notes", "notes_tr.pdf", document_type="notes")
    original = ChromaChunkWriter.upsert
    calls = {"n": 0}

    def crash_after_first_batch(self, chunks, embeddings=None, batch_size=128):
        calls["n"] += 1
        original(self, chunks[:1], embeddings=embeddings[:1])
        raise Crash()

    monkeypatch.setattr(ChromaChunkWriter, "upsert", crash_after_first_batch)
    h.service.accept(req)
    with pytest.raises(Crash):
        h.service.worker.run_pending()
    assert [t for t, _ in h.stub.types(req["job_id"])] == ["STAGE"] * 5  # no terminal event
    assert len(h.collection_records("doc-notes")["ids"]) == 1 and h.artifact("doc-notes") is None

    monkeypatch.setattr(ChromaChunkWriter, "upsert", original)
    h.stub.jobs[req["job_id"]].status = "FAILED"  # sweeper: STALLED
    h.build()  # process restart: a fresh, empty in-memory registry
    retry = h.request("doc-notes", "notes_tr.pdf", document_type="notes", attempt=2, kind="RETRY")
    h.submit_and_run(retry)
    result = h.stub.jobs[retry["job_id"]].result
    recs = h.collection_records("doc-notes")
    assert len(recs["ids"]) == result["chunk_count"] and {m["x_job_id"] for m in recs["metadatas"]} == {retry["job_id"]}
    assert h.artifact("doc-notes") is not None


def test_heartbeats_continue_during_slow_embedding(harness):
    """T13."""
    h = harness.build(heartbeat_seconds=0.05, embed_batch_size=1)

    class Slow(HashingEmbedder):
        def embed_documents(self, texts):
            time.sleep(0.12)
            return super().embed_documents(texts)

    h.service.embedders._items.clear()
    h.service.embedders._factory = lambda *a, **k: Slow()
    req = h.request(DOC)
    h.submit_and_run(req)
    events = h.stub.events(req["job_id"])
    beats = [e for e in events if e["type"] == "HEARTBEAT"]
    assert len([b for b in beats if b["stage"] == "EMBEDDING"]) >= 3
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["type"] == "SUCCEEDED"
    assert h.stub.jobs[req["job_id"]].status == "SUCCEEDED"


def test_artifact_is_written_only_after_verification(harness, monkeypatch):
    """T15: when the artifact is written, the chunks are already verified in Chroma."""
    h = harness
    req = h.request(DOC)
    storage = h.service.storage
    original = storage.write_atomic
    seen = {}

    def spy(key, data):
        recs = h.collection_records(DOC)
        seen["chunks_at_write"] = len(recs["ids"])
        seen["events_before"] = [e["type"] for e in h.stub.events(req["job_id"])]
        return original(key, data)

    monkeypatch.setattr(storage, "write_atomic", spy)
    h.submit_and_run(req)
    assert seen["chunks_at_write"] == 4 and "SUCCEEDED" not in seen["events_before"]
    art = h.artifact(DOC)
    assert art["schema_version"] == "pages.v1" and art["page_count"] == 5


def test_artifact_write_failure(harness, monkeypatch):
    h = harness
    req = h.request(DOC)

    def broken(key, data):
        raise OSError("disk full")

    monkeypatch.setattr(h.service.storage, "write_atomic", broken)
    h.submit_and_run(req)
    stage, error = failed_error(h, req["job_id"])
    assert (stage, error["code"], error["retryable"]) == ("INDEXING", "STORAGE_WRITE_FAILED", True)
    assert not (h.root / f"documents/{DOC}/pages.c1.json").exists()


def test_no_document_text_in_logs(harness, caplog):
    """T16."""
    h = harness
    secrets = ["İkili Arama", "dengesizleşirse", "Denge Koşulu", "Karma tabloları", "Zincirleme", "haftalarda"]
    with caplog.at_level(logging.DEBUG):
        h.submit_and_run(h.request(DOC))
        h.submit_and_run(h.request("doc-notes", "notes_tr.pdf", document_type="notes"))
        bad = h.request("doc-bad", "notes_tr.pdf", document_type="notes")
        h.service.embedders._items.clear()
        h.service.embedders._factory = lambda *a, **k: None  # → accept fails, then a run failure below
        with pytest.raises(IngestApiError):
            h.service.accept(bad)
    assert caplog.records
    for r in caplog.records:
        blob = json.dumps({k: str(v) for k, v in vars(r).items()}, ensure_ascii=False)
        for s in secrets:
            assert s not in blob, (r.name, r.getMessage())


def test_reindex_replaces_chunks_and_old_versions_disappear(harness):
    h = harness
    h.submit_and_run(h.request(DOC))
    # A chunk left from an older indexing version of the same document.
    writer = ChromaChunkWriter(h.chroma, h.collection, h.components.embedder, configuration=h.config)
    rec = h.collection_records(DOC)
    old = IndexedChunk.from_chroma(rec["ids"][0], rec["documents"][0], rec["metadatas"][0])
    writer.upsert([old.model_copy(update={"chunk_id": f"{DOC}:c0:001",
                                          "document": old.document.model_copy(update={"indexing_version": "c0"})})])
    req = h.request(DOC, job_id="job-reindex", kind="REINDEX")
    h.submit_and_run(req)
    recs = h.collection_records(DOC)
    assert sorted(recs["ids"]) == [f"{DOC}:c1:00{i}" for i in range(1, 5)]
    assert {m["x_job_id"] for m in recs["metadatas"]} == {"job-reindex"}
    assert h.stub.documents[DOC].status == "READY"


def test_deletion_removes_chunks_and_is_idempotent(harness):
    h = harness
    h.submit_and_run(h.request(DOC))
    h.submit_and_run(h.request("doc-other", "notes_tr.pdf", document_type="notes"))
    assert h.service.delete_chunks(DOC, h.collection).deleted == 4
    assert h.service.delete_chunks(DOC, h.collection).deleted == 0
    assert h.collection_records(DOC)["ids"] == []
    assert h.collection_records("doc-other")["ids"]  # other documents untouched
    assert h.service.delete_chunks(DOC, "no_such_collection").deleted == 0


def test_migration_writes_only_the_building_collection(harness):
    h = harness
    h.submit_and_run(h.request(DOC))
    v2 = EmbeddingConfiguration(backend="hashing", model="knot-hashing-v1", dimension=256)
    req = h.request(DOC, job_id="job-mig", kind="MIGRATION", config=v2, collection=f"{h.collection}_v2",
                    index_version_id="iv-test-2")
    h.stub.documents[DOC].status = "READY"
    status, _ = h.submit_and_run(req)
    assert status == 202 and h.stub.jobs["job-mig"].status == "SUCCEEDED"
    assert h.stub.documents[DOC].status == "READY"  # MIGRATION never changes the document status
    v1 = h.collection_records(DOC)
    v2_recs = h.collection_records(DOC, collection=f"{h.collection}_v2")
    assert {m["x_job_id"] for m in v1["metadatas"]} == {f"job-{DOC}-1"}  # untouched
    assert {m["x_job_id"] for m in v2_recs["metadatas"]} == {"job-mig"}
    assert h.chroma.get_collection(f"{h.collection}_v2").metadata["embedding_dim"] == 256


def test_shutdown_reports_queued_jobs_as_worker_shutdown(harness):
    h = harness
    req = h.request(DOC)
    h.service.accept(req)
    h.service.worker.shutdown(0)
    (ev,) = h.stub.events(req["job_id"])
    assert ev["type"] == "FAILED" and ev["error"]["code"] == "WORKER_SHUTDOWN" and ev["error"]["retryable"] is True
    with pytest.raises(IngestApiError) as err:
        h.service.accept(h.request("doc-late"))
    assert err.value.status == 503
