/** Ingestion orchestration against the FAKE ai-service: dispatch, callbacks (auth, idempotency,
 *  fencing, transitions), retry policy, stall sweeper, deletion purge (document-lifecycle.md). */
import { IndexVersionService } from '../../src/ai/index-versions';
import { Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset());

const ACCEPT = () => ({ status: 202, body: { schema_version: 'ingest.v1', accepted: true, duplicate: false, worker_id: 'ai-7f3a91', queue_position: 0 } });

async function newDoc(tag = 'x') {
  return (await h.uploadOk('ayse', h.world.courses.vy, { file: Buffer.concat([PDF, Buffer.from(tag)]) })).id as string;
}

function ev(job: { id: string; documentId: string; attempt: number }, seq: number, type: string, extra: Record<string, unknown> = {}) {
  return { schema_version: 'ingest.v1', job_id: job.id, document_id: job.documentId, attempt: job.attempt, seq, worker_id: 'ai-7f3a91',
    type, stage: null, progress: 0.1, emitted_at: new Date().toISOString(), result: null, error: null, ...extra };
}

const succeeded = (fp: string, docId: string) => ({
  stage: 'INDEXING', progress: 1,
  result: { page_count: 3, chunk_count: 2, indexing_version: 'c1', collection: 'knot_chunks_v1', embedding_fingerprint: fp,
    pages_artifact_key: `documents/${docId}/pages.c1.json` },
});

async function dispatched(docId: string) {
  h.ai.on('POST', '/api/v1/ingestion/jobs', ACCEPT);
  const job = (await h.activeJob(docId))!;
  expect(await h.jobs.dispatchOne(job.id)).toBe(true);
  return (await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } }));
}

describe('dispatch', () => {
  test('sends the exact ingest.v1 IngestionJobRequest with the internal token, then DISPATCHED', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    expect(job).toMatchObject({ status: 'DISPATCHED', workerId: 'ai-7f3a91' });
    const [call] = h.ai.calls('POST', '/api/v1/ingestion/jobs');
    expect(call.headers.authorization).toBe('Bearer rag-test-token-0123456789');
    const doc = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(call.body).toEqual({
      schema_version: 'ingest.v1', job_id: job.id, attempt: 1, kind: 'INITIAL',
      document: { document_id: id, course_id: h.world.courses.vy, owner_id: h.world.users.ayse, title: 'hafta4', document_type: 'slide', indexing_version: 'c1', page_count: null },
      source: { storage_key: `documents/${id}/original.pdf`, mime_type: 'application/pdf', sha256: doc.contentSha256, size_bytes: doc.sizeBytes, original_filename: 'hafta4.pdf' },
      index: {
        index_version_id: h.world.ivId, collection: 'knot_chunks_v1',
        embedding: { backend: 'sentence_transformers', model: 'intfloat/multilingual-e5-small', revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
          dimension: 384, query_prefix: 'query: ', document_prefix: 'passage: ', normalize: true, distance: 'cosine' },
        embedding_fingerprint: 'sha256:7858637ffe512d13b894af08f99e75f8f42be36c457e2e02192bacdfd6671616',
      },
    });
  });

  test('concurrent dispatchers claim a job once (one POST)', async () => {
    const id = await newDoc();
    h.ai.on('POST', '/api/v1/ingestion/jobs', () => ({ ...ACCEPT(), delayMs: 50 }));
    const job = (await h.activeJob(id))!;
    const results = await Promise.all([1, 2, 3, 4].map(() => h.jobs.dispatchOne(job.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(h.ai.calls('POST', '/api/v1/ingestion/jobs')).toHaveLength(1);
  });

  test.each([
    ['503 QUEUE_FULL', () => ({ status: 503, body: { error: { code: 'QUEUE_FULL' } } })],
    ['409 DOCUMENT_BUSY', () => ({ status: 409, body: { error: { code: 'DOCUMENT_BUSY' } } })],
    ['connection drop', () => 'drop' as const],
  ])('back-pressure (%s) returns the job to QUEUED with a 30 s backoff', async (_n, reply) => {
    const id = await newDoc();
    h.ai.on('POST', '/api/v1/ingestion/jobs', reply as never);
    const job = (await h.activeJob(id))!;
    expect(await h.jobs.dispatchOne(job.id)).toBe(false);
    const after = await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: 'QUEUED', dispatchedAt: null });
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(await h.jobs.dispatchDue()).toBe(0); // not due yet
  });

  test('409 INDEX_CONFIG_MISMATCH / 422 fail the job permanently (document FAILED, not retryable)', async () => {
    const id = await newDoc();
    h.ai.on('POST', '/api/v1/ingestion/jobs', () => ({ status: 409, body: { error: { code: 'INDEX_CONFIG_MISMATCH' } } }));
    await h.jobs.dispatchOne((await h.activeJob(id))!.id);
    const doc = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'FAILED', errorCode: 'INDEX_CONFIG_MISMATCH', errorRetryable: false, activeJobId: null });
    const dto = (await h.http().get(`/documents/${id}`).set(await h.as('ayse')).expect(200)).body;
    expect(dto.status).toMatchObject({ state: 'FAILED', ui_state: 'error', error: { code: 'INDEX_CONFIG_MISMATCH', message_tr: 'Bir sistem sorunu oluştu.', retryable: false } });
  });

  test('dispatch pauses while /ready reports another fingerprint (no silent model fallback)', async () => {
    const id = await newDoc();
    h.ai.readyIndex = { collection: 'knot_chunks_v1', embedding_fingerprint: 'sha256:' + 'f'.repeat(64), index_version_id: null };
    h.app.get(IndexVersionService).invalidate();
    h.ai.on('POST', '/api/v1/ingestion/jobs', ACCEPT);
    expect(await h.jobs.dispatchDue()).toBe(0);
    expect(h.ai.calls('POST', '/api/v1/ingestion/jobs')).toHaveLength(0);
    expect((await h.activeJob(id))!.status).toBe('QUEUED');
  });
});

