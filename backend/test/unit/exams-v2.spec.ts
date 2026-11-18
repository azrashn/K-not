import { ExamsService, EXAM_BATCH_BUDGET_SECONDS } from '../../src/learning/exams.service';
import { ApiError } from '../../src/common/errors';
import { buildExamProfile } from '../../src/learning/exam-style';
import { commonReason, groundTopics, planExamItems, planExamKinds } from '../../src/learning/exam-plan';
import { isDuplicateStem } from '../../src/learning/quiz-repeat';
import { QuizGenerator } from '../../src/learning/quiz-generator';
import { failure } from '../../src/learning/quiz-failures';

const EXAM = ['1. Hangisi FIFO çalışır?', 'A) Yığın', 'B) Kuyruk', 'C) Ağaç', '2. BFS hangi yapıyı kullanır? Açıklayınız.',
  '3. Dijkstra negatif kenarla çalışır mı? Doğru veya yanlış yazınız.', '4. 3 düğümlü yolun maliyetini hesaplayınız.'].join('\n');
const profile = buildExamProfile(EXAM);
const u = { id: 'u', role: 'USER' } as any;

type Batch = { topic: string; items: { kind: string; variant: string | null }[]; avoidStems: string[]; budgetSeconds: number; styleHint: string | null };

/** A generator double: `answer(batch, call)` decides per request; by default every question is produced. */
function make(answer?: (b: Batch, call: number) => any, over: { knowledge?: any; config?: any } = {}) {
  const prisma = {
    examStyle: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', name: 'Final', profile }) },
    generatedExam: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date(), finishedAt: null })),
      update: jest.fn(async ({ data }) => data),
    },
  };
  const batches: Batch[] = [];
  let n = 0;
  const produce = (b: Batch) => ({
    quizzes: b.items.map((it, slot) => ({ id: `q${++n}`, slot, kind: it.kind })),
    stems: b.items.map((it, slot) => `${b.topic} sorusu ${n}-${slot} ${it.kind}`),
    failures: [],
  });
  const generator = {
    generate: jest.fn(async (_u: any, _c: any, b: Batch) => {
      batches.push({ ...b, avoidStems: [...b.avoidStems] });
      const out = answer?.(b, batches.length);
      if (out instanceof Error) throw out;
      return out ?? produce(b);
    }),
  };
  const svc = new ExamsService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any,
    over.knowledge, generator as unknown as QuizGenerator, over.config);
  return { svc, prisma, generator, batches, produce };
}
const runV2 = (svc: any, items: any[], topics: string[]) => svc.runV2(u, 'c', 'x1', items, topics, undefined, 'Sınav stili: kısa');
const last = (prisma: any) => prisma.generatedExam.update.mock.calls.at(-1)[0].data;
const fails = (b: Batch, code: string, attempts = 1) =>
  ({ quizzes: [], stems: [], failures: b.items.map((it, slot) => failure(slot, it.kind, code, attempts, it.variant)) });

const MC = { kind: 'MULTIPLE_CHOICE' }, OPEN = { kind: 'OPEN' }, TF = { kind: 'TRUE_FALSE' };
const CALC = { kind: 'SHORT_ANSWER', variant: 'CALCULATION' };

describe('v2 exam plan', () => {
  test('a calculation stays a calculation; the kind mix is the legacy one', () => {
    const items = planExamItems(profile, 8);
    expect(items.map((i) => i.kind)).toEqual(planExamKinds(profile, 8));
    expect(items.filter((i) => i.kind === 'SHORT_ANSWER').every((i) => i.variant === 'CALCULATION')).toBe(true);
    expect(items.some((i) => i.variant === 'CALCULATION')).toBe(true);
  });
});

