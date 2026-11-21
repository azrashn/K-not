import { LearningService } from '../../../src/learning/learning.service';
import { failure } from '../../../src/learning/quiz-failures';
import { NOT_WATCHED, QuizBuilder, SET_RUNNING } from '../../../src/learning/generation/quiz-builder';
import { NO_DOCUMENT_MESSAGE, TRANSCRIPT_WARNING } from '../../../src/learning/generation/source-pool';
import { TOPIC_NOT_IN_DOCUMENTS } from '../../../src/learning/generation/topic-planner';
import { knowledge as course, NOTES, VIDEO } from './java-course';

const u = { id: 'u', role: 'USER' } as any;

/** Stores what the generator "writes"; `fail(request, call)` returns a failure code or nothing. */
function world(materials = [NOTES, VIDEO], fail: (r: any, call: number) => string | void = () => undefined, search: any[] = []) {
  const k = Object.assign(course(materials), {
    ask: jest.fn().mockResolvedValue({ evidence: search, video_learning: search.map((e) => ({ source_id: e.id, state: e.state ?? 'WATCHED' })) }),
  });
  const rows: any[] = [];
  const prisma = {
    learningQuiz: { findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null) },
    learningQuizAttempt: { findMany: jest.fn().mockResolvedValue([]) },
    generatedExam: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }: any) => ({ ...data, createdAt: new Date(), finishedAt: null })),
      update: jest.fn(async ({ data }: any) => data),
      findFirst: jest.fn(),
    },
  };
  let calls = 0;
  const generator = {
    generate: jest.fn(async (_u: any, _c: any, req: any) => {
      const code = fail(req, calls++);
      if (code) return { quizzes: [], stems: [], failures: req.items.map((it: any, slot: number) => failure(slot, it.kind, code, 2, it.variant)) };
      const quizzes = req.items.map((it: any, slot: number) => {
        const row = { id: `q${rows.length + 1}`, kind: it.kind, topic: req.topic, purpose: req.purpose, materialId: req.sources[0].material_id,
          segmentId: req.sources[0].id, version: 'v1', data: { question: `${req.topic}?`, options: [], source: req.sources[0], quality: {} }, createdAt: new Date() };
        rows.push(row);
        return { id: row.id, slot };
      });
      return { quizzes, stems: [], failures: [] };
    }),
  };
  const policy = (p: any) => new QuizBuilder(prisma as any, k as any, generator as any, p);
  return { k, prisma, generator, rows, builder: policy('documents_first'), policy };
}
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

