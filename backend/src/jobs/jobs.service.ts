/**
 * Ingestion job orchestration (document-lifecycle.md §2–§6, api-contracts.md §8–9).
 *
 * MySQL is authoritative. Invariants enforced here:
 *  L3  ≤ 1 active job per document (conditional update on `activeJobId`).
 *  L4  events applied at most once and in order (`seq`, row locks, transition rules).
 *  L5  READY is written only by a SUCCEEDED event of the document's active job.
 *  L6  deleted documents leave every scope immediately; chunks and files are purged later.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AiServiceClient, aiErrorCode } from '../ai/ai-client';
import { embeddingConfiguration, IndexVersionService } from '../ai/index-versions';
import { APP_CONFIG, AppConfig } from '../config/config';
import type { Document, DocumentProcessingJob, IndexVersion, JobKind } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { documentPrefix, Storage } from '../storage/storage';
import { EventValidationError, IngestionEvent, parseIngestionEvent, STAGES } from './ingestion-event';

export const RETRY_DELAYS_SECONDS = [60, 300];
export const DISPATCH_BACKOFF_SECONDS = 30;
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export class JobConflict extends Error {}

export interface CallbackReply {
  status: number;
  body: Record<string, unknown>;
}

const reply = (status: number, body: Record<string, unknown>): CallbackReply => ({ status, body });
const callbackError = (status: number, code: string, message: string) =>
  reply(status, { schema_version: 'ingest.v1', error: { code, message, retryable: false } });

/** Retries a transaction on InnoDB deadlocks / lock timeouts (events and deletes lock rows). */
async function withDeadlockRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || /deadlock|lock wait/i.test(e.message));
      const raw = e instanceof Error && /Deadlock found|Lock wait timeout/i.test(e.message);
      if (i >= attempts || !(transient || raw)) throw e;
    }
  }
}

@Injectable()
export class JobsService {
  private readonly log = new Logger('jobs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    private readonly indexVersions: IndexVersionService,
    private readonly storage: Storage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ---- §3.1 creation ----------------------------------------------------------------------

  /** Creates a QUEUED job and makes it the document's active job, in the caller's transaction.
   *  Throws JobConflict if the document already has an active job or is deleted. */
  async createJobTx(
    tx: Tx, documentId: string, kind: JobKind, attempt: number, iv: IndexVersion, notBefore: Date | null = null,
  ): Promise<DocumentProcessingJob> {
    const job = await tx.documentProcessingJob.create({
      data: { documentId, indexVersionId: iv.id, kind, attempt, status: 'QUEUED', indexingVersion: iv.chunkerVersion, nextAttemptAt: notBefore },
    });
    const updated = await tx.document.updateMany({
      where: { id: documentId, activeJobId: null, deletedAt: null },
      data: {
        activeJobId: job.id,
        ...(kind === 'MIGRATION' ? {} : { status: 'UPLOADED' }),
        errorCode: null, errorMessage: null, errorRetryable: null, failedStage: null,
      },
    });
    if (updated.count !== 1) throw new JobConflict('document already has an active job or is deleted');
    this.log.log({ event: 'job.created', job_id: job.id, document_id: documentId, kind, attempt });
    return job;
  }

  // ---- §3.2 dispatch ----------------------------------------------------------------------

  async dispatchDue(limit = 10): Promise<number> {
    const guard = await this.indexVersions.state();
    if (guard.state === 'mismatch') {
      this.log.warn({ event: 'job.dispatch_paused', reason: guard.reason });
      return 0;
    }
    const due = await this.prisma.documentProcessingJob.findMany({
      where: { status: 'QUEUED', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] },
      orderBy: { createdAt: 'asc' }, take: limit, select: { id: true },
    });
    let n = 0;
    for (const j of due) if (await this.dispatchOne(j.id)) n++;
    return n;
  }