describe('v2 generation run', () => {
  test('slots go to topics in turn and one topic is asked in one request', async () => {
    const { svc, prisma, batches } = make();
    await runV2(svc, [MC, OPEN, TF, CALC], ['BFS', 'DFS']);
    expect(batches.map((b) => [b.topic, b.items.map((i) => i.kind)])).toEqual([
      ['BFS', ['MULTIPLE_CHOICE', 'TRUE_FALSE']],
      ['DFS', ['OPEN', 'SHORT_ANSWER']],
    ]);
    expect(batches[1].items[1]).toEqual({ kind: 'SHORT_ANSWER', variant: 'CALCULATION' });
    expect(batches.every((b) => b.budgetSeconds === EXAM_BATCH_BUDGET_SECONDS && b.styleHint === 'Sınav stili: kısa')).toBe(true);
    const data = last(prisma);
    expect(data.status).toBe('READY');
    // stored in plan order, not request order
    expect(data.items.map((i: any) => [i.kind, i.topic])).toEqual([
      ['MULTIPLE_CHOICE', 'BFS'], ['OPEN', 'DFS'], ['TRUE_FALSE', 'BFS'], ['SHORT_ANSWER', 'DFS']]);
    expect(data.items[0]).toEqual({ quiz_id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'BFS' });
    expect(data.note).toBeNull();
  });

  test('a topic asks at most three questions per request', async () => {
    const { svc, batches } = make();
    await runV2(svc, [MC, MC, MC, MC, MC], ['BFS']);
    expect(batches.map((b) => b.items.length)).toEqual([3, 2]);
  });

  test('earlier questions are passed on so later requests avoid repeating them', async () => {
    const { svc, batches } = make();
    await runV2(svc, [MC, OPEN], ['BFS', 'DFS']);
    expect(batches[0].avoidStems).toEqual([]);
    expect(batches[1].avoidStems).toHaveLength(1);
  });

  test('one timed-out request does not stop the exam; the slot is tried again with the next topic', async () => {
    const { svc, prisma, batches } = make((b, call) => (call === 1 ? fails(b, 'TIMEOUT') : undefined));
    await runV2(svc, [MC, OPEN], ['BFS', 'DFS']);
    expect(batches.map((b) => b.topic)).toEqual(['BFS', 'DFS', 'DFS']);
    const data = last(prisma);
    expect(data.status).toBe('READY');
    expect(data.failures).toEqual([{ topic: 'BFS', kind: 'MULTIPLE_CHOICE', code: 'TIMEOUT',
      reason: 'Model soruyu ayrılan süre içinde yazamadı (zaman aşımı).' }]);
  });

  test('two requests in a row that only time out stop the run', async () => {
    const { svc, prisma, batches } = make((b) => fails(b, 'TIMEOUT'));
    await runV2(svc, [MC, OPEN, TF], ['A', 'B', 'C']);
    expect(batches).toHaveLength(2);
    expect(last(prisma)).toMatchObject({ status: 'FAILED' });
    expect(last(prisma).note).toContain('arka arkaya iki kez');
  });

  test('a produced question in between resets the timeout count', async () => {
    const { svc, prisma, batches } = make((b, call) => (call === 2 ? undefined : call <= 3 ? fails(b, 'TIMEOUT') : undefined));
    await runV2(svc, [MC, OPEN, TF], ['A', 'B', 'C']);
    expect(batches.length).toBeGreaterThan(3);
    expect(last(prisma).note ?? '').not.toContain('arka arkaya');
  });

  test('an unreachable model stops at once and keeps what was made', async () => {
    const { svc, prisma, batches } = make((b, call) => (call === 1 ? undefined : fails(b, 'MODEL_UNREACHABLE', 0)));
    await runV2(svc, [MC, OPEN, TF], ['A', 'B', 'C']);
    expect(batches).toHaveLength(2);
    expect(last(prisma)).toMatchObject({ status: 'PARTIAL' });
    expect(last(prisma).note).toContain('modele ulaşılamadığı');
  });

  test('a topic without a source fails its slots without a model call and the next topic is tried', async () => {
    const { svc, prisma } = make((b) => (b.topic === 'yok' ? new ApiError('VALIDATION_ERROR', 'Kaynak yok.') : undefined));
    await runV2(svc, [MC], ['yok', 'BFS']);
    const data = last(prisma);
    expect(data.status).toBe('READY');
    expect(data.items[0].topic).toBe('BFS');
    expect(data.failures[0]).toMatchObject({ topic: 'yok', code: 'NO_SOURCE' });
  });

  test('every slot gets at most one retry; a single topic gets none', async () => {
    const twoTopics = make((b) => fails(b, 'QUOTE_NOT_FOUND', 2));
    await runV2(twoTopics.svc, [MC, OPEN], ['A', 'B']);
    expect(twoTopics.batches).toHaveLength(4);
    const oneTopic = make((b) => fails(b, 'QUOTE_NOT_FOUND', 2));
    await runV2(oneTopic.svc, [MC, OPEN], ['A']);
    expect(oneTopic.batches).toHaveLength(1);
  });

  test('a failed exam names the most common reason', async () => {
    const { svc, prisma } = make((b) => fails(b, 'QUOTE_NOT_FOUND', 2));
    await runV2(svc, [MC, OPEN], ['A', 'B']);
    const data = last(prisma);
    expect(data.status).toBe('FAILED');
    expect(data.note).toContain('kaynaklara dayalı soru hazırlanamadı');
    expect(data.note).toContain('En sık neden (4/4 deneme): Modelin gösterdiği alıntı kaynakta birebir bulunamadı (2 deneme).');
  });

  test('a partial exam says how many were made and why the rest were not', async () => {
    const { svc, prisma } = make((b) => (b.items[0].kind === 'OPEN' ? fails(b, 'ANSWER_LEAKED', 2) : undefined));
    await runV2(svc, [MC, OPEN], ['A', 'B']);
    expect(last(prisma)).toMatchObject({ status: 'PARTIAL' });
    expect(last(prisma).note).toContain("2 sorudan 1'i hazırlanabildi.");
    expect(last(prisma).note).toContain('cevabı ele veriyordu');
  });

  test('an unexpected error ends the run as failed and is rethrown', async () => {
    const { svc, prisma } = make(() => new Error('boom'));
    await expect(runV2(svc, [MC], ['A'])).rejects.toThrow('boom');
    expect(last(prisma)).toMatchObject({ status: 'FAILED', note: 'Beklenmeyen bir hata oluştu.' });
  });
});

