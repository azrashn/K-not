/** Mac trial of a 6-question quiz set: the 2nd and 3rd question were the same ("Java programlama dilinin
 *  derleyicisinin adı nedir?", same source sentence), and multiple-choice options kept the model's letter
 *  labels ("a) javac, c) jvm, d) jar, b) java" after the shuffle). */
import { QuizGenerator, stripOptionLabels } from '../../../src/learning/quiz-generator';
import { RepeatGuard } from '../../../src/learning/generation/repeat-guard';
import { runAndRecord, storedItems } from '../../../src/learning/generation/set-runner';
import type { Produced } from '../../../src/learning/generation/generation-run';
import { planQuestions, quizItems } from '../../../src/learning/generation/question-plan';
import { buildPool } from '../../../src/learning/generation/source-pool';
import { examTopics } from '../../../src/learning/generation/topic-planner';
import { failure } from '../../../src/learning/quiz-failures';
import { NOTES, SEGMENTS } from './java-course';

const TEXT = 'Java kaynak kodu javac derleyicisi tarafından bytecode a çevrilir. JVM bytecode u çalıştırır.';
const QUOTE = 'Java kaynak kodu javac derleyicisi tarafından bytecode a çevrilir.';
const SOURCE = { id: 's1', text: TEXT, material_id: 'm1', version: 'v1', title: 'Java', kind: 'TXT' };
const QUALITY = { pipeline_version: 'single-call-v1', deterministic_validation: true, structural_validation: true, attempts: 1 };
const STEM = 'Java programlama dilinin derleyicisinin adı nedir?';
const mcq = (slot: number, over: any = {}) => ({
  slot, kind: 'MULTIPLE_CHOICE', question: STEM, options: ['javac', 'java', 'jvm', 'jar'], expected: '0',
  quote: QUOTE, source_index: 1, explanation: 'Kaynak javac der.', quality: QUALITY, ...over,
});

function setup(questions: any[]) {
  const created: any[] = [];
  const prisma = { learningQuiz: { create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) } };
  const knowledge = { source: jest.fn().mockResolvedValue({}) };
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { engine: 'v2', questions, failures: [] } }) };
  return { generator: new QuizGenerator(prisma as any, knowledge as any, ai as any), created };
}
const request = (n: number, extra: any = {}) =>
  ({ topic: 'Java', items: Array(n).fill({ kind: 'MULTIPLE_CHOICE' }), budgetSeconds: 60, sources: [SOURCE], ...extra });
const u = { id: 'u', role: 'USER' } as any;

