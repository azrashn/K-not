import {
  PRACTICE_DEFAULT, PRACTICE_MAX, PRACTICE_MIN, clampCount, hasCodeMarkers, isDuplicateStem, planPractice, summarizePractice,
} from '../../src/learning/practice-plan';

describe('question count', () => {
  test('bounds and default', () => {
    expect([PRACTICE_MIN, PRACTICE_MAX, PRACTICE_DEFAULT]).toEqual([5, 25, 10]);
    expect(clampCount(1)).toBe(5);
    expect(clampCount(99)).toBe(25);
    expect(clampCount(12.9)).toBe(12);
    expect(clampCount(NaN)).toBe(10);
  });
  test.each([5, 10, 17, 25])('%i questions are planned exactly', (n) => {
    expect(planPractice(n, ['A', 'B'], false)).toHaveLength(n);
  });
});

describe('balance', () => {
  const topics = ['Sınıflar', 'Kalıtım', 'Polimorfizm', 'Encapsulation', 'Interface'];
  test('every topic is asked, none dominates', () => {
    const slots = planPractice(10, topics, false);
    const per = topics.map((t) => slots.filter((s) => s.topic === t).length);
    expect(per.every((n) => n === 2)).toBe(true);
  });
  test('difficulty is mixed: not all easy, all three levels present', () => {
    const levels = new Set(planPractice(10, topics, false).map((s) => s.difficulty));
    expect(levels).toEqual(new Set(['easy', 'medium', 'hard']));
    const easy = planPractice(10, topics, false).filter((s) => s.difficulty === 'easy').length;
    expect(easy).toBeLessThanOrEqual(4);
  });
  test('a single topic is measured from several angles', () => {
    const slots = planPractice(10, ['Kalıtım'], false);
    expect(new Set(slots.map((s) => s.focus)).size).toBeGreaterThanOrEqual(4);
  });
  test('code questions are offered only when the sources have code', () => {
    expect(planPractice(25, ['X'], false).some((s) => s.focus === 'code_output')).toBe(false);
    expect(planPractice(25, ['X'], true).some((s) => s.focus === 'code_output')).toBe(true);
  });
  test('true/false only for easy definitions; the rest are multiple choice', () => {
    for (const s of planPractice(25, ['X', 'Y'], true))
      if (s.kind === 'TRUE_FALSE') expect([s.difficulty, s.focus]).toEqual(['easy', 'definition']);
  });
  test('needs a topic', () => expect(() => planPractice(10, [], false)).toThrow());
});

describe('duplicates', () => {
  const q = 'Java’da bir sınıftan oluşturulan örneğe ne ad verilir?';
  test('reworded copies are caught, different questions are not', () => {
    expect(isDuplicateStem('Bir sınıftan oluşturulan örneğe Java’da ne ad verilir?', [q])).toBe(true);
    expect(isDuplicateStem('Polimorfizm çalışma zamanında hangi metodu seçer?', [q])).toBe(false);
    expect(isDuplicateStem('x', [])).toBe(false);
  });
});

describe('grading summary', () => {
  const items = [
    { topic: 'Kalıtım', difficulty: 'easy', focus: 'definition', answered: true, correct: true },
    { topic: 'Kalıtım', difficulty: 'hard', focus: 'application', answered: true, correct: true },
    { topic: 'Polimorfizm', difficulty: 'medium', focus: 'relation', answered: true, correct: false },
    { topic: 'Polimorfizm', difficulty: 'hard', focus: 'scenario', answered: false, correct: false },
  ];
  const s = summarizePractice(items);
  test('totals count blanks separately and in the percentage', () => {
    expect([s.total, s.correct, s.wrong, s.blank, s.answered, s.percent]).toEqual([4, 2, 1, 1, 3, 50]);
  });
  test('per topic and difficulty', () => {
    expect(s.by_topic).toEqual([
      { key: 'Kalıtım', total: 2, correct: 2, wrong: 0, blank: 0, percent: 100 },
      { key: 'Polimorfizm', total: 2, correct: 0, wrong: 1, blank: 1, percent: 0 },
    ]);
    expect(s.by_difficulty.find((d) => d.key === 'hard')).toMatchObject({ total: 2, correct: 1, blank: 1 });
  });
  test('empty set', () => expect(summarizePractice([]).percent).toBe(0));
});

test('code detection needs several markers', () => {
  expect(hasCodeMarkers('class A {\n  void f() { return; }\n}')).toBe(true);
  expect(hasCodeMarkers('Kuyruk ilk giren ilk çıkar.')).toBe(false);
});