describe('creating a v2 exam', () => {
  const knowledge = {
    materials: jest.fn().mockResolvedValue([{ id: 'm1', status: 'READY', title: 'Graf notları' }]),
    preview: jest.fn().mockResolvedValue({ segments: [{ text: 'Kuyruk ve BFS\nBFS kuyruk kullanır. Dijkstra negatif kenarla çalışmaz.' }] }),
  };

  test('past-exam terms are grounded in the course sources', async () => {
    const { svc, prisma } = make(() => new Promise(() => undefined), { knowledge });
    const exam = await svc.create(u, 'c', { exam_style_id: 'e1', count: 4 });
    const topics = prisma.generatedExam.create.mock.calls[0][0].data.topics as string[];
    expect(topics).toEqual(expect.arrayContaining(['Kuyruk ve BFS']));
    expect(topics.every((t) => !/^(hesaplayınız|açıklayınız)$/i.test(t))).toBe(true);
    expect(exam).toMatchObject({ status: 'GENERATING', requested: 4 });
  });

  test('topics the student wrote are never filtered', async () => {
    const { svc, prisma } = make(() => new Promise(() => undefined), { knowledge });
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 2, topics: ['Kırmızı-siyah ağaç'] });
    expect(prisma.generatedExam.create.mock.calls[0][0].data.topics).toEqual(['Kırmızı-siyah ağaç']);
  });

  test('QUIZ_ENGINE=legacy keeps the legacy run and topics', async () => {
    const own = { materials: jest.fn().mockResolvedValue([]), preview: jest.fn() };
    const legacy = make(undefined, { knowledge: own, config: { quizEngine: 'legacy' } });
    expect(legacy.svc.quizEngine).toBe('legacy');
    const learning = { start: jest.fn(() => new Promise(() => undefined)) };
    (legacy.svc as any).learning = learning;
    await legacy.svc.create(u, 'c', { exam_style_id: 'e1', count: 2, topics: ['BFS'] });
    await new Promise((r) => setImmediate(r));
    expect(legacy.generator.generate).not.toHaveBeenCalled();
    expect(own.materials).not.toHaveBeenCalled();
    expect(learning.start).toHaveBeenCalled();
  });

  test('a service built without the generator is legacy', () => {
    expect(new ExamsService({} as any, {} as any, {} as any, {} as any).quizEngine).toBe('legacy');
  });
});

