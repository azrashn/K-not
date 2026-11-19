import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QuizGenerator, validV2Question } from '../../src/learning/quiz-generator';
import { LearningService } from '../../src/learning/learning.service';
import { quizError, describeFailure, failure, FAILURE_MESSAGES } from '../../src/learning/quiz-failures';
import { qualityState } from '../../src/learning/quiz-public';

const TEXT = 'BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır.';
const SOURCE = { id: 's1', text: TEXT, material_id: 'file_bfs', version: 'v1', title: 'Graf notları', kind: 'TXT', location: { section: 1 } };
const USER = { id: 'u', role: 'USER' } as any;
const QUALITY = { pipeline_version: 'single-call-v1', deterministic_validation: true, structural_validation: true,
  independent_model_review: false, truth_verified: false, attempts: 1, feedback_mode: 'SOURCE_EXPLANATION' };

const mcq = (over: any = {}) => ({
  slot: 0, kind: 'MULTIPLE_CHOICE', variant: undefined, question: 'BFS bekleyen düğümleri hangi yapıda tutar?',
  options: ['Yığın', 'Kuyruk', 'Ağaç', 'Liste'], expected: '1', quote: TEXT, source_index: 1,
  explanation: 'Kaynak kuyruk der.', objective: null, option_feedback: [], experimental: true, llm_used: true,
  question_style: 'CONCEPTUAL', assessment: 'SOURCE_CHECKED_UNVERIFIED', quality: QUALITY, note: 'not', ...over,
});

function setup(reply: any, sources: any[] = [SOURCE]) {
  const created: any[] = [];
  const prisma = { learningQuiz: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) } };
  const knowledge = {
    ask: jest.fn().mockResolvedValue({ evidence: sources, video_learning: [] }),
    source: jest.fn().mockResolvedValue({}),
  };
  const ai = { call: jest.fn().mockResolvedValue(reply) };
  const generator = new QuizGenerator(prisma as any, knowledge as any, ai as any);
  return { generator, prisma, knowledge, ai, created };
}

const ok = (questions: any[], failures: any[] = []) => ({ kind: 'response', status: 200, body: { engine: 'v2', questions, failures } });
const request = (items: any[] = [{ kind: 'MULTIPLE_CHOICE' }], extra: any = {}) =>
  ({ topic: 'BFS', items, budgetSeconds: 130, ...extra });

describe('validV2Question', () => {
  const item = { kind: 'MULTIPLE_CHOICE' };
  test('accepts a checked v2 question', () => expect(validV2Question(mcq(), item, [SOURCE])).toBe(true));
  test.each([
    ['legacy quality flags', { quality: { option_audit_version: 2, structural_validation: true } }],
    ['deterministic flag missing', { quality: { ...QUALITY, deterministic_validation: false } }],
    ['another kind', { kind: 'TRUE_FALSE' }],
    ['quote not in the source', { quote: 'BFS her zaman yığın kullanır.' }],
    ['source index out of range', { source_index: 2 }],
    ['three options', { options: ['a', 'b', 'c'] }],
    ['duplicate options', { options: ['Kuyruk', 'kuyruk', 'Ağaç', 'Liste'] }],
    ['key outside the options', { expected: '4' }],
    ['empty question', { question: ' ' }],
  ])('rejects %s', (_label, over) => expect(validV2Question(mcq(over), item, [SOURCE])).toBe(false));
  test('a calculation asked as a short answer (no number in the sources) is accepted only when marked', () => {
    const base = { quote: TEXT, source_index: 1, quality: QUALITY, question: 'Soru metni burada?', options: [], expected: 'kuyruk' };
    const calcItem = { kind: 'SHORT_ANSWER', variant: 'CALCULATION' as const };
    expect(validV2Question({ ...base, kind: 'SHORT_ANSWER', downgraded_from: 'CALCULATION' }, calcItem, [SOURCE])).toBe(true);
    expect(validV2Question({ ...base, kind: 'SHORT_ANSWER' }, calcItem, [SOURCE])).toBe(false); // unmarked
    expect(validV2Question({ ...base, kind: 'SHORT_ANSWER', downgraded_from: 'CALCULATION' }, { kind: 'SHORT_ANSWER' }, [SOURCE]))
      .toBe(true); // the mark changes nothing for a plain short answer
    expect(validV2Question({ ...base, kind: 'OPEN', expected: '', downgraded_from: 'CALCULATION' }, calcItem, [SOURCE])).toBe(false);
  });
  test('a stem leaning on an earlier sentence has its own reason', () => {
    expect(describeFailure(failure(0, 'TRUE_FALSE', 'NOT_SELF_CONTAINED', 2))).toContain('tek başına anlaşılmıyordu (2 deneme).');
  });
  test('kind specific shapes', () => {
    const base = { quote: TEXT, source_index: 1, quality: QUALITY, question: 'Soru metni burada?' };
    expect(validV2Question({ ...base, kind: 'OPEN', options: [], expected: '' }, { kind: 'OPEN' }, [SOURCE])).toBe(true);
    expect(validV2Question({ ...base, kind: 'OPEN', options: [], expected: 'x' }, { kind: 'OPEN' }, [SOURCE])).toBe(false);
    expect(validV2Question({ ...base, kind: 'SHORT_ANSWER', options: [], expected: '' }, { kind: 'SHORT_ANSWER' }, [SOURCE])).toBe(false);
    expect(validV2Question({ ...base, kind: 'CLOZE', question: 'Tamamla: _____ ve _____', options: [], expected: 'kuyruk' },
      { kind: 'CLOZE' }, [SOURCE])).toBe(false);
    const calc = { ...base, kind: 'SHORT_ANSWER', variant: 'CALCULATION', options: [], expected: '480' };
    expect(validV2Question(calc, { kind: 'SHORT_ANSWER', variant: 'CALCULATION' }, [SOURCE])).toBe(true);
    expect(validV2Question(calc, { kind: 'SHORT_ANSWER' }, [SOURCE])).toBe(false);
  });
});