  /** Claims one QUEUED job (conditional update, so two instances never send the same job)
   *  and posts it to Python. Returns true if Python accepted it. */
  async dispatchOne(jobId: string): Promise<boolean> {
    const claimed = await this.prisma.documentProcessingJob.updateMany({
      where: { id: jobId, status: 'QUEUED' }, data: { status: 'DISPATCHED', dispatchedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    const job = await this.prisma.documentProcessingJob.findUnique({
      where: { id: jobId }, include: { document: true, indexVersion: true },
    });
    if (!job) return false;
    if (job.document.deletedAt || job.document.activeJobId !== job.id) {
      await this.prisma.documentProcessingJob.updateMany({ where: { id: jobId, status: 'DISPATCHED' }, data: { status: 'CANCELLED', finishedAt: new Date() } });
      return false;
    }
    const r = await this.ai.call('POST', '/api/v1/ingestion/jobs', {
      body: this.jobRequest(job, job.document, job.indexVersion), timeoutMs: this.config.ingestionTimeoutMs,
    });
    if (r.kind === 'response' && (r.status === 202 || r.status === 200)) {
      await this.prisma.documentProcessingJob.updateMany({
        where: { id: jobId, status: { in: ['DISPATCHED', 'RUNNING'] }, workerId: null },
        data: { workerId: String(r.body?.worker_id ?? '').slice(0, 64) || null },
      });
      this.log.log({ event: 'job.dispatched', job_id: jobId, duplicate: Boolean(r.body?.duplicate) });
      return true;
    }
    const code = r.kind === 'response' ? aiErrorCode(r.body) : null;
    const permanent = r.kind === 'response' && (r.status === 422 || (r.status === 409 && code === 'INDEX_CONFIG_MISMATCH'));
    if (permanent) {
      await this.failJob(jobId, code ?? 'VALIDATION_ERROR', `Dispatch refused (${r.status} ${code ?? 'unknown'}).`, false, null);
      this.log.error({ event: 'job.dispatch_refused', job_id: jobId, status: (r as { status: number }).status, code });
      return false;
    }
    // Back-pressure (409 DOCUMENT_BUSY, 503 QUEUE_FULL), Python down, or misconfiguration: retry later.
    await this.prisma.documentProcessingJob.updateMany({
      where: { id: jobId, status: 'DISPATCHED' },
      data: { status: 'QUEUED', dispatchedAt: null, nextAttemptAt: new Date(Date.now() + DISPATCH_BACKOFF_SECONDS * 1000) },
    });
    this.log.warn({ event: 'job.dispatch_deferred', job_id: jobId, kind: r.kind, status: r.kind === 'response' ? r.status : null, code });
    return false;
  }

  jobRequest(job: DocumentProcessingJob, doc: Document, iv: IndexVersion) {
    const embedding = embeddingConfiguration(iv);
    return {
      schema_version: 'ingest.v1',
      job_id: job.id,
      attempt: job.attempt,
      kind: job.kind,
      document: {
        document_id: doc.id, course_id: doc.courseId, owner_id: doc.ownerId, title: doc.title,
        document_type: doc.documentType, indexing_version: job.indexingVersion, page_count: null,
      },
      source: {
        storage_key: doc.storageKey, mime_type: doc.mimeType, sha256: doc.contentSha256,
        size_bytes: doc.sizeBytes, original_filename: doc.originalFilename,
      },
      index: { index_version_id: iv.id, collection: iv.collectionName, embedding, embedding_fingerprint: iv.embeddingFingerprint },
    };
  }

  // ---- §3.3 applying events ---------------------------------------------------------------

  async applyEvent(jobId: string, raw: unknown): Promise<CallbackReply> {
    let ev: IngestionEvent;
    try {
      ev = parseIngestionEvent(raw);
    } catch (e) {
      if (e instanceof EventValidationError) return callbackError(422, 'VALIDATION_ERROR', e.message);
      throw e;
    }
    if (ev.job_id !== jobId) return callbackError(422, 'VALIDATION_ERROR', 'job_id does not match the path.');

    return withDeadlockRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM DocumentProcessingJob WHERE id = ${jobId} FOR UPDATE`;
      if (locked.length === 0) return callbackError(404, 'NOT_FOUND', 'Unknown job.');
      const job = await tx.documentProcessingJob.findUniqueOrThrow({ where: { id: jobId }, include: { indexVersion: true } });
      await tx.$queryRaw`SELECT id FROM Document WHERE id = ${job.documentId} FOR UPDATE`;
      const doc = await tx.document.findUniqueOrThrow({ where: { id: job.documentId } });

      if (TERMINAL.has(job.status) || doc.activeJobId !== job.id || doc.deletedAt) {
        return callbackError(409, 'STALE_JOB', 'The job is no longer the document\'s active job.');
      }
      if (ev.seq <= job.lastEventSeq) return reply(200, { applied: false, reason: 'DUPLICATE_EVENT' });
      if (ev.attempt !== job.attempt || ev.document_id !== job.documentId) {
        return callbackError(422, 'VALIDATION_ERROR', 'attempt or document_id does not match the job.');
      }
      const now = new Date();
      const common = { lastEventSeq: ev.seq, heartbeatAt: now, workerId: ev.worker_id.slice(0, 64) };
      const migration = job.kind === 'MIGRATION';

      switch (ev.type) {
        case 'STAGE': {
          if (job.stage && STAGES.indexOf(ev.stage!) < STAGES.indexOf(job.stage as (typeof STAGES)[number])) {
            return callbackError(409, 'INVALID_TRANSITION', 'Stages only move forward.');
          }
          await tx.documentProcessingJob.update({
            where: { id: job.id }, data: { ...common, status: 'RUNNING', stage: ev.stage!, startedAt: job.startedAt ?? now },
          });
          if (!migration) await tx.document.update({ where: { id: doc.id }, data: { status: ev.stage! } });
          break;
        }
        case 'HEARTBEAT':
          await tx.documentProcessingJob.update({ where: { id: job.id }, data: { ...common, status: 'RUNNING', startedAt: job.startedAt ?? now } });
          break;
        case 'SUCCEEDED': {
          const r = ev.result!;
          if (ev.stage !== 'INDEXING' || job.stage !== 'INDEXING' || r.indexing_version !== job.indexingVersion
            || r.collection !== job.indexVersion.collectionName || r.embedding_fingerprint !== job.indexVersion.embeddingFingerprint) {
            return callbackError(409, 'INVALID_TRANSITION', 'SUCCEEDED does not match the job (stage, version, collection or fingerprint).');
          }
          await tx.documentProcessingJob.update({
            where: { id: job.id },
            data: { ...common, status: 'SUCCEEDED', finishedAt: now, pageCount: r.page_count, chunkCount: r.chunk_count },
          });
          await tx.document.update({ where: { id: doc.id }, data: { activeJobId: null } });
          if (!migration) {
            if (job.indexVersion.status !== 'ACTIVE') {
              // §8 guard: written into a version that is no longer ACTIVE → requeue against ACTIVE.
              const active = await tx.indexVersion.findFirst({ where: { status: 'ACTIVE' } });
              if (active) await this.createJobTx(tx, doc.id, job.kind, 1, active);
              this.log.warn({ event: 'job.succeeded_on_inactive_version', job_id: job.id, document_id: doc.id });
              break;
            }
            await tx.document.update({
              where: { id: doc.id },
              data: {
                status: 'READY', readyAt: now, pageCount: r.page_count, chunkCount: r.chunk_count,
                indexingVersion: r.indexing_version, indexVersionId: job.indexVersionId,
                errorCode: null, errorMessage: null, errorRetryable: null, failedStage: null,
              },
            });
          }
          break;
        }
        case 'FAILED': {
          const e = ev.error!;
          await tx.documentProcessingJob.update({ where: { id: job.id }, data: common });
          await this.failJobTx(tx, job, doc, e.code, e.message, e.retryable, ev.stage ?? job.stage);
          break;
        }
      }
      this.log.log({ event: 'job.event_applied', job_id: job.id, seq: ev.seq, type: ev.type, stage: ev.stage ?? null });
      return reply(200, { applied: true });
    }));
  }

  // ---- §5 failure + retry policy ------------------------------------------------------------

  private async failJobTx(
    tx: Tx, job: DocumentProcessingJob, doc: Document, code: string, message: string, retryable: boolean,
    stage: string | null,
  ): Promise<void> {
    const now = new Date();
    await tx.documentProcessingJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', finishedAt: now, errorCode: code.slice(0, 64), errorMessage: message.slice(0, 500), retryable },
    });
    if (doc.activeJobId !== job.id) return;
    await tx.document.update({ where: { id: doc.id }, data: { activeJobId: null } });
    if (retryable && job.attempt < this.config.ingestMaxAutoAttempts) {
      const delay = RETRY_DELAYS_SECONDS[Math.min(job.attempt - 1, RETRY_DELAYS_SECONDS.length - 1)];
      const iv = job.kind === 'MIGRATION'
        ? await tx.indexVersion.findUniqueOrThrow({ where: { id: job.indexVersionId } })
        : (await tx.indexVersion.findFirst({ where: { status: 'ACTIVE' } })) ?? await tx.indexVersion.findUniqueOrThrow({ where: { id: job.indexVersionId } });
      await this.createJobTx(tx, doc.id, job.kind === 'MIGRATION' ? 'MIGRATION' : 'RETRY', job.attempt + 1, iv, new Date(now.getTime() + delay * 1000));
      this.log.warn({ event: 'job.failed_will_retry', job_id: job.id, document_id: doc.id, code, attempt: job.attempt, retry_in_s: delay });
      return;
    }
    if (job.kind !== 'MIGRATION') {
      const failedStage = stage && (STAGES as readonly string[]).includes(stage) ? stage : 'UPLOADED';
      await tx.document.update({
        where: { id: doc.id },
        data: { status: 'FAILED', failedStage: failedStage as never, errorCode: code.slice(0, 64), errorMessage: message.slice(0, 500), errorRetryable: retryable },
      });
    }
    this.log.warn({ event: 'job.failed', job_id: job.id, document_id: doc.id, code, retryable, attempt: job.attempt });
  }

  /** Fails a non-terminal job outside an event (dispatch refusal, stall). */
  async failJob(jobId: string, code: string, message: string, retryable: boolean, stage: string | null, onlyIf?: (j: DocumentProcessingJob) => boolean): Promise<boolean> {
    return withDeadlockRetry(() => this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM DocumentProcessingJob WHERE id = ${jobId} FOR UPDATE`;
      if (locked.length === 0) return false;
      const job = await tx.documentProcessingJob.findUniqueOrThrow({ where: { id: jobId } });
      if (TERMINAL.has(job.status) || (onlyIf && !onlyIf(job))) return false;
      await tx.$queryRaw`SELECT id FROM Document WHERE id = ${job.documentId} FOR UPDATE`;
      const doc = await tx.document.findUniqueOrThrow({ where: { id: job.documentId } });
      await this.failJobTx(tx, job, doc, code, message, retryable, stage ?? job.stage);
      return true;
    }));
  }