describe('ported from origin/feature/quiz-quality-overhaul', () => {
  const SOURCES = [
    { title: 'Chapter_3', text: 'Transport vs. network layer services and protocols\ntransport layer: communication between processes' },
    { title: 'Chapter_3', text: 'TCP: overview\nreliable, in-order byte stream; TCP uses a three-way handshake' },
    { title: 'Chapter_6', text: 'Link layer: services\nframing, link access: encapsulate datagram into frame' },
    { title: 'Chapter_6', text: 'Chapter 6\n12' },
  ];
  test('keeps past-exam terms the sources contain, most frequent first, and drops the rest', () => {
    const { topics, dropped } = groundTopics(['puan', 'TCP', 'framing', 'Dijkstra'], SOURCES, 2);
    expect(topics.slice(0, 2)).toEqual(['TCP', 'framing']);
    expect(dropped).toEqual(['puan', 'Dijkstra']);
  });
  test('fills up with source headings when the past exam shares no words with the course', () => {
    const { topics } = groundTopics(['kalıtım', 'polimorfizm'], SOURCES, 5);
    expect(topics).toContain('Link layer: services');
    expect(topics).toContain('TCP: overview');
    expect(topics).not.toContain('Chapter 6');
    expect(new Set(topics).size).toBe(topics.length);
  });
  test('takes headings from every material in turn', () => {
    expect(groundTopics([], SOURCES, 2).topics.slice(0, 2)).toEqual(['Transport vs. network layer services and protocols', 'Link layer: services']);
  });
  test('names the reason most attempts failed with', () => {
    expect(commonReason([{ reason: 'a' }, { reason: 'b' }, { reason: 'b' }])).toEqual({ reason: 'b', count: 2 });
    expect(commonReason([])).toBeNull();
  });
  test('reworded copies are caught, different questions are not', () => {
    const q = 'Java’da bir sınıftan oluşturulan örneğe ne ad verilir?';
    expect(isDuplicateStem('Bir sınıftan oluşturulan örneğe Java’da ne ad verilir?', [q])).toBe(true);
    expect(isDuplicateStem('Polimorfizm çalışma zamanında hangi metodu seçer?', [q])).toBe(false);
    expect(isDuplicateStem('x', [])).toBe(false);
  });
});

describe('the generator refuses a repeated question before storing it', () => {
  test('a near copy of an earlier exam question is a DUPLICATE_STEM failure', async () => {
    const TEXT = 'BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır.';
    const q = { slot: 0, kind: 'OPEN', question: 'BFS bekleyen düğümleri hangi yapıda tutar, açıklayınız?', options: [], expected: '',
      quote: TEXT, source_index: 1, quality: { pipeline_version: 'single-call-v1', deterministic_validation: true } };
    const prisma = { learningQuiz: { create: jest.fn() } };
    const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ id: 's', text: TEXT }], video_learning: [] }), source: jest.fn() };
    const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { questions: [q], failures: [] } }) };
    const generator = new QuizGenerator(prisma as any, knowledge as any, ai as any);
    const r = await generator.generate(u, 'c', { topic: 'BFS', items: [{ kind: 'OPEN' }], budgetSeconds: 240,
      avoidStems: ['Bekleyen düğümleri BFS hangi yapıda tutar? Açıklayınız.'] });
    expect(r.failures[0].code).toBe('DUPLICATE_STEM');
    expect(prisma.learningQuiz.create).not.toHaveBeenCalled();
  });
});
