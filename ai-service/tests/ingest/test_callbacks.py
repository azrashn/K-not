"""T14: sequencing and delivery rules of Python → NestJS callbacks (api-contracts.md §9)."""

import threading

import httpx

from knot_ingest.callbacks import CallbackClient, CallbackOutcome, EventEmitter
from knot_ingest.schemas import EventType, JobError, JobResult, Stage

RESULT = JobResult(page_count=1, chunk_count=1, indexing_version="c1", collection="knot_chunks_v1",
                   embedding_fingerprint="sha256:" + "0" * 64, pages_artifact_key="documents/d/pages.c1.json")


class Recorder:
    def __init__(self, statuses=None, body=None):
        self.statuses = list(statuses or [])
        self.body = body or {"applied": True}
        self.requests: list[httpx.Request] = []
        self.lock = threading.Lock()

    def __call__(self, request):
        with self.lock:
            self.requests.append(request)
            status = self.statuses.pop(0) if self.statuses else 200
        if status == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(status, json=self.body if status == 200 else {"error": {"code": "STALE_JOB"}})


def make(recorder, *, clock=None, window=120.0):
    sleeps: list[float] = []
    kw = {"clock": clock} if clock else {}
    client = CallbackClient("http://nest.internal/", "tok", transport=httpx.MockTransport(recorder),
                            sleep=sleeps.append, terminal_retry_seconds=window, **kw)
    em = EventEmitter(client, job_id="job-1", document_id="doc-1", attempt=1, worker_id="ai-test")
    return em, sleeps


def test_url_auth_and_body():
    rec = Recorder()
    em, _ = make(rec)
    assert em.emit(EventType.STAGE, Stage.EXTRACTING, 0.1) is CallbackOutcome.APPLIED
    req = rec.requests[0]
    assert str(req.url) == "http://nest.internal/internal/v1/ingestion-jobs/job-1/events"
    assert req.headers["authorization"] == "Bearer tok"
    body = httpx.Response(200, content=req.content).json()
    assert body["seq"] == 1 and body["schema_version"] == "ingest.v1" and body["emitted_at"].endswith("Z")


def test_seq_is_strictly_increasing_under_concurrency():
    rec = Recorder()
    em, _ = make(rec)
    threads = [threading.Thread(target=em.heartbeat) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    em.emit(EventType.SUCCEEDED, Stage.INDEXING, 1.0, result=RESULT, final=True)
    seqs = [httpx.Response(200, content=r.content).json()["seq"] for r in rec.requests]
    assert seqs == list(range(1, 22))  # arrival order == seq order, no gaps
    assert em.emit(EventType.HEARTBEAT, Stage.INDEXING) is CallbackOutcome.SUPPRESSED  # closed after terminal


def test_terminal_events_are_retried_on_5xx_and_timeouts():
    rec = Recorder([503, "timeout", 502, 200])
    em, sleeps = make(rec)
    assert em.emit(EventType.SUCCEEDED, Stage.INDEXING, 1.0, result=RESULT, final=True) is CallbackOutcome.APPLIED
    assert len(rec.requests) == 4 and sleeps == [1.0, 2.0, 4.0]
    seqs = {httpx.Response(200, content=r.content).json()["seq"] for r in rec.requests}
    assert seqs == {1}  # a retry resends the same event


def test_terminal_retry_gives_up_after_the_window():
    now = [0.0]
    rec = Recorder([500] * 100)
    em, sleeps = make(rec, clock=lambda: now[0], window=120.0)
    sleeps_proxy = sleeps

    def advance(d):
        sleeps_proxy.append(d)
        now[0] += d

    em._client._sleep = advance
    err = JobError(code="INTERNAL", message="x", retryable=True)
    assert em.emit(EventType.FAILED, Stage.EMBEDDING, 0.5, error=err, final=True) is CallbackOutcome.GAVE_UP
    assert sum(sleeps) <= 120 and max(sleeps) == 30.0


def test_best_effort_events_are_dropped_not_retried():
    rec = Recorder([503])
    em, sleeps = make(rec)
    assert em.emit(EventType.STAGE, Stage.CHUNKING, 0.3) is CallbackOutcome.DROPPED
    assert len(rec.requests) == 1 and sleeps == []
    assert em.heartbeat() is CallbackOutcome.APPLIED  # seq continues
    assert httpx.Response(200, content=rec.requests[-1].content).json()["seq"] == 2


def test_409_aborts_and_suppresses_further_events():
    rec = Recorder([409])
    em, _ = make(rec)
    assert em.emit(EventType.STAGE, Stage.CHUNKING, 0.3) is CallbackOutcome.ABORT
    assert em.aborted.is_set()
    assert em.heartbeat() is CallbackOutcome.SUPPRESSED
    assert len(rec.requests) == 1


def test_401_and_422_abort():
    for status in (401, 422):
        em, _ = make(Recorder([status]))
        assert em.emit(EventType.STAGE, Stage.EXTRACTING) is CallbackOutcome.ABORT


def test_duplicate_event_response_continues():
    em, _ = make(Recorder(body={"applied": False, "reason": "DUPLICATE_EVENT"}))
    assert em.emit(EventType.STAGE, Stage.EXTRACTING) is CallbackOutcome.DUPLICATE
    assert not em.aborted.is_set()
