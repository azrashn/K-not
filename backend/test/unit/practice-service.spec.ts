import { PracticeService } from '../../src/learning/practice.service';

const u = { id: 'u', role: 'USER' } as any;
const flush = () => new Promise((r) => setTimeout(r, 20));
const sources = [{ id: 'm1', title: 'Java', status: 'READY' }];

function make(startImpl: (b: any) => any, over: any = {}) {
  const rows = new Map<string, any>();
  const quizRows = new Map<string, any>();
  const prisma: any = {
    examStyle: { findFirst: jest.fn() },
    generatedExam: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => { const r = { ...data, createdAt: new Date(), finishedAt: null, submittedAt: null, result: null }; rows.set(r.id, r); return r; }),
      update: jest.fn(async ({ where, data }) => Object.assign(rows.get(where.id), data)),
      updateMany: jest.fn(async ({ where, data }) => {
        const r = rows.get(where.id);
        if (!r || ('submittedAt' in where && r.submittedAt !== where.submittedAt)) return { count: 0 };
        Object.assign(r, data); return { count: 1 };
      }),
      findFirst: jest.fn(async ({ where }) => rows.get(where.id) ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    learningQuiz: {
      deleteMany: jest.fn(),
      findUnique: jest.fn(async ({ where }) => quizRows.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }) => where.id.in.map((id: string) => ({ id, data: quizRows.get(id)?.data }))),
    },
  };
  const learning: any = {
    start: jest.fn(async (_u, _c, b) => {
      const q = startImpl(b);
      quizRows.set(q.id, { data: { focus_text: q.fact, question: q.question, options: ['a', 'b', 'c', 'd'], expected: '1', explanation: 'Açıklama metni burada.', option_feedback: ['w', 'r', 'w', 'w'], quote: 'alıntı', source: { id: 's', material_id: 'm1', title: 'Java', kind: 'TXT', location: {} } } });
      return q;
    }),
    quiz: jest.fn(async (_u, _c, id) => ({ id, question: 'q', options: [] })),
    answer: jest.fn(async (_u, _c, _id, response) => ({ score: response === '1' ? 1 : 0, outcome: response === '1' ? 'CORRECT' : 'REVIEW_SOURCE' })),
    ...over.learning,
  };
  const knowledge: any = {
    materials: jest.fn().mockResolvedValue(sources),
    preview: jest.fn().mockResolvedValue({ segments: [{ text: 'Sınıflar\nNesne bir sınıfın örneğidir.' }] }),
  };
  const svc = new PracticeService(prisma, { requireMember: jest.fn() } as any, learning, knowledge);
  return { svc, prisma, learning, rows };
}
let n = 0;
// Questions share no content words, as genuinely different questions would not.
const distinct = (_b: any) => { n++; return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, question: `alfa${n}x beta${n}y gama${n}z delta${n}w nedir?`, fact: `kaynak${n}p cümle${n}q içerik${n}r` }; };

test('count outside 5-25 is refused before anything is generated', async () => {
  const { svc, learning } = make(distinct);
  for (const count of [4, 26, 7.5]) await expect(svc.create(u, 'c', { count, topics: ['A'] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(learning.start).not.toHaveBeenCalled();
});

test('exactly the requested number is produced, with difficulty/focus and earlier questions passed on', async () => {
  const { svc, learning, rows } = make(distinct);
  const s = await svc.create(u, 'c', { count: 10, topics: ['Kalıtım', 'Interface'] });
  expect(s.status).toBe('GENERATING');
  await flush();
  const row = [...rows.values()][0];
  expect(row.status).toBe('READY');
  expect(row.items).toHaveLength(10);
  expect(learning.start).toHaveBeenCalledTimes(10);
  const last = learning.start.mock.calls[9][2];
  expect(last.avoid_questions).toHaveLength(9);
  expect(last.avoid_focus_texts).toHaveLength(9);
  expect(new Set(row.items.map((i: any) => i.difficulty))).toEqual(new Set(['easy', 'medium', 'hard']));
  expect(new Set(row.items.map((i: any) => i.topic))).toEqual(new Set(['Kalıtım', 'Interface']));
});

test('a repeated question is discarded and replaced, never kept', async () => {
  let calls = 0;
  let first = '';
  const { svc, prisma, rows } = make((b) => {
    calls++;
    const q = distinct(b);
    if (calls === 1) first = q.question;
    return calls === 2 ? { ...q, question: first } : q;
  });
  await svc.create(u, 'c', { count: 5, topics: ['A'] });
  await flush();
  const row = [...rows.values()][0];
  expect(row.status).toBe('READY');
  expect(row.items).toHaveLength(5);
  expect(prisma.learningQuiz.deleteMany).toHaveBeenCalledTimes(1);
});

test('an incomplete set is FAILED with the reason, not published short', async () => {
  const { svc, rows } = make(() => { throw Object.assign(new Error('Seçili kaynaklarda bu konuyu açıklayan bir bölüm bulunamadı.'), { code: 'VALIDATION_ERROR' }); });
  await svc.create(u, 'c', { count: 5, topics: ['A'] });
  await flush();
  const row = [...rows.values()][0];
  expect(row.status).toBe('FAILED');
  expect(row.items).toHaveLength(0);
  expect(row.note).toContain('eksik set başlatılmaz');
});

test('model outage stops the run with a clear note', async () => {
  const { svc, rows } = make(() => { throw Object.assign(new Error('x'), { code: 'AI_SERVICE_UNAVAILABLE' }); });
  await svc.create(u, 'c', { count: 5, topics: ['A'] });
  await flush();
  expect([...rows.values()][0]).toMatchObject({ status: 'FAILED', note: expect.stringContaining('yanıt vermediği') });
});

test('submit grades answers, reports blanks, and refuses a second submission', async () => {
  const { svc, rows, learning } = make(distinct);
  await svc.create(u, 'c', { count: 5, topics: ['A', 'B'] });
  await flush();
  const id = [...rows.keys()][0];
  const ids = rows.get(id).items.map((i: any) => i.quiz_id);
  const result = await svc.submit(u, 'c', id, [
    { quiz_id: ids[0], response: '1' }, // correct
    { quiz_id: ids[1], response: '0' }, // wrong
    { quiz_id: ids[2], response: '  ' }, // blank
  ]);
  expect(result.summary).toMatchObject({ total: 5, correct: 1, wrong: 1, blank: 3, answered: 2, percent: 20 });
  expect(learning.answer).toHaveBeenCalledTimes(2); // blanks never create attempts
  const wrong = result.items[1];
  expect(wrong).toMatchObject({ correct: false, expected: 'b', explanation: expect.any(String) });
  expect(wrong.options.map((o: any) => o.correct)).toEqual([false, true, false, false]);
  expect(wrong.options[0].chosen).toBe(true);
  await expect(svc.submit(u, 'c', id, [])).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
});

test('a set that is not READY cannot be submitted', async () => {
  const { svc, rows } = make(distinct);
  await svc.create(u, 'c', { count: 5, topics: ['A'] });
  const id = [...rows.keys()][0];
  rows.get(id).status = 'GENERATING';
  await expect(svc.submit(u, 'c', id, [])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
});
