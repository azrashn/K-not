import { questionPreview, QUESTION_PREVIEW_MAX, quizHistoryItem, setsByQuiz, summarizeQuizHistory } from '../../src/learning/quiz-history';
import { LearningService } from '../../src/learning/learning.service';

const day = (n: number) => new Date(Date.UTC(2026, 10, n));

test('a quiz without attempts is unanswered and has no outcome', () => {
  expect(quizHistoryItem({ id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'BFS', createdAt: day(1), attempts: [], _count: { attempts: 0 } }))
    .toMatchObject({ status: 'UNANSWERED', attempt_count: 0, latest_outcome: null, latest_score: null, latest_answered_at: null });
});

test('the newest attempt decides the outcome even when the list order is not newest-first', () => {
  const item = quizHistoryItem({
    id: 'q2', kind: 'TRUE_FALSE', topic: 'DFS', createdAt: day(1),
    attempts: [
      { outcome: 'CORRECT', score: 1, createdAt: day(2) },
      { outcome: 'REVIEW_SOURCE', score: 0, createdAt: day(5) },
    ],
    _count: { attempts: 2 },
  });
  expect(item).toMatchObject({ status: 'ANSWERED', attempt_count: 2, latest_outcome: 'REVIEW_SOURCE', latest_score: 0 });
  expect(item.latest_answered_at).toEqual(day(5));
});

test('summary counts answered and unanswered quizzes and only the latest correct answer', () => {
  const items = [
    quizHistoryItem({ id: 'a', kind: 'MULTIPLE_CHOICE', topic: 't', createdAt: day(1), attempts: [{ outcome: 'CORRECT', score: 1, createdAt: day(2) }], _count: { attempts: 3 } }),
    quizHistoryItem({ id: 'b', kind: 'OPEN', topic: 't', createdAt: day(1), attempts: [{ outcome: 'REFLECTION_SAVED', score: null, createdAt: day(2) }], _count: { attempts: 1 } }),
    quizHistoryItem({ id: 'c', kind: 'CLOZE', topic: 't', createdAt: day(1), attempts: [], _count: { attempts: 0 } }),
  ];
  expect(summarizeQuizHistory(items)).toEqual({ total: 3, answered: 2, unanswered: 1, correct: 1 });
});

test('quizzes() returns one history row per quiz with attempt counts, not one row per attempt', async () => {
  const prisma = {
    learningQuiz: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'BFS', createdAt: day(1), attempts: [{ outcome: 'CORRECT', score: 1, createdAt: day(3) }], _count: { attempts: 2 } },
        { id: 'q2', kind: 'SHORT_ANSWER', topic: 'DFS', createdAt: day(2), attempts: [], _count: { attempts: 0 } },
      ]),
    },
    generatedExam: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
  const rows = await service.quizzes({ id: 'u', role: 'USER' } as any, 'c');
  expect(rows.map((r: any) => [r.id, r.status, r.attempt_count])).toEqual([['q1', 'ANSWERED', 2], ['q2', 'UNANSWERED', 0]]);
  const args = prisma.learningQuiz.findMany.mock.calls[0][0];
  expect(args.where).toMatchObject({ userId: 'u', courseId: 'c', redacted: false });
  expect(args.select.attempts.take).toBe(1);
});

describe('history rows carry what a card needs: set, question text, section', () => {
  const longStem = 'Java programlama dilinde ' + 'çok uzun bir soru metni '.repeat(12) + 'nedir?';

  test('quizzes() ties each question to its quiz set; a single question has no set', async () => {
    const prisma = {
      learningQuiz: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'Veri tipleri', createdAt: day(2), attempts: [], _count: { attempts: 0 },
            data: { question: 'Java\nderleyicisinin  adı nedir?', expected: '0', source: { title: 'Notlar', text: '4. Veri Tipleri\nint 32 bittir. long 64 bittir.' } } },
          { id: 'q2', kind: 'OPEN', topic: 'Veri tipleri', createdAt: day(2), attempts: [], _count: { attempts: 0 }, data: { question: 'İlkel tipleri açıkla.' } },
          { id: 'q3', kind: 'CLOZE', topic: '', createdAt: day(1), attempts: [], _count: { attempts: 0 }, data: { question: longStem } },
        ]),
      },
      generatedExam: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'set1', title: 'Veri tipleri', items: [{ quiz_id: 'q1' }, { quiz_id: 'q2' }, { quiz_id: 'gone' }] },
          { id: 'set0', title: 'Eski', items: null },
        ]),
      },
    };
    const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
    const rows: any[] = await service.quizzes({ id: 'u', role: 'USER' } as any, 'c');
    expect(rows.map((r) => [r.id, r.set_id, r.set_title])).toEqual([['q1', 'set1', 'Veri tipleri'], ['q2', 'set1', 'Veri tipleri'], ['q3', null, null]]);
    expect(rows[0].question).toBe('Java derleyicisinin adı nedir?');
    expect(rows[0].section).toBe('Veri tipleri');
    expect(rows[1].section).toBeNull();
    expect(rows[2].question.length).toBeLessThanOrEqual(QUESTION_PREVIEW_MAX);
    expect(rows[2].question.endsWith('…')).toBe(true);
    // Never the answer key or the source text.
    expect(JSON.stringify(rows)).not.toMatch(/expected|int 32 bittir/);
    expect(prisma.generatedExam.findMany.mock.calls[0][0].where).toEqual({ userId: 'u', courseId: 'c', purpose: 'PRACTICE' });
  });

  test('a question listed by two sets belongs to the first (newest) one', () => {
    const sets = setsByQuiz([{ id: 'new', title: 'A', items: [{ quiz_id: 'q' }] }, { id: 'old', title: 'B', items: [{ quiz_id: 'q' }] }]);
    expect(sets.get('q')).toEqual({ id: 'new', title: 'A' });
    expect(questionPreview('  ')).toBeNull();
  });
});