describe('callbacks', () => {
  test('rejects missing/wrong callback tokens and user JWTs (401)', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    const body = ev(job, 1, 'HEARTBEAT');
    await h.http().post(`/internal/v1/ingestion-jobs/${job.id}/events`).send(body).expect(401);
    await h.event(job.id, body, 'wrong-token-0123456789').expect(401);
    await h.http().post(`/internal/v1/ingestion-jobs/${job.id}/events`).set(await h.as('admin')).send(body).expect(401);
    await h.event(job.id, body, 'rag-test-token-0123456789').expect(401); // the RAG token is not the callback token
    expect((await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).lastEventSeq).toBe(0);
  });

  test('full happy path: stages move the document forward, SUCCEEDED makes it READY', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    const states: string[] = [];
    let seq = 0;
    for (const stage of ['EXTRACTING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING']) {
      await h.event(job.id, ev(job, ++seq, 'STAGE', { stage })).expect(200, { applied: true });
      states.push((await h.prisma.document.findUniqueOrThrow({ where: { id } })).status);
    }
    expect(states).toEqual(['EXTRACTING', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING']);
    await h.event(job.id, ev(job, ++seq, 'HEARTBEAT', { stage: 'INDEXING' })).expect(200);
    await h.event(job.id, ev(job, ++seq, 'SUCCEEDED', succeeded(h.world.fingerprint, id))).expect(200, { applied: true });
    const doc = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'READY', pageCount: 3, chunkCount: 2, indexingVersion: 'c1', indexVersionId: h.world.ivId, activeJobId: null });
    expect(await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'SUCCEEDED', lastEventSeq: 7, pageCount: 3, chunkCount: 2 });
    const dto = (await h.http().get(`/documents/${id}`).set(await h.as('ayse')).expect(200)).body;
    expect(dto.status).toMatchObject({ state: 'READY', ui_state: 'ready', stage: null });
    expect(dto.page_count).toBe(3);
  });

  test('duplicate and out-of-order events are idempotent; concurrent duplicates apply once', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 2, 'STAGE', { stage: 'CHUNKING' })).expect(200, { applied: true });
    await h.event(job.id, ev(job, 2, 'STAGE', { stage: 'CHUNKING' })).expect(200, { applied: false, reason: 'DUPLICATE_EVENT' });
    await h.event(job.id, ev(job, 1, 'STAGE', { stage: 'EXTRACTING' })).expect(200, { applied: false, reason: 'DUPLICATE_EVENT' });
    expect((await h.prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe('CHUNKING');
    const replies = await Promise.all([1, 2, 3, 4, 5].map(() => h.event(job.id, ev(job, 3, 'STAGE', { stage: 'EMBEDDING' }))));
    expect(replies.filter((r) => r.body.applied === true)).toHaveLength(1);
    expect((await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).lastEventSeq).toBe(3);
  });

  test('backward stages and inconsistent SUCCEEDED are 409 INVALID_TRANSITION', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'STAGE', { stage: 'EMBEDDING' })).expect(200);
    const back = await h.event(job.id, ev(job, 2, 'STAGE', { stage: 'CHUNKING' })).expect(409);
    expect(back.body.error.code).toBe('INVALID_TRANSITION');
    // SUCCEEDED before INDEXING, or with another fingerprint/collection/version, never makes READY.
    await h.event(job.id, ev(job, 3, 'SUCCEEDED', succeeded(h.world.fingerprint, id))).expect(409);
    await h.event(job.id, ev(job, 4, 'STAGE', { stage: 'INDEXING' })).expect(200);
    await h.event(job.id, ev(job, 5, 'SUCCEEDED', succeeded('sha256:' + '0'.repeat(64), id))).expect(409);
    const wrongVersion = succeeded(h.world.fingerprint, id);
    (wrongVersion.result as Record<string, unknown>).indexing_version = 'c2';
    await h.event(job.id, ev(job, 6, 'SUCCEEDED', wrongVersion)).expect(409);
    expect((await h.prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe('INDEXING');
  });

  test('malformed events are 422; unknown jobs 404; attempt/document mismatches 422', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.event(job.id, { ...ev(job, 1, 'STAGE'), stage: null }).expect(422);
    await h.event(job.id, { ...ev(job, 1, 'STAGE', { stage: 'EXTRACTING' }), schema_version: 'ingest.v2' }).expect(422);
    await h.event(job.id, ev(job, 1, 'SUCCEEDED', { stage: 'INDEXING' })).expect(422);
    await h.event(job.id, ev(job, 1, 'FAILED', { error: { code: 'X' } })).expect(422);
    await h.event(job.id, { ...ev(job, 1, 'STAGE', { stage: 'EXTRACTING' }), job_id: 'other-job' }).expect(422);
    await h.event('unknown-job', { ...ev(job, 1, 'HEARTBEAT'), job_id: 'unknown-job' }).expect(404);
    await h.event(job.id, { ...ev(job, 1, 'HEARTBEAT'), attempt: 2 }).expect(422);
    await h.event(job.id, { ...ev(job, 1, 'HEARTBEAT'), document_id: 'cother' }).expect(422);
    expect((await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).lastEventSeq).toBe(0);
  });

  test('events of a cancelled, superseded or terminal job are 409 STALE_JOB', async () => {
    const id = await newDoc('a');
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'STAGE', { stage: 'EXTRACTING' })).expect(200);
    await h.http().delete(`/documents/${id}`).set(await h.as('ayse')).expect(202);
    const stale = await h.event(job.id, ev(job, 2, 'STAGE', { stage: 'CHUNKING' })).expect(409);
    expect(stale.body.error.code).toBe('STALE_JOB');
    expect((await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('CANCELLED');

    const id2 = await newDoc('b');
    const job2 = await dispatched(id2);
    await h.event(job2.id, ev(job2, 1, 'FAILED', { stage: 'EXTRACTING', error: { code: 'NO_TEXT_LAYER', message: 'x', retryable: false } })).expect(200);
    await h.event(job2.id, ev(job2, 2, 'HEARTBEAT')).expect(409);
  });
});

