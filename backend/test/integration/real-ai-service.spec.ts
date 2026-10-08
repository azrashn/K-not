/**
 * REAL integration: NestJS + MySQL 8 + the actual Python ai-service (WBS-2 ingestion and WBS-3
 * RAG in one uvicorn process), sharing one storage volume. Python posts its job events back to
 * NestJS over HTTP. Nothing here is faked except the LLM: the ai-service runs with its own
 * deterministic `extractive` provider (no LLM is configured in this environment).
 *
 * Embeddings:
 *   default            HashingEmbedder (dependency-free, lexical; a test configuration)
 *   KNOT_REAL_E5=1     the ADR-010 pinned intfloat/multilingual-e5-small (needs the model locally)
 */
import { ChildProcess, spawn } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import * as path from 'node:path';

import { EmbeddingConfiguration } from '../../src/ai/index-versions';
import { E5_SMALL_MVP } from '../../scripts/seed';
import { Harness, RAG_TOKEN, CALLBACK_TOKEN } from '../support/harness';

const REAL_E5 = process.env.KNOT_REAL_E5 === '1';
jest.setTimeout(REAL_E5 ? 900_000 : 300_000);
const AI_DIR = path.resolve(__dirname, '../../../ai-service');
const FIXTURES = path.join(AI_DIR, 'tests/ingest/fixtures');
const HASHING: EmbeddingConfiguration = {
  backend: 'hashing', model: 'knot-hashing-v1', revision: null, dimension: 512, query_prefix: '', document_prefix: '', normalize: true, distance: 'cosine',
};
const EMBEDDING = REAL_E5 ? E5_SMALL_MVP : HASHING;
const COLLECTION = REAL_E5 ? 'knot_it_e5' : 'knot_it_hashing';

const h = new Harness();
let py: ChildProcess;
let aiUrl = '';
let logFile = '';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | false>, timeoutMs = 180_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}; ai-service log: ${logFile}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  const port = await freePort();
  aiUrl = `http://127.0.0.1:${port}`;
  await h.start({ aiServiceUrl: aiUrl, ingestionTimeoutMs: 120_000 });
  logFile = path.join(h.storageRoot, '..', `ai-service-${port}.log`);
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PYTHONPATH: 'src', RAG_INTERNAL_API_TOKEN: RAG_TOKEN, CHROMA_MODE: 'memory', CHROMA_COLLECTION: COLLECTION,
    EMBEDDING_BACKEND: EMBEDDING.backend, EMBEDDING_MODEL: EMBEDDING.model, EMBEDDING_REVISION: EMBEDDING.revision ?? '',
    EMBEDDING_QUERY_PREFIX: EMBEDDING.query_prefix, EMBEDDING_DOCUMENT_PREFIX: EMBEDDING.document_prefix,
    LLM_PROVIDER: 'extractive', INGEST_ENABLED: 'true', STORAGE_ROOT: h.storageRoot, NESTJS_INTERNAL_URL: h.url,
    INGEST_CALLBACK_TOKEN: CALLBACK_TOKEN, INGEST_HEARTBEAT_SECONDS: '5', LOG_LEVEL: 'WARNING',
  };
  const out = openSync(logFile, 'w');
  py = spawn('python', ['-m', 'uvicorn', 'knot_rag.main:app', '--host', '127.0.0.1', '--port', String(port)], { cwd: AI_DIR, env, stdio: ['ignore', out, out] });
  await waitFor('ai-service /health', async () => (await fetch(`${aiUrl}/health`)).ok, 120_000);
  // The first /ready loads the embedding model (e5-small: tens of seconds on CPU). Until then the
  // backend guard reports `unavailable` and answers are 503 AI_SERVICE_UNAVAILABLE, by design.
  await fetch(`${aiUrl}/ready`, { signal: AbortSignal.timeout(600_000) });
}, 900_000);

