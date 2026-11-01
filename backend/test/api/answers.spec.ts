/** NestJS ↔ WBS-3 proxy against the FAKE ai-service: authorized scope derivation, unauthorized
 *  scope/document leakage, pass-through without re-grading, error mapping, rate limit. */
import { IndexVersionService } from '../../src/ai/index-versions';
import { RagService } from '../../src/rag/rag.service';
import { chain, Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start({ answerRateLimitPerMinute: 1000 }));
afterAll(() => h.stop());

let ids: { aysePrivate: string; mehmetPrivate: string; course: string; pending: string; otherCourse: string; deleted: string };

beforeEach(async () => {
  await h.reset();
  const up = async (who: 'ayse' | 'mehmet' | 'instructor', tag: string, course = h.world.courses.vy, visibility?: string) =>
    (await h.uploadOk(who, course, { file: Buffer.concat([PDF, Buffer.from(tag)]), visibility, title: `Belge ${tag}` })).id as string;
  ids = {
    aysePrivate: await up('ayse', 'a'),
    mehmetPrivate: await up('mehmet', 'm'),
    course: await up('instructor', 'c', h.world.courses.vy, 'COURSE'),
    pending: await up('ayse', 'p'),
    otherCourse: await up('mehmet', 'o', h.world.courses.os),
    deleted: await up('ayse', 'd'),
  };
  for (const id of [ids.aysePrivate, ids.mehmetPrivate, ids.course, ids.otherCourse, ids.deleted]) await h.makeReady(id);
  await h.http().delete(`/documents/${ids.deleted}`).set(await h.as('ayse')).expect(202);
});

function groundedAnswer(scope: { course_id: string; document_ids: string[] }, opts: { outcome?: string; support?: string; leakDoc?: string } = {}) {
  const docId = opts.leakDoc ?? scope.document_ids[0];
  const evidence = [{
    evidence_id: 'E1', chunk_id: `${docId}:c1:001`, document_id: docId, course_id: scope.course_id, document_title: 'stale title in chroma',
    document_type: 'slide', indexing_version: 'c1', location: { page_start: 1, page_end: 1, char_start: 0, char_end: 9, section_title: null },
    label: 'Slayt · s.1', text: 'Sayfa bir', score: 0.8, rank: 1, truncated: false,
  }];
  const claims = opts.outcome === 'INSUFFICIENT_EVIDENCE' ? [] : [{
    claim_id: 'c1', claim_text: 'Sayfa bir.', cited_evidence_ids: ['E1'],
    citations: [{ evidence_id: 'E1', chunk_id: evidence[0].chunk_id, document_id: docId, document_title: 'x', location: evidence[0].location,
      label: 'Slayt · s.1', quote: 'Sayfa bir', quote_verified: true, highlight: null }],
    support_status: opts.support ?? 'PARTIALLY_SUPPORTED', support_label: 'GEVEŞEK',
  }];
  return {
    schema_version: 'rag.v1', answer_id: 'a1', request_id: 'r1', question: 'q', course_id: scope.course_id,
    outcome: opts.outcome ?? 'ANSWERED', support_status: opts.support ?? 'PARTIALLY_SUPPORTED', support_label: 'GEVEŞEK',
    answer_text: 'x', claims, evidence: opts.outcome === 'INSUFFICIENT_EVIDENCE' ? [] : evidence, support_confirmed: false, verification: 'HEURISTIC',
  };
}

const ask = (who: 'ayse' | 'mehmet' | 'instructor' | 'outsider' | 'admin', body: Record<string, unknown>, course = h.world.courses.vy) =>
  chain(h.as(who).then((auth) => ({ test: h.http().post(`/courses/${course}/answers`).set(auth).set('X-Request-ID', 'req-test-1').send(body) })));

