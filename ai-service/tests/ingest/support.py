"""Test support for WBS-2: a NestJS callback stub applying document-lifecycle.md §3.3, and a
harness wiring the ingestion service to an in-memory Chroma, temp storage and the stub."""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

import httpx

from knot_ingest.bootstrap import build_service
from knot_ingest.config import IngestSettings
from knot_rag.bootstrap import build_components
from knot_rag.schemas.embedding import EmbeddingConfiguration

FIXTURES = Path(__file__).parent / "fixtures"
CALLBACK_TOKEN = "cb-test-token"
NEST_URL = "http://nest.internal:3000"
STAGES = ["EXTRACTING", "CHUNKING", "EMBEDDING", "INDEXING"]
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED"}


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@dataclass
class StubJob:
    job_id: str
    document_id: str
    attempt: int
    kind: str
    collection: str
    fingerprint: str
    indexing_version: str
    status: str = "DISPATCHED"
    stage: str | None = None
    last_seq: int = 0
    result: dict | None = None
    error: dict | None = None


@dataclass
class StubDocument:
    document_id: str
    active_job_id: str | None = None
    status: str = "UPLOADED"
    deleted: bool = False
    chunk_count: int | None = None


class NestStub:
    """Applies events like NestJS would (one 'transaction' per event, under a lock)."""

    def __init__(self, token: str = CALLBACK_TOKEN):
        self.token = token
        self.jobs: dict[str, StubJob] = {}
        self.documents: dict[str, StubDocument] = {}
        self.received: list[dict] = []  # every request body, in arrival order
        self.responses: list[tuple[int, str]] = []  # (status, job_id:seq)
        self.fail_with: list[int] = []  # statuses returned (without applying) for the next requests
        self.on_event: Callable[[dict], None] | None = None
        self._lock = threading.Lock()

    def register(self, req: dict) -> None:
        doc = self.documents.setdefault(req["document"]["document_id"], StubDocument(req["document"]["document_id"]))
        doc.active_job_id = req["job_id"]
        if req["kind"] != "MIGRATION":
            doc.status = "UPLOADED"
        self.jobs[req["job_id"]] = StubJob(
            req["job_id"], doc.document_id, req["attempt"], req["kind"], req["index"]["collection"],
            req["index"]["embedding_fingerprint"], req["document"]["indexing_version"],
        )

    def cancel(self, job_id: str) -> None:
        """What a NestJS delete or supersede does: job CANCELLED, document no longer points to it."""
        job = self.jobs[job_id]
        job.status = "CANCELLED"
        doc = self.documents[job.document_id]
        if doc.active_job_id == job_id:
            doc.active_job_id = None

    def events(self, job_id: str | None = None, applied_only: bool = False) -> list[dict]:
        out = [e for e in self.received if job_id is None or e["job_id"] == job_id]
        if applied_only:
            ok = {k for s, k in self.responses if s == 200}
            out = [e for e in out if f"{e['job_id']}:{e['seq']}" in ok]
        return out

    def types(self, job_id: str) -> list[tuple[str, str | None]]:
        return [(e["type"], e["stage"]) for e in self.events(job_id) if e["type"] != "HEARTBEAT"]

    def _reply(self, status: int, body: dict, key: str) -> httpx.Response:
        self.responses.append((status, key))
        return httpx.Response(status, json=body)

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return httpx.Response(401, json={"error": {"code": "UNAUTHENTICATED"}})
        e = json.loads(request.content)
        key = f"{e['job_id']}:{e['seq']}"
        with self._lock:
            self.received.append(e)
            assert request.url.path == f"/internal/v1/ingestion-jobs/{e['job_id']}/events"
            if self.on_event:
                self.on_event(e)
            if self.fail_with:
                return self._reply(self.fail_with.pop(0), {"error": {"code": "INTERNAL"}}, key)
            job = self.jobs.get(e["job_id"])
            if job is None:
                return self._reply(404, {"error": {"code": "NOT_FOUND"}}, key)
            doc = self.documents[job.document_id]
            if job.status in TERMINAL or doc.active_job_id != job.job_id or doc.deleted:
                return self._reply(409, {"error": {"code": "STALE_JOB"}}, key)
            if e["seq"] <= job.last_seq:
                return self._reply(200, {"applied": False, "reason": "DUPLICATE_EVENT"}, key)
            if e["attempt"] != job.attempt or e["document_id"] != job.document_id:
                return self._reply(422, {"error": {"code": "VALIDATION_ERROR"}}, key)
            t, stage = e["type"], e.get("stage")
            if t == "STAGE":
                if job.stage is not None and STAGES.index(stage) < STAGES.index(job.stage):
                    return self._reply(409, {"error": {"code": "INVALID_TRANSITION"}}, key)
                job.status, job.stage = "RUNNING", stage
                if job.kind != "MIGRATION":
                    doc.status = stage
            elif t == "HEARTBEAT":
                job.status = "RUNNING"
            elif t == "SUCCEEDED":
                r = e["result"]
                if (stage != "INDEXING" or job.stage != "INDEXING" or r["indexing_version"] != job.indexing_version
                        or r["collection"] != job.collection or r["embedding_fingerprint"] != job.fingerprint):
                    return self._reply(409, {"error": {"code": "INVALID_TRANSITION"}}, key)
                job.status, job.result = "SUCCEEDED", r
                doc.active_job_id = None
                if job.kind != "MIGRATION":
                    doc.status, doc.chunk_count = "READY", r["chunk_count"]
            elif t == "FAILED":
                job.status, job.error = "FAILED", e["error"]
                doc.active_job_id = None
                if job.kind != "MIGRATION":
                    doc.status = "FAILED"
            job.last_seq = e["seq"]
            return self._reply(200, {"applied": True}, key)


