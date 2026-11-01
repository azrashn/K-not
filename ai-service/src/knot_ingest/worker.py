"""Bounded in-process worker (ADR-009, document-lifecycle.md §4.1).

A bounded MVP solution, not a durable queue: nothing is persisted, so queued and running jobs
are lost on restart and recovered by the NestJS sweeper (STALLED → RETRY). Jobs are
idempotent (delete-first + `x_job_id` verification), so at-least-once execution is safe.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict, deque
from typing import Callable

from knot_ingest.errors import IngestApiError
from knot_ingest.pipeline import JobHandle
from knot_ingest.schemas import EventType, IngestErrorCode as E, JobError

log = logging.getLogger("knot_rag.ingest.worker")

FINISHED_MEMORY = 1000  # finished job ids remembered for duplicate detection


class IngestionWorker:
    def __init__(self, run: Callable[[JobHandle], None], *, concurrency: int = 1, capacity: int = 20,
                 emitter_factory: Callable | None = None):
        self._run = run
        self._concurrency = concurrency
        self._capacity = capacity
        self._emitter_factory = emitter_factory  # used to report WORKER_SHUTDOWN for queued jobs
        self._cond = threading.Condition()
        self._queue: deque[JobHandle] = deque()
        self._jobs: dict[str, JobHandle] = {}  # queued + running
        self._documents: dict[str, str] = {}  # document_id → job_id (per-document lock)
        self._finished: OrderedDict[str, str] = OrderedDict()
        self._threads: list[threading.Thread] = []
        self._accepting = True
        self._stopping = False

    def start(self) -> None:
        for i in range(self._concurrency):
            t = threading.Thread(target=self._loop, name=f"ingest-worker-{i}", daemon=True)
            t.start()
            self._threads.append(t)

    # -- accept -------------------------------------------------------------------------------

    def is_known(self, job_id: str) -> bool:
        with self._cond:
            return job_id in self._jobs or job_id in self._finished

    def queue_position(self, job_id: str) -> int:
        with self._cond:
            return next((i for i, h in enumerate(self._queue) if h.job_id == job_id), 0)

    def submit(self, handle: JobHandle) -> tuple[bool, int]:
        """Returns `(duplicate, queue_position)`; raises `IngestApiError` on back-pressure."""
        with self._cond:
            if handle.job_id in self._jobs or handle.job_id in self._finished:
                pos = next((i for i, h in enumerate(self._queue) if h.job_id == handle.job_id), 0)
                return True, pos
            if not self._accepting:
                raise IngestApiError(503, E.QUEUE_FULL, "The ingestion worker is shutting down.", retryable=True)
            holder = self._documents.get(handle.document_id)
            if holder is not None:
                raise IngestApiError(409, E.DOCUMENT_BUSY, "Another job for this document is queued or running.",
                                     retryable=True, details={"job_id": holder})
            if len(self._queue) >= self._capacity:
                raise IngestApiError(503, E.QUEUE_FULL, "The ingestion queue is full.", retryable=True)
            self._jobs[handle.job_id] = handle
            self._documents[handle.document_id] = handle.job_id
            self._queue.append(handle)
            self._cond.notify()
            return False, len(self._queue) - 1

    def cancel_document(self, document_id: str) -> bool:
        """Set the cancel flag of the local job holding this document (it stops at its next
        checkpoint without further writes or events)."""
        with self._cond:
            job_id = self._documents.get(document_id)
            handle = self._jobs.get(job_id) if job_id else None
        if handle is None:
            return False
        handle.cancel.set()
        log.info("ingest.job.cancel_requested", extra={"job_id": handle.job_id, "document_id": document_id})
        return True

    def active_document_ids(self) -> set[str]:
        with self._cond:
            return set(self._documents)

    def status(self) -> dict:
        with self._cond:
            return {"queued": len(self._queue), "running": sum(1 for h in self._jobs.values() if h.state == "RUNNING"),
                    "capacity": self._capacity, "accepting": self._accepting}

    # -- execution ----------------------------------------------------------------------------

    def _loop(self) -> None:
        while True:
            with self._cond:
                while not self._queue and not self._stopping:
                    self._cond.wait()
                if self._stopping and not self._queue:
                    return
                handle = self._queue.popleft()
                handle.state = "RUNNING"
            try:
                self._run(handle)
            except Exception:  # the runner classifies its own failures; this is a last resort
                log.error("ingest.worker.unexpected_error", extra={"job_id": handle.job_id})
            finally:
                self._release(handle)

    def _release(self, handle: JobHandle) -> None:
        with self._cond:
            handle.state = "DONE"
            self._jobs.pop(handle.job_id, None)
            if self._documents.get(handle.document_id) == handle.job_id:
                del self._documents[handle.document_id]
            self._finished[handle.job_id] = handle.outcome or "UNKNOWN"
            while len(self._finished) > FINISHED_MEMORY:
                self._finished.popitem(last=False)
            self._cond.notify_all()

    def run_pending(self) -> int:
        """Run queued jobs in the calling thread (tests and tools; do not combine with
        `start()`). Returns the number of jobs run."""
        n = 0
        while True:
            with self._cond:
                if not self._queue:
                    return n
                handle = self._queue.popleft()
                handle.state = "RUNNING"
            try:
                self._run(handle)
            finally:
                self._release(handle)
            n += 1

    def wait_idle(self, timeout: float) -> bool:
        """Block until no job is queued or running (or `timeout` seconds pass)."""
        with self._cond:
            return self._cond.wait_for(lambda: not self._jobs, timeout=timeout)

    # -- shutdown -----------------------------------------------------------------------------

    def shutdown(self, grace_seconds: float = 20.0) -> None:
        """Stop accepting; give running jobs `grace_seconds`; report WORKER_SHUTDOWN
        (retryable, best-effort) for queued jobs and for jobs still running afterwards."""
        with self._cond:
            self._accepting = False
            queued = list(self._queue)
            self._queue.clear()
            self._stopping = True
            self._cond.notify_all()
        for h in queued:
            h.cancel.set()
            self._report_shutdown(h)
            self._release(h)
        for t in self._threads:
            t.join(timeout=grace_seconds)
        with self._cond:
            running = [h for h in self._jobs.values() if h.state == "RUNNING"]
        for h in running:
            h.cancel.set()
            self._report_shutdown(h)
        log.info("ingest.worker.stopped", extra={"dropped_queued": len(queued), "interrupted_running": len(running)})

    def _report_shutdown(self, handle: JobHandle) -> None:
        em = handle.emitter
        if em is None and self._emitter_factory is not None:
            em = handle.emitter = self._emitter_factory(handle.request)
        if em is None:
            return
        try:
            em.emit(EventType.FAILED, em.stage, em.progress, final=True,
                    error=JobError(code=E.WORKER_SHUTDOWN.value, message="The ingestion worker is shutting down.",
                                   retryable=True))
        except Exception:
            log.warning("ingest.worker.shutdown_report_failed", extra={"job_id": handle.job_id})