  // ---- §4.2 sweeper -------------------------------------------------------------------------

  async sweepStalled(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.ingestStallTimeoutSeconds * 1000);
    const stale = await this.prisma.documentProcessingJob.findMany({
      where: {
        status: { in: ['DISPATCHED', 'RUNNING'] },
        OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, dispatchedAt: { lt: cutoff } }],
      },
      select: { id: true }, take: 100,
    });
    let n = 0;
    for (const s of stale) {
      const stillStale = (j: DocumentProcessingJob) => {
        const last = j.heartbeatAt ?? j.dispatchedAt;
        return (j.status === 'DISPATCHED' || j.status === 'RUNNING') && !!last && last < cutoff;
      };
      if (await this.failJob(s.id, 'STALLED', 'No heartbeat within the stall timeout.', true, null, stillStale)) n++;
    }
    if (n) this.log.warn({ event: 'job.stalled', count: n });
    return n;
  }

  // ---- §6 deletion + purge ------------------------------------------------------------------

  /** Step 1: soft delete + cancel the active job in one transaction. Out of every scope at once. */
  async softDelete(documentId: string): Promise<void> {
    await withDeadlockRetry(() => this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Document WHERE id = ${documentId} FOR UPDATE`;
      const doc = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
      if (doc.deletedAt) return;
      if (doc.activeJobId) {
        await tx.documentProcessingJob.updateMany({
          where: { id: doc.activeJobId, status: { notIn: ['SUCCEEDED', 'FAILED', 'CANCELLED'] } },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
      }
      await tx.document.update({
        where: { id: documentId },
        data: { deletedAt: new Date(), status: 'DELETING', activeContentHash: null, activeJobId: null },
      });
    }));
    this.log.log({ event: 'document.deleted', document_id: documentId });
  }

  /** Steps 2–4: chunks in every non-dropped collection, then files, then `purgedAt`.
   *  Returns false (purgedAt stays NULL, retried by the sweeper) if any step fails. */
  async purge(documentId: string): Promise<boolean> {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc || !doc.deletedAt || doc.purgedAt) return Boolean(doc?.purgedAt);
    const collections = await this.prisma.indexVersion.findMany({ where: { droppedAt: null }, select: { collectionName: true } });
    for (const { collectionName } of collections) {
      const r = await this.ai.call('DELETE',
        `/api/v1/ingestion/documents/${encodeURIComponent(documentId)}/chunks?collection=${encodeURIComponent(collectionName)}`,
        { timeoutMs: this.config.ingestionTimeoutMs });
      if (r.kind !== 'response' || r.status !== 200) {
        this.log.warn({ event: 'document.purge_deferred', document_id: documentId, collection: collectionName,
          status: r.kind === 'response' ? r.status : r.kind });
        return false;
      }
    }
    try {
      await this.storage.deletePrefix(documentPrefix(documentId));
    } catch (e) {
      this.log.warn({ event: 'document.purge_storage_failed', document_id: documentId, error_type: (e as Error).constructor.name });
      return false;
    }
    await this.prisma.document.update({ where: { id: documentId }, data: { purgedAt: new Date() } });
    this.log.log({ event: 'document.purged', document_id: documentId, collections: collections.length });
    return true;
  }

  async purgePending(limit = 50): Promise<number> {
    const pending = await this.prisma.document.findMany({
      where: { deletedAt: { not: null }, purgedAt: null }, select: { id: true }, take: limit, orderBy: { deletedAt: 'asc' },
    });
    let n = 0;
    for (const d of pending) if (await this.purge(d.id)) n++;
    return n;
  }
}