describe('QuizGenerator.generate', () => {
  test('sends one v2 request and stores the checked question with its source', async () => {
    const { generator, ai, created, knowledge } = setup(ok([mcq()]));
    const r = await generator.generate(USER, 'c', request([{ kind: 'MULTIPLE_CHOICE' }],
      { styleHint: 'Sınav stili', avoidStems: ['Önceki soru?'] }));
    const [method, path, opts] = ai.call.mock.calls[0];
    expect([method, path]).toEqual(['POST', '/api/v1/knowledge/quiz']);
    expect(opts.body).toMatchObject({ topic: 'BFS', items: [{ kind: 'MULTIPLE_CHOICE' }], language: 'tr', budget_seconds: 130,
      style_hint: 'Sınav stili', avoid_stems: ['Önceki soru?'] });
    expect(opts.body.evidence[0].text).toBe(TEXT);
    expect(opts.timeoutMs).toBe(150_000);
    expect(r.failures).toEqual([]);
    expect(r.quizzes[0]).toMatchObject({ slot: 0, kind: 'MULTIPLE_CHOICE', quality_state: 'SOURCE_CHECKED', objective: null });
    expect(r.quizzes[0]).not.toHaveProperty('expected');
    expect(r.stems).toEqual(['BFS bekleyen düğümleri hangi yapıda tutar?']);
    expect(created[0]).toMatchObject({ kind: 'MULTIPLE_CHOICE', materialId: 'file_bfs', segmentId: 's1', version: 'v1' });
    expect(created[0].data).toMatchObject({ expected: '1', quote: TEXT, source: SOURCE, scope: { mode: 'course' } });
    expect(created[0].data).not.toHaveProperty('slot');
    expect(knowledge.source).toHaveBeenCalledWith(USER, 'c', 'file_bfs', 's1');
  });

  test('a variant is sent only when present', async () => {
    const { generator, ai } = setup(ok([], [{ slot: 0, code: 'CALC_MISMATCH', attempts: 2 }]));
    await generator.generate(USER, 'c', request([{ kind: 'SHORT_ANSWER', variant: 'CALCULATION' }]));
    expect(ai.call.mock.calls[0][2].body.items).toEqual([{ kind: 'SHORT_ANSWER', variant: 'CALCULATION' }]);
  });

  test('good questions are kept, each failure keeps its own reason', async () => {
    const items = [{ kind: 'MULTIPLE_CHOICE' }, { kind: 'MULTIPLE_CHOICE' }, { kind: 'MULTIPLE_CHOICE' }];
    const { generator, created } = setup(ok([mcq(), mcq({ slot: 2, quote: 'uydurma alıntı metni' })],
      [{ slot: 1, code: 'QUOTE_NOT_FOUND', attempts: 2, detail: 'x' }]));
    const r = await generator.generate(USER, 'c', request(items));
    expect(r.quizzes.map((q) => q.slot)).toEqual([0]);
    expect(r.failures.map((f) => [f.slot, f.code, f.attempts])).toEqual([[1, 'QUOTE_NOT_FOUND', 2], [2, 'INVALID_SHAPE', 1]]);
    expect(r.failures[0].reason).toBe(FAILURE_MESSAGES.QUOTE_NOT_FOUND);
    expect(created).toHaveLength(1);
  });

  test('a slot the ai-service forgot is reported, not silently dropped', async () => {
    const { generator } = setup(ok([mcq()]));
    const r = await generator.generate(USER, 'c', request([{ kind: 'MULTIPLE_CHOICE' }, { kind: 'TRUE_FALSE' }]));
    expect(r.failures).toEqual([expect.objectContaining({ slot: 1, kind: 'TRUE_FALSE', code: 'MISSING' })]);
  });

  test.each([
    [{ kind: 'timeout' }, 'TIMEOUT'],
    [{ kind: 'unreachable' }, 'MODEL_UNREACHABLE'],
    [{ kind: 'response', status: 503, body: { detail: { code: 'MODEL_UNREACHABLE' } } }, 'MODEL_UNREACHABLE'],
    [{ kind: 'response', status: 409, body: { detail: { code: 'QUIZ_ENGINE_DISABLED' } } }, 'ENGINE_DISABLED'],
    [{ kind: 'response', status: 422, body: { detail: { code: 'QUIZ_NO_SOURCE' } } }, 'NO_SOURCE'],
    [{ kind: 'response', status: 422, body: { detail: [{ msg: 'bad' }] } }, 'AI_ERROR'],
    [{ kind: 'response', status: 200, body: { kind: 'MULTIPLE_CHOICE' } }, 'AI_ERROR'],
  ])('%j fails every item with %s and stores nothing', async (reply, code) => {
    const { generator, prisma } = setup(reply);
    const r = await generator.generate(USER, 'c', request([{ kind: 'MULTIPLE_CHOICE' }, { kind: 'OPEN' }]));
    expect(r.quizzes).toEqual([]);
    expect(r.failures.map((f) => [f.slot, f.code])).toEqual([[0, code], [1, code]]);
    expect(prisma.learningQuiz.create).not.toHaveBeenCalled();
  });

  test('no source means no model call', async () => {
    const { generator, ai } = setup(ok([]), []);
    await expect(generator.generate(USER, 'c', request())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ai.call).not.toHaveBeenCalled();
  });
});