describe('retry policy and manual retry', () => {
  test('retryable failures create RETRY jobs with backoff until attempts are exhausted', async () => {
    const id = await newDoc();
    let job = await dispatched(id);
    const fail = { stage: 'EMBEDDING', error: { code: 'EMBEDDING_FAILED', message: 'oom', retryable: true } };
    await h.event(job.id, ev(job, 1, 'FAILED', fail)).expect(200);
    let doc = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    let next = (await h.activeJob(id))!;
    expect(doc.status).toBe('UPLOADED');
    expect(next).toMatchObject({ kind: 'RETRY', attempt: 2, status: 'QUEUED' });
    expect(next.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(55_000);

    await h.prisma.documentProcessingJob.update({ where: { id: next.id }, data: { nextAttemptAt: null } });
    job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'FAILED', fail)).expect(200);
    next = (await h.activeJob(id))!;
    expect(next).toMatchObject({ attempt: 3 });
    expect(next.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(295_000);

    await h.prisma.documentProcessingJob.update({ where: { id: next.id }, data: { nextAttemptAt: null } });
    job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'FAILED', fail)).expect(200);
    doc = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'FAILED', failedStage: 'EMBEDDING', errorCode: 'EMBEDDING_FAILED', errorRetryable: true, activeJobId: null });
    expect(await h.prisma.documentProcessingJob.count({ where: { documentId: id } })).toBe(3);
  });

  test('non-retryable failures fail the document immediately with a Turkish message', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'FAILED', { stage: 'EXTRACTING', error: { code: 'NO_TEXT_LAYER', message: 'No extractable text on 32 of 32 pages.', retryable: false } })).expect(200);
    const dto = (await h.http().get(`/documents/${id}`).set(await h.as('ayse')).expect(200)).body;
    expect(dto.status.error).toEqual({ code: 'NO_TEXT_LAYER', message_tr: 'Taranmış sayfalar okunamadı. Metin içeren bir PDF yükleyebilirsin.', retryable: false });
    expect(JSON.stringify(dto)).not.toContain('32 of 32'); // Python messages are never shown to users
    const r = await h.http().post(`/documents/${id}/retry`).set(await h.as('ayse')).expect(409);
    expect(r.body.error.code).toBe('NOT_RETRYABLE');
  });

  test('manual retry: only FAILED+retryable, starts a new episode; concurrent clicks create one job', async () => {
    const id = await newDoc();
    const auth = await h.as('ayse');
    const running = await h.http().post(`/documents/${id}/retry`).set(auth).expect(409);
    expect(running.body.error.code).toBe('JOB_ALREADY_RUNNING');
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'FAILED', { stage: 'INDEXING', error: { code: 'INDEX_UNAVAILABLE', message: 'x', retryable: true } })).expect(200);
    await h.prisma.documentProcessingJob.deleteMany({ where: { documentId: id, status: 'QUEUED' } });
    await h.prisma.document.update({ where: { id }, data: { activeJobId: null, status: 'FAILED', errorCode: 'INDEX_UNAVAILABLE', errorRetryable: true } });
    const replies = await Promise.all([1, 2, 3].map(() => h.http().post(`/documents/${id}/retry`).set(auth)));
    expect(replies.map((r) => r.status).sort()).toEqual([202, 409, 409]);
    const ok = replies.find((r) => r.status === 202)!;
    expect(ok.body.status.state).toBe('UPLOADED');
    expect(await h.activeJob(id)).toMatchObject({ kind: 'RETRY', attempt: 1, status: 'QUEUED' });
    await h.http().post(`/documents/${id}/retry`).set(await h.as('mehmet')).expect(404); // not the owner
  });
});