describe('authorized scope derivation', () => {
  beforeEach(() => h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope) })));

  test('scope = READY, non-deleted, COURSE + own PRIVATE, from MySQL only', async () => {
    await ask('ayse', { question: 'AVL nedir?' }).expect(200);
    const [call] = h.ai.calls('POST', '/api/v1/rag/answer');
    expect(call.headers.authorization).toBe('Bearer rag-test-token-0123456789');
    expect(call.headers['x-request-id']).toBe('req-test-1');
    expect(call.body).toMatchObject({ schema_version: 'rag.v1', request_id: 'req-test-1', question: 'AVL nedir?' });
    expect(call.body.scope.user_id).toBe(h.world.users.ayse);
    expect(call.body.scope.course_id).toBe(h.world.courses.vy);
    expect(call.body.scope.document_ids.sort()).toEqual([ids.aysePrivate, ids.course].sort());
  });

  test('requested document_ids are intersected; foreign, pending, deleted and other-course ids are dropped', async () => {
    await ask('ayse', { question: 'q', document_ids: [ids.course, ids.mehmetPrivate, ids.otherCourse, ids.pending, ids.deleted, 'does-not-exist'] }).expect(200);
    expect(h.ai.calls('POST', '/api/v1/rag/answer')[0].body.scope.document_ids).toEqual([ids.course]);
  });

  test('nothing left after intersection → 409 NO_READY_DOCUMENTS, and Python is never called', async () => {
    const r = await ask('ayse', { question: 'q', document_ids: [ids.mehmetPrivate, ids.otherCourse] }).expect(409);
    expect(r.body.error).toMatchObject({ code: 'NO_READY_DOCUMENTS', retryable: true });
    expect(h.ai.calls('POST', '/api/v1/rag/answer')).toHaveLength(0);
  });

  test('client-supplied scope, user_id or course_id fields are rejected, never forwarded', async () => {
    for (const extra of [{ scope: { user_id: h.world.users.mehmet, course_id: h.world.courses.vy, document_ids: [ids.mehmetPrivate] } },
      { user_id: h.world.users.mehmet }, { course_id: h.world.courses.os }]) {
      const r = await ask('ayse', { question: 'q', ...extra }).expect(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(h.ai.calls('POST', '/api/v1/rag/answer')).toHaveLength(0);
  });

  test('non-members (and admins without membership) get 404', async () => {
    await ask('outsider', { question: 'q' }).expect(404);
    await ask('admin', { question: 'q' }).expect(404);
    await ask('ayse', { question: 'q' }, h.world.courses.os).expect(404);
    expect(h.ai.calls('POST', '/api/v1/rag/answer')).toHaveLength(0);
  });

  test('question validation', async () => {
    await ask('ayse', { question: '' }).expect(422);
    await ask('ayse', { question: 'x'.repeat(2001) }).expect(422);
    await ask('ayse', { question: 'q', document_ids: ['../etc'] }).expect(422);
    await ask('ayse', {}).expect(422);
  });
});

describe('pass-through and leakage defence', () => {
  test('GroundedAnswer is returned unchanged plus a documents map with current MySQL values', async () => {
    h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope) }));
    const r = await ask('ayse', { question: 'q', document_ids: [ids.course] }).expect(200);
    const expected = groundedAnswer({ course_id: h.world.courses.vy, document_ids: [ids.course] });
    const { documents, ...rest } = r.body;
    expect(rest).toEqual(expected);
    expect(documents).toEqual({ [ids.course]: { title: 'Belge c', original_filename: 'hafta4.pdf', document_type: 'slide', page_count: 2 } });
  });

  test('support status is never upgraded because citations exist (PARTIALLY/UNSUPPORTED stay as given)', async () => {
    for (const support of ['PARTIALLY_SUPPORTED', 'UNSUPPORTED']) {
      h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope, { support }) }));
      const r = await ask('ayse', { question: 'q' }).expect(200);
      expect(r.body.support_status).toBe(support);
      expect(r.body.claims[0].support_status).toBe(support);
      expect(r.body.support_confirmed).toBe(false);
    }
  });

  test('INSUFFICIENT_EVIDENCE is a normal 200, not an error', async () => {
    h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope, { outcome: 'INSUFFICIENT_EVIDENCE', support: 'UNSUPPORTED' }) }));
    const r = await ask('ayse', { question: 'Dijkstra?' }).expect(200);
    expect(r.body).toMatchObject({ outcome: 'INSUFFICIENT_EVIDENCE', evidence: [], documents: {} });
  });

  test.each([
    ['another user\'s PRIVATE document', () => ids.mehmetPrivate],
    ['another course\'s document', () => ids.otherCourse],
    ['a deleted document', () => ids.deleted],
  ])('evidence from %s fails closed with 500 and leaks nothing', async (_n, leak) => {
    h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope, { leakDoc: leak() }) }));
    const r = await ask('ayse', { question: 'q' }).expect(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(r.body)).not.toContain('Sayfa bir');
    expect(JSON.stringify(r.body)).not.toContain(leak());
  });

  test('evidence with a mismatching course_id also fails closed', async () => {
    h.ai.on('POST', '/api/v1/rag/answer', (r) => {
      const body = groundedAnswer(r.body.scope);
      body.evidence[0].course_id = h.world.courses.os;
      return { status: 200, body };
    });
    await ask('ayse', { question: 'q' }).expect(500);
  });
});