@dataclass
class Harness:
    root: Path
    stub: NestStub
    chroma: Any
    collection: str
    rag_settings: Any
    components: Any
    config: EmbeddingConfiguration
    ingest_settings: IngestSettings
    service: Any = None
    client_ok: dict = field(default_factory=lambda: {"up": True})

    def chroma_factory(self):
        if not self.client_ok["up"]:
            raise ConnectionError("chroma down")
        return self.chroma

    def build(self, **overrides) -> "Harness":
        self.ingest_settings = replace(self.ingest_settings, **overrides)
        self.service = build_service(
            self.ingest_settings, self.components, chroma_client=self.chroma_factory,
            callback_transport=httpx.MockTransport(self.stub.handler), callback_sleep=lambda s: None,
            worker_id="ai-test01", start=False,
        )
        return self

    def put_source(self, document_id: str, data: bytes) -> tuple[str, str]:
        key = f"documents/{document_id}/original.pdf"
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key, hashlib.sha256(data).hexdigest()

    def request(self, document_id: str, pdf: str | bytes = "slides_tr.pdf", *, job_id: str | None = None,
                course_id: str = "course-vy", owner_id: str = "u-ayse", document_type: str = "slide",
                title: str = "Hafta 4 — AVL Ağaçları", attempt: int = 1, kind: str = "INITIAL",
                config: EmbeddingConfiguration | None = None, collection: str | None = None,
                index_version_id: str = "iv-test-1", indexing_version: str = "c1", register: bool = True) -> dict:
        data = fixture_bytes(pdf) if isinstance(pdf, str) else pdf
        key, sha = self.put_source(document_id, data)
        cfg = config or self.config
        req = {
            "schema_version": "ingest.v1",
            "job_id": job_id or f"job-{document_id}-{attempt}",
            "attempt": attempt,
            "kind": kind,
            "document": {"document_id": document_id, "course_id": course_id, "owner_id": owner_id, "title": title,
                         "document_type": document_type, "indexing_version": indexing_version, "page_count": None},
            "source": {"storage_key": key, "mime_type": "application/pdf", "sha256": sha, "size_bytes": len(data),
                       "original_filename": "ders.pdf"},
            "index": {"index_version_id": index_version_id, "collection": collection or self.collection,
                      "embedding": cfg.model_dump(mode="json"), "embedding_fingerprint": cfg.fingerprint()},
        }
        if register:
            self.stub.register(req)
        return req

    def submit_and_run(self, req: dict) -> tuple[int, Any]:
        status, accepted = self.service.accept(req)
        self.service.worker.run_pending()
        return status, accepted

    def artifact(self, document_id: str, indexing_version: str = "c1") -> dict | None:
        p = self.root / f"documents/{document_id}/pages.{indexing_version}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def collection_records(self, document_id: str | None = None, collection: str | None = None) -> dict:
        names = {c.name for c in self.chroma.list_collections()}
        name = collection or self.collection
        if name not in names:
            return {"ids": [], "documents": [], "metadatas": []}
        col = self.chroma.get_collection(name)
        where = {"document_id": {"$eq": document_id}} if document_id else None
        return col.get(where=where, include=["documents", "metadatas"])


def make_harness(tmp_path: Path, chroma_client, collection_name: str, settings, embedder, **ingest) -> Harness:
    root = tmp_path / "storage"
    root.mkdir()
    rag = replace(settings, chroma_collection=collection_name)
    components = build_components(rag, embedder=embedder, chroma_client=chroma_client)
    config = EmbeddingConfiguration.from_settings(rag, embedder.dimension)
    s = IngestSettings(enabled=True, storage_root=str(root), nestjs_internal_url=NEST_URL, callback_token=CALLBACK_TOKEN,
                       heartbeat_seconds=60.0)
    h = Harness(root, NestStub(), chroma_client, collection_name, rag, components, config, s)
    return h.build(**ingest)
