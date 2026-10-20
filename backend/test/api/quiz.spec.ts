/** Material-based quizzes: scope/permissions, no answer key before submit, server-side grading,
 *  persistence for analytics. Uses the FAKE ai-service (the real generator is tested in Python). */
import { chain, Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start({ answerRateLimitPerMinute: 1000 }));
afterAll(() => h.stop());

let docs: { ready: string; ready2: string; pending: string; mehmetPrivate: string; other: string };

beforeEach(async () => {
  await h.reset();
  const up = async (who: 'ayse' | 'mehmet', tag: string, course = h.world.courses.vy) =>
    (await h.uploadOk(who, course, { file: Buffer.concat([PDF, Buffer.from(tag)]), title: `Belge ${tag}` })).id as string;
  docs = { ready: await up('ayse', 'a'), ready2: await up('ayse', 'b'), pending: await up('ayse', 'p'), mehmetPrivate: await up('mehmet', 'm'), other: await up('mehmet', 'o', h.world.courses.os) };
  for (const id of [docs.ready, docs.ready2, docs.mehmetPrivate, docs.other]) await h.makeReady(id);
});

function fakeQuestions(scope: { document_ids: string[] }, n: number, type = 'multiple_choice') {
  return Array.from({ length: n }, (_, i) => ({
    type, prompt: `Soru ${i + 1} ____`, options: type === 'true_false' ? ['Doğru', 'Yanlış'] : ['A', 'B', 'C', 'D'], correct_index: i % 2 === 0 ? 1 : 0,
    explanation: `Açıklama ${i + 1}`, topic: i % 2 === 0 ? 'AVL' : 'Hash', difficulty: 'medium',
    source: { chunk_id: `${scope.document_ids[0]}:c1:00${i}`, document_id: scope.document_ids[0], page_start: 1, page_end: 1, quote: `Kaynak ${i + 1}` },
  }));
}
const aiOk = (produced?: number, extra: Record<string, unknown> = {}) =>
  h.ai.on('POST', '/api/v1/quiz/generate', (r) => ({
    status: 200, body: { schema_version: 'rag.v1', request_id: 'r', generator: 'extractive-v1', llm_used: false, requested: r.body.params.count,
      produced: produced ?? r.body.params.count, warnings: [], rejected: {}, questions: fakeQuestions(r.body.scope, produced ?? r.body.params.count), ...extra },
  }));

type Who = 'ayse' | 'mehmet' | 'outsider';
const make = (who: Who, body: Record<string, unknown>, course = h.world.courses.vy) =>
  chain(h.as(who).then((auth) => ({ test: h.http().post(`/courses/${course}/quizzes`).set(auth).send(body) })));
const cfg = (over: Record<string, unknown> = {}) => ({ document_ids: [docs.ready], question_count: 5, question_types: ['multiple_choice'], difficulty: 'medium', ...over });
const authed = async (who: Who) => h.as(who);