describe('stale jobs and deletion', () => {
  test('the sweeper fails silent jobs as STALLED (retryable) and the late worker is fenced off', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.event(job.id, ev(job, 1, 'STAGE', { stage: 'EMBEDDING' })).expect(200);
    expect(await h.jobs.sweepStalled()).toBe(0); // fresh heartbeat
    const later = new Date(Date.now() + (h.config.ingestStallTimeoutSeconds + 5) * 1000);
    expect(await h.jobs.sweepStalled(later)).toBe(1);
    expect(await h.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', errorCode: 'STALLED', retryable: true });
    expect(await h.activeJob(id)).toMatchObject({ kind: 'RETRY', attempt: 2 });
    const late = await h.event(job.id, ev(job, 2, 'STAGE', { stage: 'INDEXING' })).expect(409);
    expect(late.body.error.code).toBe('STALE_JOB');
    expect(await h.jobs.sweepStalled(later)).toBe(0); // idempotent
  });

  test('a DISPATCHED job with no heartbeat at all is also swept', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    await h.prisma.documentProcessingJob.update({ where: { id: job.id }, data: { dispatchedAt: new Date(Date.now() - 3_600_000) } });
    expect(await h.jobs.sweepStalled()).toBe(1);
  });

  test('purge deletes chunks in every non-dropped collection and the files; failures are retried', async () => {
    const id = await newDoc();
    await h.makeReady(id);
    await h.prisma.indexVersion.create({ data: { collectionName: 'knot_chunks_v0', embeddingBackend: 'sentence_transformers', embeddingModel: 'm',
      embeddingDimension: 384, embeddingFingerprint: 'sha256:' + '1'.repeat(64), chunkerVersion: 'c1', status: 'RETIRED' } });
    await h.prisma.indexVersion.create({ data: { collectionName: 'knot_chunks_old', embeddingBackend: 'sentence_transformers', embeddingModel: 'm',
      embeddingDimension: 384, embeddingFingerprint: 'sha256:' + '2'.repeat(64), chunkerVersion: 'c1', status: 'RETIRED', droppedAt: new Date() } });
    await h.http().delete(`/documents/${id}`).set(await h.as('ayse')).expect(202);

    h.ai.on('DELETE', '/api/v1/ingestion/documents/', () => ({ status: 503, body: { error: { code: 'INDEX_UNAVAILABLE' } } }));
    expect(await h.jobs.purge(id)).toBe(false);
    expect((await h.prisma.document.findUniqueOrThrow({ where: { id } })).purgedAt).toBeNull();

    h.ai.on('DELETE', '/api/v1/ingestion/documents/', (r) => ({ status: 200, body: { document_id: id, collection: r.path.split('=')[1], deleted: 2 } }));
    expect(await h.jobs.purgePending()).toBe(1);
    const calls = h.ai.calls('DELETE', `/api/v1/ingestion/documents/${id}/chunks`).map((c) => c.path.split('collection=')[1]);
    expect(new Set(calls)).toEqual(new Set(['knot_chunks_v1', 'knot_chunks_v0'])); // dropped collection skipped
    const { existsSync } = await import('node:fs');
    expect(existsSync(`${h.storageRoot}/documents/${id}`)).toBe(false);
    expect((await h.prisma.document.findUniqueOrThrow({ where: { id } })).purgedAt).not.toBeNull();
    expect(await h.jobs.purgePending()).toBe(0);
  });

  test('SUCCEEDED for a document deleted mid-flight never makes it READY', async () => {
    const id = await newDoc();
    const job = await dispatched(id);
    for (const [i, stage] of ['EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'].entries()) {
      await h.event(job.id, ev(job, i + 1, 'STAGE', { stage })).expect(200);
    }
    await h.prisma.document.update({ where: { id }, data: {} });
    await h.http().delete(`/documents/${id}`).set(await h.as('ayse')).expect(202);
    await h.event(job.id, ev(job, 5, 'SUCCEEDED', succeeded(h.world.fingerprint, id))).expect(409);
    expect((await h.prisma.document.findUniqueOrThrow({ where: { id } })).status).toBe('DELETING');
  });
});