describe('a set never accepts the same stem or the same source sentence twice', () => {
  test('two identical questions in one answer: the second is refused (with the set guard)', async () => {
    const { generator, created } = setup([mcq(0), mcq(1)]);
    const r = await generator.generate(u, 'c', request(2, { guard: new RepeatGuard() }));
    expect(r.quizzes.map((q) => q.slot)).toEqual([0]);
    expect(r.failures.map((f) => [f.slot, f.code])).toEqual([[1, 'DUPLICATE_STEM']]);
    expect(created).toHaveLength(1);
  });

  test('without a set guard the request still refuses a repeated stem and a reused sentence', async () => {
    const other = mcq(1, { question: 'JVM neyi çalıştırır?', options: ['bytecode', 'kaynak', 'derleyici', 'ikili'] });
    const { generator } = setup([mcq(0), other]);
    const r = await generator.generate(u, 'c', request(2));
    expect(r.failures.map((f) => [f.slot, f.code])).toEqual([[1, 'DUPLICATE_QUOTE']]);
    const again = setup([mcq(0)]);
    const r2 = await again.generator.generate(u, 'c', request(1, { avoidStems: ['  JAVA programlama  dilinin derleyicisinin ADI nedir'] }));
    expect(r2.failures.map((f) => f.code)).toEqual(['DUPLICATE_STEM']);
  });

  test('the guard holds a question before it is stored, so a check running meanwhile already sees it', async () => {
    const guard = new RepeatGuard();
    let release!: () => void;
    let reached!: () => void;
    const atSource = new Promise<void>((r) => (reached = r));
    const knowledge = { source: jest.fn(() => { reached(); return new Promise<void>((r) => (release = r)); }) };
    const prisma = { learningQuiz: { create: jest.fn(async ({ data }: any) => data) } };
    const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { engine: 'v2', questions: [mcq(0)], failures: [] } }) };
    const first = new QuizGenerator(prisma as any, knowledge as any, ai as any).generate(u, 'c', request(1, { guard }));
    await atSource; // storing has started and waits
    expect(guard.isRepeat(STEM)).toBe(true);
    expect(guard.isUsedQuote(QUOTE)).toBe(true);
    release();
    await first;
  });

  test('the stored order of a practice set never changes while it is written (the real Mac bug)', async () => {
    // Slot 1 failed first and was finished by the retry: it is made last. Sorting by slot at the end moved
    // the question the student had seen as the 2nd to the 3rd place, so it came again.
    const saved: Produced[] = [];
    const p = (slot: number, id: string): Produced => ({ slot, quiz_id: id, kind: 'MULTIPLE_CHOICE', topic: 'Java' });
    const during = storedItems(saved, [p(0, 'a'), p(2, 'b'), p(3, 'c')], 'PRACTICE').map((i) => i.quiz_id);
    const done = storedItems(saved, [p(0, 'a'), p(1, 'z'), p(2, 'b'), p(3, 'c')], 'PRACTICE').map((i) => i.quiz_id);
    expect(during).toEqual(['a', 'b', 'c']);
    expect(done).toEqual(['a', 'b', 'c', 'z']);
    expect(storedItems([], [p(1, 'z'), p(0, 'a'), p(0, 'a')], 'EXAM').map((i) => i.quiz_id)).toEqual(['a', 'z']);
  });

  test('runAndRecord: every saved list starts with the previous one, and no question id twice', async () => {
    const pool = buildPool([NOTES], SEGMENTS);
    const plan = planQuestions(quizItems('MULTIPLE_CHOICE', 4), examTopics([], pool));
    let calls = 0;
    let next = 0;
    const generator = {
      generate: jest.fn(async (_u: any, _c: any, req: any) => {
        const call = calls++;
        const quizzes: any[] = [];
        const failures: any[] = [];
        req.items.forEach((item: any, slot: number) => {
          // The first request fails, so its slot is produced only by the retry, after the others.
          if (call === 0) failures.push(failure(slot, item.kind, 'BAD_FORMAT', 2));
          else quizzes.push({ id: `q${next++}`, slot });
        });
        return { quizzes, failures, stems: [] };
      }),
    };
    const lists: string[][] = [];
    const prisma = { generatedExam: { update: jest.fn(async ({ data }: any) => { lists.push(data.items.map((i: any) => i.quiz_id)); }) } };
    await runAndRecord({ prisma: prisma as any, id: 'x', plan, pool, run: { generator, user: u, course: 'c', purpose: 'PRACTICE' } });
    for (let i = 1; i < lists.length; i++) expect(lists[i].slice(0, lists[i - 1].length)).toEqual(lists[i - 1]);
    const last = lists.at(-1)!;
    expect(last).toHaveLength(4);
    expect(new Set(last).size).toBe(4);
  });
});

describe('letter labels are removed from options before they are checked and stored', () => {
  test.each([
    [['a) javac', 'b) java', 'c) jvm', 'd) jar']],
    [['A) javac', 'B) java', 'C) jvm', 'D) jar']],
    [['a. javac', 'b. java', 'c. jvm', 'd. jar']],
    [['A - javac', 'B - java', 'C - jvm', 'D - jar']],
    [['(a) javac', '(b) java', '(c) jvm', '(d) jar']],
  ])('%j', (options) => expect(stripOptionLabels(options)).toEqual(['javac', 'java', 'jvm', 'jar']));

  test('kept when not every option has a label ("C-dili" is an answer)', () => {
    expect(stripOptionLabels(['C-dili', 'a) java', 'b) jvm', 'c) jar'])).toEqual(['C-dili', 'a) java', 'b) jvm', 'c) jar']);
  });

  test('a stored question has clean options and its key still points at the correct one', async () => {
    const { generator, created } = setup([mcq(0, { options: ['b) java', 'a) javac', 'd) jar', 'c) jvm'], expected: '1' })]);
    const r = await generator.generate(u, 'c', request(1));
    expect(r.quizzes).toHaveLength(1);
    expect(created[0].data.options).toEqual(['java', 'javac', 'jar', 'jvm']);
    expect(created[0].data.options[Number(created[0].data.expected)]).toBe('javac');
  });
});
