import { quizHistoryItem, summarizeQuizHistory } from '../../src/learning/quiz-history';
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
  };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
  const rows = await service.quizzes({ id: 'u', role: 'USER' } as any, 'c');
  expect(rows.map((r: any) => [r.id, r.status, r.attempt_count])).toEqual([['q1', 'ANSWERED', 2], ['q2', 'UNANSWERED', 0]]);
  const args = prisma.learningQuiz.findMany.mock.calls[0][0];
  expect(args.where).toMatchObject({ userId: 'u', courseId: 'c', redacted: false });
  expect(args.select.attempts.take).toBe(1);
});
