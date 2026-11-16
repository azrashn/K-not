import { examTopics, planExamKinds } from '../../src/learning/exam-plan';
import type { ExamProfile } from '../../src/learning/exam-style';
import { matchAnswer, normalizeAnswer, rubricCoverage, rubricTerms } from '../../src/learning/answer-match';

const profile = (formats: Partial<ExamProfile['formats']>, terms: string[] = []): ExamProfile => {
  const f = { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, OPEN: 0, ...formats };
  return { question_count: Object.values(f).reduce((a, b) => a + b, 0), formats: f, calculation_share: 0, average_stem_chars: 60, sample_stems: [], topic_terms: terms };
};
const count = (kinds: string[]) => kinds.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

describe('exam plan keeps the shape of the saved exam', () => {
  test('mix follows the format shares and always totals the request', () => {
    const kinds = planExamKinds(profile({ MULTIPLE_CHOICE: 6, TRUE_FALSE: 2, OPEN: 2 }), 10);
    expect(kinds).toHaveLength(10);
    expect(count(kinds)).toEqual({ MULTIPLE_CHOICE: 6, TRUE_FALSE: 2, OPEN: 2 });
  });
  test('calculation questions become short answers and remainders go to the largest share', () => {
    const kinds = planExamKinds(profile({ MULTIPLE_CHOICE: 1, CALCULATION: 2 }), 4);
    expect(count(kinds)).toEqual({ MULTIPLE_CHOICE: 1, SHORT_ANSWER: 3 });
  });
  test('kinds are interleaved instead of grouped', () => {
    const kinds = planExamKinds(profile({ MULTIPLE_CHOICE: 5, TRUE_FALSE: 5 }), 10);
    expect(kinds.slice(0, 2)).not.toEqual(['MULTIPLE_CHOICE', 'MULTIPLE_CHOICE']);
  });
  test('the count is clamped to 1..20', () => {
    expect(planExamKinds(profile({ OPEN: 3 }), 0)).toHaveLength(1);
    expect(planExamKinds(profile({ OPEN: 3 }), 99)).toHaveLength(20);
  });
  test('topics: user topics win, duplicates and blanks are dropped', () => {
    expect(examTopics(['BFS', 'bfs', ' ', 'DFS'], profile({}, ['x']))).toEqual(['BFS', 'DFS']);
    expect(examTopics(undefined, profile({}, ['graf', 'kuyruk']))).toEqual(['graf', 'kuyruk']);
    expect(examTopics([], profile({}))).toEqual([]);
  });
});

describe('short answer and cloze matching', () => {
  test('case, Turkish diacritics and punctuation do not matter', () => {
    expect(normalizeAnswer('  İlk-Giren, İlk Çıkar! ')).toBe('ilk giren ilk cikar');
    expect(matchAnswer('Kuyruk', 'kuyruk.')).toBe('EQUIVALENT');
    expect(matchAnswer('Işık enerjisi', 'isik enerjisi')).toBe('EQUIVALENT');
    expect(matchAnswer('Kuyruk', 'Kuyruk')).toBe('EXACT');
  });
  test('the same words in another order are equivalent', () => {
    expect(matchAnswer('ilk giren ilk çıkar', 'çıkar ilk giren ilk')).toBe('EQUIVALENT');
  });
  test('a one letter slip in a long single word is accepted, a different word is not', () => {
    expect(matchAnswer('algoritma', 'algoritna')).toBe('TYPO');
    expect(matchAnswer('yığın', 'kuyruk')).toBeNull();
    expect(matchAnswer('kuyruk', 'kuyruğa')).toBeNull();
    expect(matchAnswer('stack', 'stak')).toBeNull();
  });
  test('answers with digits or operators are compared exactly', () => {
    expect(matchAnswer('x+y', 'x-y')).toBeNull();
    expect(matchAnswer('x + y', 'x+y')).toBe('EXACT');
    expect(matchAnswer('O(n log n)', 'o(n log n)')).toBe('EXACT');
    expect(matchAnswer('12', '21')).toBeNull();
  });
  test('a wrong or empty answer never matches', () => {
    expect(matchAnswer('Kuyruk', '')).toBeNull();
    expect(matchAnswer('Kuyruk', '   ')).toBeNull();
  });
});

describe('rubric key terms are shown, not graded', () => {
  test('terms come from the expected answer without stop words', () => {
    expect(rubricTerms('Kuyruk ilk giren ilk çıkar ilkesiyle çalışır')).toEqual(['kuyruk', 'giren', 'cikar', 'ilkesiyle', 'calisir']);
  });
  test('coverage lists found and missing terms', () => {
    const terms = rubricTerms('kuyruk yapısı FIFO çalışır');
    const c = rubricCoverage(terms, 'Kuyruk FIFO ile çalışır');
    expect(c.found).toEqual(expect.arrayContaining(['kuyruk', 'fifo', 'calisir']));
    expect(c.missing).toEqual(['yapisi']);
  });
});

import { LearningService } from '../../src/learning/learning.service';

describe('answer() uses safe equivalents for typed answers', () => {
  const quiz = (kind: string, expected: string) => ({
    id: 'q', kind, materialId: 'm', segmentId: 's',
    data: { question: 'Q?', options: [], expected, quote: 'q', source: { id: 's' }, quality: { option_audit_version: 2 } },
  });
  const service = (row: any) => {
    const prisma = {
      learningQuiz: { findFirst: jest.fn().mockResolvedValue(row), findUniqueOrThrow: jest.fn().mockResolvedValue(row) },
      learningQuizAttempt: { create: jest.fn(async ({ data }) => ({ id: 'a', ...data })) },
    };
    return { prisma, svc: new LearningService(prisma as any, { requireMember: jest.fn() } as any, { source: jest.fn() } as any, {} as any) };
  };
  const u = { id: 'u', role: 'USER' } as any;

  test('a cloze answer in another case with a diacritic slip is correct', async () => {
    const { svc } = service(quiz('CLOZE', 'Işık enerjisi'));
    const r = await svc.answer(u, 'c', 'q', 'isik ENERJISI');
    expect(r.outcome).toBe('CORRECT');
    expect(r.score).toBe(1);
    expect(r.match_mode).toBe('EQUIVALENT');
  });
  test('a different cloze answer is still wrong', async () => {
    const { svc } = service(quiz('CLOZE', 'Işık enerjisi'));
    const r = await svc.answer(u, 'c', 'q', 'ses enerjisi');
    expect(r.outcome).toBe('REVIEW_SOURCE');
    expect(r.score).toBe(0);
  });
  test('an unmatched short answer is not graded but shows which key terms it has', async () => {
    const { svc } = service(quiz('SHORT_ANSWER', 'kuyruk FIFO ilkesiyle çalışır'));
    const r = await svc.answer(u, 'c', 'q', 'kuyruk yapısı');
    expect(r.outcome).toBe('REVIEW_REQUIRED');
    expect(r.score).toBeNull();
    expect(r.rubric!.found).toEqual(['kuyruk']);
    expect(r.rubric!.missing).toEqual(expect.arrayContaining(['fifo']));
  });
  test('a matching short answer is correct and has no rubric', async () => {
    const { svc } = service(quiz('SHORT_ANSWER', 'FIFO'));
    const r = await svc.answer(u, 'c', 'q', 'fifo');
    expect(r.outcome).toBe('CORRECT');
    expect(r.rubric).toBeNull();
  });
});