describe('POST /quizzes start() with QUIZ_ENGINE', () => {
  const service = (reply: any, quizEngine?: 'v2' | 'legacy') => {
    const s = setup(reply);
    // The v2 quiz reads its source pool (materials and their segments) and returns the stored row.
    Object.assign(s.knowledge, {
      materials: jest.fn().mockResolvedValue([{ id: 'file_bfs', kind: 'TXT', title: 'Graf notları', status: 'READY', version: 'v1' }]),
      preview: jest.fn().mockResolvedValue({ segments: [{ id: 's1', text: TEXT, location: { section: 1 } }] }),
    });
    Object.assign(s.prisma.learningQuiz, { findFirst: jest.fn(async ({ where }: any) => s.created.find((r) => r.id === where.id)) });
    const learning = new LearningService(s.prisma as any, { requireMember: jest.fn() } as any, s.knowledge as any, s.ai as any, s.generator,
      quizEngine ? ({ quizEngine } as any) : undefined);
    return { learning, ...s };
  };

  test('v2 returns the same public shape as before, without the slot', async () => {
    const { learning } = service(ok([mcq()]), 'v2');
    const quiz = await learning.start(USER, 'c', { topic: 'BFS', kind: 'MULTIPLE_CHOICE' });
    expect(Object.keys(quiz).sort()).toEqual(['assessment', 'experimental', 'id', 'kind', 'note', 'objective', 'options',
      'question', 'question_style', 'quality_state', 'scope', 'source', 'topic', 'watched_only'].sort());
  });

  test.each([
    [ok([], [{ slot: 0, code: 'QUOTE_NOT_FOUND', attempts: 2 }]), 'GENERATION_FAILED', 'alıntı kaynakta birebir bulunamadı (2 deneme)'],
    [ok([], [{ slot: 0, code: 'TIMEOUT', attempts: 1 }]), 'PROVIDER_TIMEOUT', 'zaman aşımı'],
    [ok([], [{ slot: 0, code: 'BUDGET_EXHAUSTED', attempts: 1 }]), 'PROVIDER_TIMEOUT', 'süre bu soruya yetmedi'],
    [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE', 'ulaşılamadı'],
    [{ kind: 'response', status: 409, body: { detail: { code: 'QUIZ_ENGINE_DISABLED' } } }, 'AI_SERVICE_UNAVAILABLE', 'QUIZ_ENGINE=legacy'],
  ])('v2 failure is a known public error that names the reason', async (reply, code, text) => {
    const { learning } = service(reply, 'v2');
    const error = await learning.start(USER, 'c', { topic: 'BFS', kind: 'MULTIPLE_CHOICE' }).catch((e) => e);
    expect(error.code).toBe(code);
    expect(error.message).toContain(text);
    expect(error.details.reasons[0].code).toBeDefined();
  });

  test('QUIZ_ENGINE=legacy keeps the old request and acceptance rules', async () => {
    const { learning, ai } = service({ kind: 'response', status: 422, body: {} }, 'legacy');
    expect(learning.quizEngine).toBe('legacy');
    await expect(learning.start(USER, 'c', { topic: 'BFS', kind: 'MULTIPLE_CHOICE' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(ai.call.mock.calls[0][2].body).toMatchObject({ question: 'BFS', kind: 'MULTIPLE_CHOICE' });
    expect(ai.call.mock.calls[0][2].body).not.toHaveProperty('items');
  });

  test('engine selection', () => {
    const s = setup(ok([]));
    expect(new LearningService({} as any, {} as any, {} as any, {} as any).quizEngine).toBe('legacy');
    expect(new LearningService({} as any, {} as any, {} as any, {} as any, s.generator).quizEngine).toBe('v2');
    expect(new LearningService({} as any, {} as any, {} as any, {} as any, s.generator, { quizEngine: 'v2' } as any).quizEngine).toBe('v2');
  });
});

describe('failure texts and quality labels', () => {
  test('every message is Turkish text and unknown codes still read', () => {
    for (const m of Object.values(FAILURE_MESSAGES)) expect(m.length).toBeGreaterThan(10);
    expect(describeFailure(failure(0, 'OPEN', 'SOMETHING_NEW', 1))).toBe('Soru hazırlanamadı (SOMETHING_NEW).');
    expect(quizError([]).code).toBe('GENERATION_FAILED');
  });
  test('a truncated answer has its own reason and counts as a failed question, not a model outage', () => {
    expect(describeFailure(failure(0, 'TRUE_FALSE', 'TRUNCATED', 2)))
      .toBe('Modelin yanıtı izin verilen uzunluğa ulaştığı için yarıda kesildi (2 deneme).');
    expect(quizError([failure(0, 'TRUE_FALSE', 'TRUNCATED', 2)]).code).toBe('GENERATION_FAILED');
  });
  test('every failure code of the ai-service has a Turkish message', () => {
    const source = readFileSync(join(__dirname, '../../../ai-service/src/knot_rag/quiz_checks.py'), 'utf8');
    const names = /FAILURE_CODES = \(([^)]*)\)/.exec(source)![1].split(',').map((s) => s.trim()).filter(Boolean);
    const codes = names.map((n) => new RegExp(`^${n} = "([A-Z_]+)"`, 'm').exec(source)![1]);
    expect(codes).toContain('TRUNCATED');
    for (const code of codes) expect(FAILURE_MESSAGES[code]).toBeDefined();
  });
  test('stored quizzes keep the label of the engine that wrote them', () => {
    expect(qualityState(QUALITY)).toBe('SOURCE_CHECKED');
    expect(qualityState({ option_audit_version: 3, deterministic_source_validation: true })).toBe('SOURCE_RECALL_CHECKED');
    expect(qualityState({ option_audit_version: 2 })).toBe('MODEL_REVIEWED_UNVERIFIED');
    expect(qualityState(undefined)).toBe('LEGACY_NOT_REVIEWED');
  });
});