describe('one question, returned at once', () => {
  test('from the notes, never the transcript, as the public quiz', async () => {
    const { builder, generator } = world();
    const quiz = await builder.single(u, 'c', { topic: 'final anahtar sözcüğü', kind: 'TRUE_FALSE' }, 130);
    expect(quiz).toMatchObject({ id: 'q1', kind: 'TRUE_FALSE', topic: 'final anahtar sözcüğü' });
    expect(quiz).not.toHaveProperty('source_warning');
    const req = generator.generate.mock.calls[0][2];
    expect(req).toMatchObject({ budgetSeconds: 130, purpose: 'PRACTICE', sources: [expect.objectContaining({ id: 'n3', material_id: NOTES.id })] });
  });

  test('a failure is the known public error with its reason, without a second try', async () => {
    const { builder, generator } = world([NOTES], () => 'QUOTE_NOT_FOUND');
    const error = await builder.single(u, 'c', { topic: 'kalıtım', kind: 'MULTIPLE_CHOICE' }, 130).catch((e) => e);
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(error.code).toBe('GENERATION_FAILED');
    expect(error.message).toContain('alıntı kaynakta birebir bulunamadı (2 deneme)');
  });

  test('a course with only the video: the transcript, with the warning on the question', async () => {
    const { builder } = world([VIDEO]);
    const quiz = await builder.single(u, 'c', { topic: 'object', kind: 'OPEN' }, 130);
    expect(quiz.source_warning).toBe(TRANSCRIPT_WARNING);
  });

  test('QUIZ_TRANSCRIPT_POLICY=never without a document asks for one', async () => {
    const { policy, generator } = world([VIDEO]);
    await expect(policy('never').single(u, 'c', { topic: 'object', kind: 'OPEN' }, 130)).rejects.toThrow(NO_DOCUMENT_MESSAGE);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  test('a topic only the transcript mentions: the hint to choose the video, no model call', async () => {
    const { builder, generator } = world();
    await expect(builder.single(u, 'c', { topic: 'Intelijayda derleicisi', kind: 'OPEN' }, 130)).rejects.toThrow(TOPIC_NOT_IN_DOCUMENTS);
    expect(generator.generate).not.toHaveBeenCalled();
  });

  test('a part the search found counts even without a shared word', async () => {
    const { builder, generator } = world([NOTES], undefined, [{ id: 'n4' }]);
    await builder.single(u, 'c', { topic: 'garbage collection', kind: 'OPEN' }, 130);
    expect(generator.generate.mock.calls[0][2].sources[0].id).toBe('n4');
  });

  test('watched-only: only watched video parts; nothing watched is refused', async () => {
    const watched = world([NOTES, VIDEO], undefined, [{ id: 'v2' }]);
    await watched.builder.single(u, 'c', { topic: 'final', kind: 'OPEN', watched_only: true }, 130);
    expect(watched.generator.generate.mock.calls[0][2].sources[0].id).toBe('v2');
    const none = world([NOTES, VIDEO], undefined, [{ id: 'v2', state: 'PARTIAL' }]);
    await expect(none.builder.single(u, 'c', { topic: 'final', kind: 'OPEN', watched_only: true }, 130)).rejects.toThrow(NOT_WATCHED);
  });

  test.each([0, 11])('count %i is refused before any search', async (count) => {
    const { builder, k } = world();
    await expect(builder.startSet(u, 'c', { topic: 'nesne', kind: 'OPEN', count }, 240)).rejects.toThrow('1 ile 10');
    expect(k.ask).not.toHaveBeenCalled();
  });
});

describe('a quiz set of 2-10 questions', () => {
  test('saved at once as a PRACTICE set, written in the background from distinct parts, "Karışık" kinds', async () => {
    const { builder, prisma, generator } = world();
    const row = await builder.startSet(u, 'c', { topic: 'nesne', kind: 'MIXED', count: 4 }, 240);
    expect(row).toMatchObject({ purpose: 'PRACTICE', status: 'GENERATING', requested: 4, title: 'nesne', topics: ['nesne'], note: null });
    await settle();
    const requests = generator.generate.mock.calls.map((c: any[]) => c[2]);
    expect(requests.every((r: any) => r.purpose === 'PRACTICE' && r.budgetSeconds === 240 && r.sources.length === 1)).toBe(true);
    expect(requests.flatMap((r: any) => r.items.map((i: any) => i.kind)).sort())
      .toEqual(['MULTIPLE_CHOICE', 'OPEN', 'SHORT_ANSWER', 'TRUE_FALSE']);
    const done = prisma.generatedExam.update.mock.calls.at(-1)![0].data;
    expect(done).toMatchObject({ status: 'READY', note: null });
    expect(done.items).toHaveLength(4);
  });

  test('more questions than the topic\'s sources carry: the rest come from the other parts of the course, and it says so', async () => {
    const { builder } = world();
    const row = await builder.startSet(u, 'c', { topic: 'final', kind: 'OPEN', count: 5 }, 240);
    expect(row.requested).toBe(5); // the student asked for 5 and gets 5
    expect(row.note).toMatch(/^Bu konu için kaynaklar yaklaşık \d+ soruya yetiyor; kalan \d+ soru dersin diğer bölümlerinden tamamlandı\.$/);
  });

  test('when even the whole course cannot carry the request, the note says how many are still missing', async () => {
    const { builder } = world();
    const row = await builder.startSet(u, 'c', { topic: 'final', kind: 'OPEN', count: 10 }, 240);
    expect(row.requested).toBeLessThan(10);
    expect(row.note).toMatch(/dersin diğer bölümlerinden tamamlandı\. Yine de \d+ soru için yeterli kaynak yok\.$/);
  });

  test('one set per course at a time', async () => {
    const { builder, prisma } = world();
    prisma.generatedExam.count.mockResolvedValue(1);
    await expect(builder.startSet(u, 'c', { topic: 'nesne', kind: 'OPEN', count: 3 }, 240)).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING', message: SET_RUNNING });
    expect(prisma.generatedExam.count.mock.calls[0][0].where).toMatchObject({ purpose: 'PRACTICE' });
  });
});

describe('POST /quizzes and GET /quiz-sets/:id through LearningService', () => {
  const service = (w: ReturnType<typeof world>, quizEngine: 'v2' | 'legacy' = 'v2') =>
    new LearningService(w.prisma as any, { requireMember: jest.fn() } as any, w.k as any, {} as any, w.generator as any, { quizEngine } as any);

  test('count 2-10 answers with the set; count 1 with the question', async () => {
    const w = world();
    const learning = service(w);
    const set = await learning.start(u, 'c', { topic: 'nesne', kind: 'OPEN', count: 3 });
    expect(set.set).toMatchObject({ type: 'quiz_set', topic: 'nesne', status: 'GENERATING', requested: 3, produced: 0 });
    const one = await learning.start(u, 'c', { topic: 'kalıtım', kind: 'OPEN' });
    expect(one).toMatchObject({ kind: 'OPEN', topic: 'kalıtım' });
  });

  test('a set is read with its questions; an exam is not a quiz set', async () => {
    const w = world();
    const learning = service(w);
    (learning as any).quiz = jest.fn(async (_u: any, _c: any, id: string) => ({ id, kind: 'OPEN' }));
    w.prisma.generatedExam.findFirst.mockResolvedValueOnce({ id: 's', title: 'nesne', status: 'READY', requested: 2, note: null, failures: [],
      items: [{ quiz_id: 'q1', kind: 'OPEN', topic: 'nesne' }, { quiz_id: 'q2', kind: 'OPEN', topic: 'nesne' }] });
    const set = await learning.quizSet(u, 'c', 's');
    expect(set).toMatchObject({ type: 'quiz_set', produced: 2, questions: [{ id: 'q1', available: true }, { id: 'q2', available: true }] });
    expect(w.prisma.generatedExam.findFirst.mock.calls[0][0].where).toEqual({ id: 's', courseId: 'c', userId: 'u', purpose: 'PRACTICE' });
    w.prisma.generatedExam.findFirst.mockResolvedValueOnce(null);
    await expect(learning.quizSet(u, 'c', 'exam1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('a set comes with the student\'s latest answer to each question, as it was graded', async () => {
    const w = world();
    const learning = service(w);
    (learning as any).quiz = jest.fn(async (_u: any, _c: any, id: string) => ({ id, kind: 'MULTIPLE_CHOICE' }));
    w.prisma.generatedExam.findFirst.mockResolvedValueOnce({ id: 's', title: 'nesne', status: 'READY', requested: 2, note: null, failures: [],
      items: [{ quiz_id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'nesne' }, { quiz_id: 'q2', kind: 'MULTIPLE_CHOICE', topic: 'nesne' }] });
    const at = new Date('2026-11-21T10:00:00Z');
    w.prisma.learningQuizAttempt.findMany.mockResolvedValueOnce([
      { id: 'a1', quizId: 'q1', response: '2', outcome: 'REVIEW_SOURCE', score: 0, createdAt: at,
        feedback: { message: 'İncele.', expected: 'Kuyruk', quote: 'BFS kuyruk kullanır.', explanation: 'FIFO.', source: { id: 's1' } } },
    ]);
    const set = await learning.quizSet(u, 'c', 's');
    expect(set.questions[0].last_answer).toEqual({ id: 'a1', response: '2', outcome: 'REVIEW_SOURCE', score: 0, answered_at: at,
      message: 'İncele.', expected: 'Kuyruk', quote: 'BFS kuyruk kullanır.', explanation: 'FIFO.', source: { id: 's1' } });
    expect(set.questions[1].last_answer).toBeNull();
    // Only this student's answers, the newest per question.
    expect(w.prisma.learningQuizAttempt.findMany).toHaveBeenCalledWith({
      where: { userId: 'u', quizId: { in: ['q1', 'q2'] } }, orderBy: { createdAt: 'desc' }, distinct: ['quizId'] });
  });

  test('the legacy engine keeps one question of one kind', async () => {
    const learning = service(world(), 'legacy');
    for (const body of [{ topic: 'x', kind: 'OPEN', count: 2 }, { topic: 'x', kind: 'MIXED' }])
      await expect(learning.start(u, 'c', body)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('yalnız yeni soru motoruyla') });
  });
});