afterAll(async () => {
  if (py && py.exitCode === null) {
    const exited = new Promise((r) => py.once('exit', r));
    py.kill('SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000).unref())]);
    if (py.exitCode === null) py.kill('SIGKILL');
  }
  await h.stop();
});

async function uploadFixture(who: 'ayse' | 'mehmet' | 'instructor', course: string, file: string, type: string, visibility?: string) {
  return (await h.uploadOk(who, course, { file: readFileSync(path.join(FIXTURES, file)), name: file, type, visibility })).id as string;
}

async function processUntilTerminal(ids: string[]) {
  return waitFor(`documents ${ids.join(',')} to finish`, async () => {
    await h.jobs.dispatchDue();
    const docs = await h.prisma.document.findMany({ where: { id: { in: ids } } });
    return docs.every((d) => d.status === 'READY' || d.status === 'FAILED') ? docs : null;
  }, REAL_E5 ? 600_000 : 180_000);
}

test(`PDF → WBS-2 ingestion → callbacks → READY → WBS-3 answer with exact sources (${REAL_E5 ? 'e5-small' : 'hashing'})`, async () => {
  const w = await h.reset(EMBEDDING, COLLECTION);
  const guard = await waitFor('index guard ok', async () => {
    h.app.get((await import('../../src/ai/index-versions')).IndexVersionService).invalidate();
    const s = await h.app.get((await import('../../src/ai/index-versions')).IndexVersionService).check();
    return s.state === 'ok' ? s : null;
  }, 30_000);
  expect(guard.state).toBe('ok'); // the real /ready reports the same fingerprint (C-1)

  const slides = await uploadFixture('instructor', w.courses.vy, 'slides_tr.pdf', 'slide', 'COURSE');
  const notes = await uploadFixture('ayse', w.courses.vy, 'notes_tr.pdf', 'notes');
  const osNotes = await uploadFixture('mehmet', w.courses.os, 'notes_tr.pdf', 'notes');
  const scanned = await uploadFixture('ayse', w.courses.vy, 'scanned.pdf', 'slide');

  const docs = await processUntilTerminal([slides, notes, osNotes, scanned]);
  const byId = Object.fromEntries(docs.map((d) => [d.id, d]));
  expect(byId[slides]).toMatchObject({ status: 'READY', pageCount: 5, chunkCount: 4, indexingVersion: 'c1', indexVersionId: w.ivId });
  expect(byId[notes]).toMatchObject({ status: 'READY', pageCount: 3 });
  expect(byId[osNotes].status).toBe('READY');
  expect(byId[scanned]).toMatchObject({ status: 'FAILED', errorCode: 'NO_TEXT_LAYER', errorRetryable: false, failedStage: 'EXTRACTING' });
  const jobs = await h.prisma.documentProcessingJob.findMany({ where: { documentId: slides } });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ status: 'SUCCEEDED', stage: 'INDEXING', chunkCount: 4 });
  expect(jobs[0].lastEventSeq).toBeGreaterThanOrEqual(6);

  // Source viewer serves the artifact Python wrote.
  const page4 = (await h.http().get(`/documents/${slides}/pages/4`).set(await h.as('ayse')).expect(200)).body;
  expect(page4.text.startsWith('AVL Ağaçları: Denge Koşulu')).toBe(true);

  // Q&A through NestJS → real WBS-3.
  const q = 'AVL ağacında sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?';
  const ans = (await h.http().post(`/courses/${w.courses.vy}/answers`).set(await h.as('ayse')).send({ question: q }).expect(200)).body;
  expect(ans.schema_version).toBe('rag.v1');
  const top = ans.evidence[0];
  expect(top).toMatchObject({ document_id: slides, chunk_id: `${slides}:c1:003`, label: 'Slayt · s.4', indexing_version: 'c1' });
  expect(top.location).toMatchObject({ page_start: 4, page_end: 4 });
  expect(ans.documents[slides]).toEqual({ title: 'slides_tr', original_filename: 'slides_tr.pdf', document_type: 'slide', page_count: 5 });
  // Citation highlight → page-relative text via the NestJS page endpoint (code-point slicing).
  const cited = ans.claims.flatMap((c: any) => c.citations).filter((c: any) => c.highlight && c.document_id === slides);
  for (const c of cited) {
    const page = (await h.http().get(`/documents/${slides}/pages/${c.location.page_start}`).set(await h.as('ayse')).expect(200)).body;
    const cp = Array.from(page.text as string);
    expect(cp.slice(c.highlight.document_char_start - page.char_start, c.highlight.document_char_end - page.char_start).join('')).toBe(c.quote);
  }
  // NestJS passes the support status through; it is whatever WBS-3 decided.
  expect(['SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED']).toContain(ans.support_status);

  // Cross-user: Mehmet never sees Ayşe's PRIVATE notes, even asking about their content.
  const hashQ = 'Karma tablolarında zincirleme yönteminde çakışan anahtarlar nerede tutulur?';
  const m = (await h.http().post(`/courses/${w.courses.vy}/answers`).set(await h.as('mehmet')).send({ question: hashQ }).expect(200)).body;
  expect(m.evidence.map((e: any) => e.document_id)).not.toContain(notes);
  const a = (await h.http().post(`/courses/${w.courses.vy}/answers`).set(await h.as('ayse')).send({ question: hashQ }).expect(200)).body;
  expect(a.evidence[0].document_id).toBe(notes);

  // Cross-course: an id from another course is dropped from the scope → nothing left → 409.
  const cc = await h.http().post(`/courses/${w.courses.vy}/answers`).set(await h.as('mehmet')).send({ question: hashQ, document_ids: [osNotes] }).expect(409);
  expect(cc.body.error.code).toBe('NO_READY_DOCUMENTS');

  // Retrieval service method (WBS-6/7) against the real service.
  const ev = await h.app.get((await import('../../src/rag/rag.service')).RagService).retrieveEvidence(w.users.ayse, w.courses.vy, q);
  expect(ev.evidence[0].document_id).toBe(slides);

  // Deletion: out of scope at once, then chunks purged from the real index and files removed.
  await h.http().delete(`/documents/${slides}`).set(await h.as('instructor')).expect(202);
  expect(await h.jobs.purge(slides)).toBe(true);
  const verify = await fetch(`${aiUrl}/api/v1/ingestion/verify`, {
    method: 'POST', headers: { Authorization: `Bearer ${RAG_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ collection: COLLECTION, documents: [{ document_id: slides, chunk_count: 0, job_id: jobs[0].id }] }),
  }).then((r) => r.json() as Promise<{ results: { found: number; ok: boolean }[] }>);
  expect(verify.results[0]).toMatchObject({ found: 0, ok: true });
  const after = (await h.http().post(`/courses/${w.courses.vy}/answers`).set(await h.as('ayse')).send({ question: q }).expect(200)).body;
  expect(after.evidence.map((e: any) => e.document_id)).not.toContain(slides);
});