describe('generation', () => {
  test('creates a quiz from selected READY documents; scope sent to Python is exactly the selection', async () => {
    aiOk();
    const r = await make('ayse', cfg({ document_ids: [docs.ready, docs.ready2], question_count: 10 })).expect(201);
    expect(r.body).toMatchObject({ question_count: 10, requested_count: 10, generator: 'extractive-v1', llm_used: false, difficulty: 'medium' });
    expect([...r.body.document_ids].sort()).toEqual([docs.ready, docs.ready2].sort());
    const [call] = h.ai.calls('POST', '/api/v1/quiz/generate');
    expect([...call.body.scope.document_ids].sort()).toEqual([docs.ready, docs.ready2].sort());
    expect(call.body.params).toEqual({ count: 10, question_types: ['multiple_choice'], difficulty: 'medium' });
  });

  test('the response never contains the answer key, explanation or source quote', async () => {
    aiOk();
    const r = await make('ayse', cfg()).expect(201);
    expect(JSON.stringify(r.body)).not.toMatch(/correct_index|explanation|Açıklama|Kaynak 1|quote/);
    const get = await h.http().get(`/quizzes/${r.body.id}`).set(await authed('ayse')).expect(200);
    expect(JSON.stringify(get.body)).not.toMatch(/correct_index|explanation|quote/);
  });

  test('a shortfall is reported honestly; zero questions is QUIZ_GENERATION_FAILED and nothing is stored', async () => {
    aiOk(3);
    const r = await make('ayse', cfg()).expect(201);
    expect(r.body.question_count).toBe(3);
    expect(r.body.warnings.join(' ')).toMatch(/5 soru istendi.*3 soru/);
    h.ai.on('POST', '/api/v1/quiz/generate', () => ({ status: 200, body: { generator: 'extractive-v1', llm_used: false, warnings: ['Yeterli içerik yok.'], questions: [] } }));
    const bad = await make('ayse', cfg()).expect(422);
    expect(bad.body.error.code).toBe('QUIZ_GENERATION_FAILED');
    expect(await h.prisma.quiz.count()).toBe(1);
  });

  test('malformed questions from the generator are dropped, never repaired', async () => {
    h.ai.on('POST', '/api/v1/quiz/generate', (r) => {
      const good = fakeQuestions(r.body.scope, 2);
      const bad = [
        { ...good[0], correct_index: 9 },
        { ...good[0], options: ['A', 'A', 'B', 'C'] },
        { ...good[0], source: { ...good[0].source, quote: '' } },
      ];
      return { status: 200, body: { generator: 'extractive-v1', llm_used: false, warnings: [], questions: [...good, ...bad] } };
    });
    const r = await make('ayse', cfg()).expect(201);
    expect(r.body.question_count).toBe(2);
  });

  test('a question sourced outside the authorized scope fails closed', async () => {
    h.ai.on('POST', '/api/v1/quiz/generate', () => ({ status: 200, body: { generator: 'g', llm_used: false, questions: fakeQuestions({ document_ids: [docs.mehmetPrivate] }, 1) } }));
    const r = await make('ayse', cfg()).expect(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
  });

  test('access: other course / non-member / other users private / not-ready documents are refused', async () => {
    aiOk();
    await make('ayse', cfg(), h.world.courses.os).expect(404);
    await make('outsider', cfg()).expect(404);
    expect((await make('ayse', cfg({ document_ids: [docs.mehmetPrivate] })).expect(409)).body.error.code).toBe('NO_READY_DOCUMENTS');
    expect((await make('ayse', cfg({ document_ids: [docs.ready, docs.mehmetPrivate] })).expect(409)).body.error.code).toBe('DOCUMENT_NOT_READY');
    expect((await make('ayse', cfg({ document_ids: [docs.pending] })).expect(409)).body.error.code).toBe('NO_READY_DOCUMENTS');
    expect((await make('ayse', cfg({ document_ids: [docs.ready, docs.other] })).expect(409)).body.error.code).toBe('DOCUMENT_NOT_READY');
    expect(h.ai.calls('POST', '/api/v1/quiz/generate')).toHaveLength(0);
  });

  test('configuration is validated (count 5/10/15, types, difficulty, at least one document)', async () => {
    aiOk();
    await make('ayse', cfg({ question_count: 7 })).expect(422);
    await make('ayse', cfg({ question_types: [] })).expect(422);
    await make('ayse', cfg({ question_types: ['essay'] })).expect(422);
    await make('ayse', cfg({ difficulty: 'insane' })).expect(422);
    await make('ayse', cfg({ document_ids: [] })).expect(422);
  });

  test('AI service failures are mapped, not leaked', async () => {
    h.ai.on('POST', '/api/v1/quiz/generate', () => ({ status: 503, body: { error: { code: 'RETRIEVAL_UNAVAILABLE', message: 'x', request_id: 'r', retryable: true } } }));
    expect((await make('ayse', cfg()).expect(503)).body.error.code).toBe('AI_SERVICE_UNAVAILABLE');
  });
});

describe('taking and grading', () => {
  async function newQuiz(count = 5) {
    aiOk(count);
    return (await make('ayse', cfg({ question_count: count })).expect(201)).body;
  }
  const attemptOf = async (quizId: string, who: Who = 'ayse') => (await h.http().post(`/quizzes/${quizId}/attempts`).set(await authed(who)).expect(who === 'ayse' ? 201 : 404)).body;

  test('start (resumable), autosave, submit: graded on the server, returns key, explanation and source', async () => {
    const quiz = await newQuiz(5);
    const a = await attemptOf(quiz.id);
    expect(a.status).toBe('IN_PROGRESS');
    expect((await attemptOf(quiz.id)).id).toBe(a.id);
    const [q1, q2, q3] = quiz.questions;
    // fake key: even index -> 1, odd -> 0
    const saved = await h.http().put(`/quiz-attempts/${a.id}/answers`).set(await authed('ayse')).send({ answers: [{ question_id: q1.id, selected_index: 1 }, { question_id: q2.id, selected_index: 3 }] }).expect(200);
    expect(saved.body).toEqual({ answered: 2 });
    const mid = await h.http().get(`/quiz-attempts/${a.id}`).set(await authed('ayse')).expect(200);
    expect(mid.body.answers).toHaveLength(2);
    expect(JSON.stringify(mid.body)).not.toMatch(/correct_index|explanation|quote/);
    const sub = await h.http().post(`/quiz-attempts/${a.id}/submit`).set(await authed('ayse')).send({ answers: [{ question_id: q2.id, selected_index: 0 }, { question_id: q3.id, selected_index: 1 }] }).expect(200);
    expect(sub.body).toMatchObject({ status: 'SUBMITTED', correct_count: 3, total_count: 5, score_pct: 60 });
    const r = sub.body.results;
    expect(r[0]).toMatchObject({ is_correct: true, correct_index: 1, selected_index: 1, explanation: 'Açıklama 1', topic: 'AVL' });
    expect(r[3]).toMatchObject({ is_correct: false, selected_index: null });
    expect(r[0].source).toMatchObject({ document_id: docs.ready, document_title: 'Belge a', quote: 'Kaynak 1', page_start: 1 });
    const again = await h.http().post(`/quiz-attempts/${a.id}/submit`).set(await authed('ayse')).send({}).expect(200);
    expect(again.body.score_pct).toBe(60);
    await h.http().put(`/quiz-attempts/${a.id}/answers`).set(await authed('ayse')).send({ answers: [] }).expect(409);
    expect((await h.http().get(`/quiz-attempts/${a.id}`).set(await authed('ayse')).expect(200)).body.results).toHaveLength(5);
  });

  test('answers for unknown questions or out-of-range options are rejected', async () => {
    const quiz = await newQuiz(5);
    const a = await attemptOf(quiz.id);
    const put = async (answers: unknown[]) => h.http().put(`/quiz-attempts/${a.id}/answers`).set(await authed('ayse')).send({ answers });
    await put([{ question_id: 'nope', selected_index: 0 }]).then((r) => expect(r.status).toBe(422));
    await put([{ question_id: quiz.questions[0].id, selected_index: 4 }]).then((r) => expect(r.status).toBe(422));
    await put([{ question_id: quiz.questions[0].id, selected_index: -1 }]).then((r) => expect(r.status).toBe(422));
  });

  test('quizzes and attempts belong to their owner (404 for everyone else)', async () => {
    const quiz = await newQuiz(5);
    const a = await attemptOf(quiz.id);
    for (const who of ['mehmet', 'outsider'] as const) {
      await h.http().get(`/quizzes/${quiz.id}`).set(await authed(who)).expect(404);
      await h.http().get(`/quiz-attempts/${a.id}`).set(await authed(who)).expect(404);
      await h.http().post(`/quiz-attempts/${a.id}/submit`).set(await authed(who)).send({}).expect(404);
      await h.http().put(`/quiz-attempts/${a.id}/answers`).set(await authed(who)).send({ answers: [] }).expect(404);
    }
    expect((await h.http().get('/quizzes').set(await authed('mehmet')).expect(200)).body).toEqual([]);
  });

  test('deleting the source document clears stored quotes but keeps references', async () => {
    const quiz = await newQuiz(5);
    const a = await attemptOf(quiz.id);
    await h.http().post(`/quiz-attempts/${a.id}/submit`).set(await authed('ayse')).send({}).expect(200);
    await h.http().delete(`/documents/${docs.ready}`).set(await authed('ayse')).expect(202);
    const r = (await h.http().get(`/quiz-attempts/${a.id}`).set(await authed('ayse')).expect(200)).body;
    expect(r.results[0].source).toMatchObject({ document_id: docs.ready, quote: null });
    expect(await h.prisma.quizQuestion.count({ where: { sourceQuote: { not: null } } })).toBe(0);
  });

  test('analytics: attempts, score, completed quizzes and per-topic accuracy are persisted and aggregated', async () => {
    const empty = await h.http().get('/analytics/quiz-summary').set(await authed('ayse')).expect(200);
    expect(empty.body).toEqual({ completed_quizzes: 0, average_score_pct: null, attempts: [], topics: [] });
    const quiz = await newQuiz(5);
    const a = await attemptOf(quiz.id);
    const answers = quiz.questions.map((q: { id: string }, i: number) => ({ question_id: q.id, selected_index: i % 2 === 0 ? 1 : 0 }));
    await h.http().post(`/quiz-attempts/${a.id}/submit`).set(await authed('ayse')).send({ answers }).expect(200);
    const s = (await h.http().get('/analytics/quiz-summary').set(await authed('ayse')).expect(200)).body;
    expect(s).toMatchObject({ completed_quizzes: 1, average_score_pct: 100 });
    expect(s.attempts).toHaveLength(1);
    expect(s.topics).toEqual(expect.arrayContaining([{ topic: 'AVL', answered: 3, correct: 3, accuracy_pct: 100 }, { topic: 'Hash', answered: 2, correct: 2, accuracy_pct: 100 }]));
    expect((await h.http().get('/analytics/quiz-summary').set(await authed('mehmet')).expect(200)).body.completed_quizzes).toBe(0);
    const list = (await h.http().get(`/quizzes?course_id=${h.world.courses.vy}`).set(await authed('ayse')).expect(200)).body;
    expect(list[0].latest_attempt).toMatchObject({ status: 'SUBMITTED', score_pct: 100 });
    expect((await h.http().get('/quiz-attempts').set(await authed('ayse')).expect(200)).body).toHaveLength(1);
  });

  test('unauthenticated requests are refused', async () => {
    await h.http().get('/quizzes').expect(401);
    await h.http().post(`/courses/${h.world.courses.vy}/quizzes`).send(cfg()).expect(401);
  });
});
