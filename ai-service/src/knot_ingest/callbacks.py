"""Python → NestJS status callbacks (api-contracts.md §9).

* Base URL from configuration only (no SSRF); `Authorization: Bearer INGEST_CALLBACK_TOKEN`.
* `seq` strictly increases per job (heartbeats count) and is assigned under a lock, in send
  order.
* STAGE/HEARTBEAT are best-effort; SUCCEEDED/FAILED are retried on 5xx/timeout with backoff
  (1, 2, 4 … 30 s) for up to `terminal_retry_seconds`.
* 409 (STALE_JOB, INVALID_TRANSITION), 401 and 422 mean: abort, write nothing more.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Callable
from urllib.parse import quote

import httpx

from knot_ingest.schemas import EventType, IngestionEvent, JobError, JobResult, Stage

log = logging.getLogger("knot_rag.ingest.callbacks")


class CallbackOutcome(str, Enum):
    APPLIED = "APPLIED"
    DUPLICATE = "DUPLICATE"  # 200 applied:false (seq already seen) — continue
    ABORT = "ABORT"  # 409 / 401 / 422 — stop the job without further writes
    DROPPED = "DROPPED"  # best-effort event not delivered (5xx / timeout)
    GAVE_UP = "GAVE_UP"  # terminal event not delivered within the retry window
    SUPPRESSED = "SUPPRESSED"  # emitter already closed; nothing sent


_RETRY_4XX = {408, 425, 429}


class CallbackClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 10.0,
        terminal_retry_seconds: float = 120.0,
        max_backoff: float = 30.0,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._base = base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {token}"}
        self._http = httpx.Client(timeout=timeout, transport=transport)
        self._terminal_retry = terminal_retry_seconds
        self._max_backoff = max_backoff
        self._sleep = sleep
        self._clock = clock

    def url(self, job_id: str) -> str:
        return f"{self._base}/internal/v1/ingestion-jobs/{quote(job_id, safe='')}/events"

    def _post_once(self, event: IngestionEvent) -> tuple[int | None, dict]:
        try:
            r = self._http.post(self.url(event.job_id), json=event.model_dump(mode="json"), headers=self._headers)
        except httpx.HTTPError as exc:
            log.warning("ingest.callback.transport_error",
                        extra={"job_id": event.job_id, "seq": event.seq, "error_type": type(exc).__name__})
            return None, {}
        try:
            body = r.json() if r.content else {}
        except ValueError:
            body = {}
        return r.status_code, body if isinstance(body, dict) else {}

    def send(self, event: IngestionEvent) -> CallbackOutcome:
        terminal = event.type in (EventType.SUCCEEDED, EventType.FAILED)
        deadline = self._clock() + self._terminal_retry
        delay = 1.0
        while True:
            status, body = self._post_once(event)
            if status is not None and 200 <= status < 300:
                return CallbackOutcome.DUPLICATE if body.get("applied") is False else CallbackOutcome.APPLIED
            if status is not None and 400 <= status < 500 and status not in _RETRY_4XX:
                err = body.get("error") if isinstance(body.get("error"), dict) else {}
                log.warning("ingest.callback.rejected", extra={
                    "job_id": event.job_id, "seq": event.seq, "status": status, "code": err.get("code") or body.get("code"),
                })
                return CallbackOutcome.ABORT
            if not terminal:
                return CallbackOutcome.DROPPED
            if self._clock() + delay > deadline:
                log.error("ingest.callback.gave_up", extra={"job_id": event.job_id, "seq": event.seq, "type": event.type.value})
                return CallbackOutcome.GAVE_UP
            self._sleep(delay)
            delay = min(delay * 2, self._max_backoff)

    def close(self) -> None:
        self._http.close()


class EventEmitter:
    """Sequenced events for one job. Thread-safe (worker thread + heartbeat timer)."""

    def __init__(self, client: CallbackClient, *, job_id: str, document_id: str, attempt: int, worker_id: str):
        self._client = client
        self._job_id = job_id
        self._document_id = document_id
        self._attempt = attempt
        self._worker_id = worker_id
        self._seq = 0
        self._lock = threading.Lock()
        self.aborted = threading.Event()  # set when NestJS told us to stop
        self._closed = False
        self.stage: Stage | None = None
        self.progress: float = 0.0

    @property
    def closed(self) -> bool:
        return self._closed

    def emit(
        self,
        type_: EventType,
        stage: Stage | None,
        progress: float | None = None,
        *,
        result: JobResult | None = None,
        error: JobError | None = None,
        final: bool = False,
    ) -> CallbackOutcome:
        with self._lock:
            if self._closed or (self.aborted.is_set() and not final):
                return CallbackOutcome.SUPPRESSED
            if final:
                self._closed = True
            if type_ is EventType.STAGE and stage is not None:
                self.stage = stage
            if progress is not None:
                self.progress = progress
            self._seq += 1
            event = IngestionEvent(
                job_id=self._job_id, document_id=self._document_id, attempt=self._attempt, seq=self._seq,
                worker_id=self._worker_id, type=type_, stage=stage, progress=progress,
                emitted_at=datetime.now(timezone.utc).replace(microsecond=0), result=result, error=error,
            )
            outcome = self._client.send(event)
        if outcome is CallbackOutcome.ABORT:
            self.aborted.set()
        log.info("ingest.event", extra={"job_id": self._job_id, "seq": event.seq, "type": type_.value,
                                         "stage": stage.value if stage else None, "outcome": outcome.value})
        return outcome

    def heartbeat(self) -> CallbackOutcome:
        return self.emit(EventType.HEARTBEAT, self.stage, self.progress)


class Heartbeat:
    """Sends HEARTBEAT every `interval` seconds while a job runs, independent of how long a
    single embedding batch takes."""

    def __init__(self, emitter: EventEmitter, interval: float):
        self._emitter = emitter
        self._interval = interval
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="ingest-heartbeat", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            if self._emitter.closed or self._emitter.aborted.is_set():
                return
            self._emitter.heartbeat()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=self._interval + 5)