describe('AI failures are distinct from unsupported answers', () => {
  test.each([
    [503, 'RETRIEVAL_UNAVAILABLE', 503, 'AI_SERVICE_UNAVAILABLE'],
    [502, 'GENERATION_FAILED', 502, 'GENERATION_FAILED'],
    [504, 'PROVIDER_TIMEOUT', 504, 'PROVIDER_TIMEOUT'],
    [409, 'INDEX_NOT_READY', 409, 'NO_READY_DOCUMENTS'],
    [422, 'VALIDATION_ERROR', 422, 'VALIDATION_ERROR'],
    [403, 'UNAUTHORIZED_SCOPE', 500, 'INTERNAL_ERROR'],
    [401, 'UNAUTHORIZED', 500, 'INTERNAL_ERROR'],
    [500, 'INTERNAL_ERROR', 500, 'INTERNAL_ERROR'],
  ])('Python %i %s → %i %s', async (pyStatus, pyCode, status, code) => {
    h.ai.on('POST', '/api/v1/rag/answer', () => ({ status: pyStatus, body: { schema_version: 'rag.v1', error: { code: pyCode, message: 'internal detail must not leak' } } }));
    const r = await ask('ayse', { question: 'q' }).expect(status);
    expect(r.body.error.code).toBe(code);
    expect(JSON.stringify(r.body)).not.toContain('internal detail');
  });

  test('unreachable ai-service → 503 AI_SERVICE_UNAVAILABLE; slow answer → 504 PROVIDER_TIMEOUT', async () => {
    h.ai.on('POST', '/api/v1/rag/answer', () => 'drop');
    expect((await ask('ayse', { question: 'q' }).expect(503)).body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
    const rag = h.app.get(RagService) as unknown as { config: { answerTimeoutMs: number } };
    const prev = rag.config.answerTimeoutMs;
    rag.config.answerTimeoutMs = 200;
    h.ai.on('POST', '/api/v1/rag/answer', () => 'hang');
    try {
      expect((await ask('ayse', { question: 'q' }).expect(504)).body.error.code).toBe('PROVIDER_TIMEOUT');
    } finally {
      rag.config.answerTimeoutMs = prev;
    }
  });

  test('index fingerprint mismatch → 503 INDEX_VERSION_MISMATCH; Python is not asked', async () => {
    h.ai.readyIndex = { collection: 'knot_chunks_v1', embedding_fingerprint: 'sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d', index_version_id: null };
    h.app.get(IndexVersionService).invalidate();
    const r = await ask('ayse', { question: 'q' }).expect(503);
    expect(r.body.error.code).toBe('INDEX_VERSION_MISMATCH');
    expect(h.ai.calls('POST', '/api/v1/rag/answer')).toHaveLength(0);
    h.ai.readyIndex = { collection: 'other_collection', embedding_fingerprint: h.world.fingerprint, index_version_id: null };
    h.app.get(IndexVersionService).invalidate();
    await ask('ayse', { question: 'q' }).expect(503);
  });

  test('a pre-C-1 ai-service (no index identity in /ready) is treated as a mismatch', async () => {
    h.ai.readyIndex = null;
    h.app.get(IndexVersionService).invalidate();
    expect((await ask('ayse', { question: 'q' }).expect(503)).body.error.code).toBe('INDEX_VERSION_MISMATCH');
  });
});

describe('rate limit and the WBS-6/7 retrieval service method', () => {
  test('answers are rate limited per user (429)', async () => {
    const rag = h.app.get(RagService) as unknown as { answerLimiter: { limit: number } };
    const prev = rag.answerLimiter.limit;
    rag.answerLimiter.limit = 2;
    h.ai.on('POST', '/api/v1/rag/answer', (r) => ({ status: 200, body: groundedAnswer(r.body.scope) }));
    try {
      await ask('mehmet', { question: 'q' }).expect(200);
      await ask('mehmet', { question: 'q' }).expect(200);
      expect((await ask('mehmet', { question: 'q' }).expect(429)).body.error.code).toBe('RATE_LIMITED');
      await ask('ayse', { question: 'q' }).expect(200); // per user
    } finally {
      rag.answerLimiter.limit = prev;
    }
  });

  test('retrieveEvidence uses the same derivation and leakage check', async () => {
    h.ai.on('POST', '/api/v1/rag/retrieve', (r) => ({ status: 200, body: { schema_version: 'rag.v1', outcome: 'EVIDENCE_FOUND', evidence: groundedAnswer(r.body.scope).evidence } }));
    const rag = h.app.get(RagService);
    const out = await rag.retrieveEvidence(h.world.users.ayse, h.world.courses.vy, 'AVL', { documentIds: [ids.course, ids.mehmetPrivate], topK: 5 });
    const call = h.ai.calls('POST', '/api/v1/rag/retrieve')[0];
    expect(call.body.scope.document_ids).toEqual([ids.course]);
    expect(call.body.params).toEqual({ top_k: 5 });
    expect(out.documents[ids.course]).toBeDefined();
    h.ai.on('POST', '/api/v1/rag/retrieve', (r) => ({ status: 200, body: { evidence: groundedAnswer(r.body.scope, { leakDoc: ids.mehmetPrivate }).evidence } }));
    await expect(rag.retrieveEvidence(h.world.users.ayse, h.world.courses.vy, 'AVL')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(rag.retrieveEvidence(h.world.users.outsider, h.world.courses.vy, 'AVL')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
