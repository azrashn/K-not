import { failure } from '../../../src/learning/quiz-failures';
import { QuizGenerator } from '../../../src/learning/quiz-generator';
import { generationNote, NOTE_MAX, possessive, possessiveIn } from '../../../src/learning/generation/generation-note';
import { MAX_TRIES, runPlan } from '../../../src/learning/generation/generation-run';
import { planQuestions, quizItems } from '../../../src/learning/generation/question-plan';
import { RepeatGuard } from '../../../src/learning/generation/repeat-guard';
import { buildPool, TRANSCRIPT_WARNING } from '../../../src/learning/generation/source-pool';
import { examTopics } from '../../../src/learning/generation/topic-planner';
import { NOTES, SEGMENTS } from './java-course';

const u = { id: 'u', role: 'USER' } as any;
const pool = buildPool([NOTES], SEGMENTS); // 5 parts, capacity 6 (n4 carries 2)
const topics = examTopics([], pool);

type Outcome = 'ok' | string; // 'ok' or a failure code
/** A generator double: `decide(request, call, position)` gives each requested item its outcome. */
function fakeGenerator(decide: (req: any, call: number, position: number) => Outcome) {
  let calls = 0;
  let next = 0;
  const generate = jest.fn(async (_u: any, _c: any, req: any) => {
    const call = calls++;
    const quizzes: any[] = [];
    const failures: any[] = [];
    req.items.forEach((item: any, slot: number) => {
      const outcome = decide(req, call, slot);
      if (outcome === 'ok') quizzes.push({ id: `q${next++}`, slot });
      else failures.push(failure(slot, item.kind, outcome, 2, item.variant));
    });
    return { quizzes, failures, stems: [] };
  });
  return { generate };
}

const options = (generator: any, extra: any = {}) => ({ generator, user: u, course: 'c', ...extra });

describe('running a plan', () => {
  test('one request per part, with that part as the only evidence and the set-wide limits', async () => {
    const plan = planQuestions(quizItems('MULTIPLE_CHOICE', 6), topics);
    const generator = fakeGenerator(() => 'ok');
    const guard = new RepeatGuard({ quotes: ['Önceki sınavdan bir cümle.'] });
    const result = await runPlan(plan, options(generator, { guard, styleHint: 'Kısa sorular.' }));
    expect(result.produced.map((p) => p.slot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.unresolved).toEqual([]);
    const requests = generator.generate.mock.calls.map((call: any[]) => call[2]);
    expect(requests).toHaveLength(5); // n4 carries its two questions in one request
    for (const r of requests) {
      expect(r.sources).toHaveLength(1);
      expect(r.guard).toBe(guard);
      expect(r.avoidQuotes).toEqual(['Önceki sınavdan bir cümle.']);
      expect(r.styleHint).toBe('Kısa sorular.');
    }
    const n4 = requests.find((r: any) => r.sources[0].id === 'n4');
    expect(n4.items).toHaveLength(2);
    expect(n4.sources[0]).toMatchObject({ material_id: NOTES.id, version: 'v1', kind: 'TXT', title: 'java-notlari' });
    expect(generationNote({ requested: 6, planned: 6, produced: 6, unresolved: [], stopped: null })).toBeNull();
  });

  test('a failed question is tried once more with a spare part, never more than twice', async () => {
    const plan = planQuestions(quizItems('OPEN', 4), topics); // n1..n4 used once; n5 and n4's second use are spare
    const generator = fakeGenerator((_req, call) => (call === 0 ? 'BAD_FORMAT' : 'ok'));
    const result = await runPlan(plan, options(generator));
    expect(result.produced).toHaveLength(4);
    const retry = generator.generate.mock.calls[4][2];
    expect(retry.sources[0].id).toBe(plan.spare[0].part.id);
    expect(result.tries).toEqual([expect.objectContaining({ slot: 0, code: 'BAD_FORMAT', try: 1 })]);
    expect(MAX_TRIES).toBe(2);
  });

  test('without a spare part the retry uses the question\'s own part', async () => {
    const plan = planQuestions(quizItems('OPEN', 6), topics); // the whole capacity: no spare
    expect(plan.spare).toEqual([]);
    const generator = fakeGenerator((_req, call) => (call === 0 ? 'DUPLICATE_QUOTE' : 'ok'));
    const result = await runPlan(plan, options(generator));
    expect(generator.generate.mock.calls.at(-1)![2].sources[0].id).toBe(plan.slots[0].part.id);
    expect(result.produced).toHaveLength(6);
  });

  test('at least 80%: one question failing twice leaves 9 of 10, and the note names its reason', async () => {
    const big = buildPool([NOTES], new Map([[NOTES.id, Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, text: `Konu ${i} hakkında birinci açıklayıcı cümle burada. Konu ${i} için ikinci cümle de vardır.`,
    }))]]));
    const plan = planQuestions(quizItems('TRUE_FALSE', 10), examTopics([], big));
    expect(plan.spare).toEqual([]); // ten parts for ten questions: the retry uses the same part
    const generator = fakeGenerator((req) => (req.sources[0].id === 'p3' ? 'NOT_SELF_CONTAINED' : 'ok'));
    const result = await runPlan(plan, options(generator));
    expect(result.produced.length / plan.slots.length).toBeGreaterThanOrEqual(0.8);
    expect(result.unresolved).toEqual([expect.objectContaining({ slot: 3, code: 'NOT_SELF_CONTAINED', tries: 2 })]);
    expect(generationNote({ requested: 10, planned: 10, produced: result.produced.length, unresolved: result.unresolved, stopped: null }))
      .toBe('10 sorudan 9\'u hazırlandı. Hazırlanamayan 1 sorunun 1\'inde neden: Soru, görülmeyen bir önceki cümleye bağlı başlıyordu (ör. "Bu", "Ardından"); tek başına anlaşılmıyordu. Her soru en fazla 2 kez denendi.');
  });

  test('an unreachable model stops the run at once', async () => {
    const plan = planQuestions(quizItems('OPEN', 5), topics);
    const generator = fakeGenerator(() => 'MODEL_UNREACHABLE');
    const result = await runPlan(plan, options(generator));
    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(result.stopped).toBe('MODEL');
    expect(result.unresolved.map((x) => x.code)).toEqual(['MODEL_UNREACHABLE', 'MODEL_UNREACHABLE', 'MODEL_UNREACHABLE', 'MODEL_UNREACHABLE', 'MODEL_UNREACHABLE']);
    expect(generationNote({ requested: 5, planned: 5, produced: 0, unresolved: result.unresolved, stopped: result.stopped }))
      .toBe('Soru hazırlayan modele ulaşılamadığı için üretim durduruldu. Kaynaklara dayalı soru hazırlanamadı.');
  });

  test('two requests in a row that only time out stop the run', async () => {
    const plan = planQuestions(quizItems('OPEN', 5), topics);
    const generator = fakeGenerator(() => 'TIMEOUT');
    const result = await runPlan(plan, options(generator));
    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(result.stopped).toBe('TIMEOUTS');
  });

  test('progress is reported after every request', async () => {
    const plan = planQuestions(quizItems('OPEN', 3), topics);
    const onProgress = jest.fn();
    await runPlan(plan, options(fakeGenerator(() => 'ok'), { onProgress }));
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.at(-1)[0].produced).toHaveLength(3);
  });
});

describe('the note (Azra: "En sık neden (7/7 deneme): … (2 deneme)")', () => {
  test('questions are counted, the tries are said once', () => {
    const unresolved = Array.from({ length: 7 }, () => ({ code: 'DUPLICATE_STEM', tries: 2 }));
    expect(generationNote({ requested: 14, planned: 14, produced: 7, unresolved, stopped: null })).toBe(
      '14 sorudan 7\'si hazırlandı. Hazırlanamayan 7 sorunun 7\'sinde neden: Soru, daha önce sorulmuş bir soruyla neredeyse aynıydı. Her soru en fazla 2 kez denendi.',
    );
  });

  test('the most common reason is named with how many questions it applies to', () => {
    const unresolved = [{ code: 'BAD_FORMAT', tries: 1 }, { code: 'TIMEOUT', tries: 1 }, { code: 'BAD_FORMAT', tries: 1 }];
    expect(generationNote({ requested: 9, planned: 9, produced: 6, unresolved, stopped: null })).toBe(
      '9 sorudan 6\'sı hazırlandı. Hazırlanamayan 3 sorunun 2\'sinde neden: Soru, türünün gerektirdiği biçime uymuyordu.',
    );
  });

  test('the transcript warning and the capacity note come first', () => {
    expect(generationNote({
      requested: 14, planned: 6, produced: 6, unresolved: [], stopped: null,
      capacityNote: 'Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.', warning: TRANSCRIPT_WARNING,
    })).toBe(`${TRANSCRIPT_WARNING} Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.`);
  });

  test('the note fits its column', () => {
    const note = generationNote({ requested: 20, planned: 20, produced: 1, unresolved: Array(19).fill({ code: 'NOT_SELF_CONTAINED', tries: 2 }),
      stopped: null, capacityNote: 'x'.repeat(200), warning: TRANSCRIPT_WARNING });
    expect(note!.length).toBe(NOTE_MAX);
  });

  test.each([
    [1, "1'i", "1'inde"], [2, "2'si", "2'sinde"], [3, "3'ü", "3'ünde"], [4, "4'ü", "4'ünde"], [5, "5'i", "5'inde"],
    [6, "6'sı", "6'sında"], [7, "7'si", "7'sinde"], [8, "8'i", "8'inde"], [9, "9'u", "9'unda"], [10, "10'u", "10'unda"],
    [14, "14'ü", "14'ünde"], [20, "20'si", "20'sinde"], [40, "40'ı", "40'ında"], [100, "100'ü", "100'ünde"],
  ])('%i: %s, %s', (n, word, inWord) => {
    expect(possessive(n)).toBe(word);
    expect(possessiveIn(n)).toBe(inWord);
  });
});

describe('quiz generator inside a run', () => {
  const TEXT = pool.parts[0].text;
  const QUOTE = 'Bytecode, Java Sanal Makinesi (JVM) üzerinde çalışır.';
  const QUALITY = { pipeline_version: 'single-call-v1', deterministic_validation: true, structural_validation: true, attempts: 1 };
  const question = (over: any = {}) => ({ slot: 0, kind: 'OPEN', question: 'Java bytecode hangi ortamda çalışır?', options: [],
    expected: '', quote: QUOTE, source_index: 1, explanation: 'JVM.', quality: QUALITY, ...over });

  function setup(questions: any[]) {
    const prisma = { learningQuiz: { create: jest.fn(async ({ data }: any) => data) } };
    const knowledge = { ask: jest.fn(), source: jest.fn().mockResolvedValue({}) };
    const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { questions, failures: [] } }) };
    return { generator: new QuizGenerator(prisma as any, knowledge as any, ai as any), prisma, knowledge, ai };
  }
  const evidence = { id: 'n1', text: TEXT, material_id: NOTES.id, version: 'v1', kind: 'TXT', title: 'java-notlari' };

  test('chosen sources are sent as they are, without a search, with the used sentences', async () => {
    const { generator, knowledge, ai } = setup([question()]);
    const guard = new RepeatGuard({ quotes: ['Önceki cümle burada.'] });
    const r = await generator.generate(u, 'c', { topic: 'JVM', items: [{ kind: 'OPEN' }], budgetSeconds: 60, sources: [evidence], guard, avoidQuotes: guard.avoidQuotes() });
    expect(knowledge.ask).not.toHaveBeenCalled();
    expect(ai.call.mock.calls[0][2].body).toMatchObject({ evidence: [evidence], avoid_quotes: ['Önceki cümle burada.'] });
    expect(r.quizzes).toHaveLength(1);
    expect(guard.isUsedQuote(QUOTE)).toBe(true); // recorded for the rest of the set
  });

  test('a sentence or a stem the set already holds is refused before it is stored', async () => {
    const used = setup([question()]);
    const guard = new RepeatGuard({ quotes: [QUOTE] });
    const r = await used.generator.generate(u, 'c', { topic: 'JVM', items: [{ kind: 'OPEN' }], budgetSeconds: 60, sources: [evidence], guard });
    expect(r.failures.map((f) => f.code)).toEqual(['DUPLICATE_QUOTE']);
    expect(used.prisma.learningQuiz.create).not.toHaveBeenCalled();

    const asked = setup([question()]);
    const earlier = new RepeatGuard({ stems: ['Java bytecode hangi ortamlarda çalışabilir?'] });
    const again = await asked.generator.generate(u, 'c', { topic: 'JVM', items: [{ kind: 'OPEN' }], budgetSeconds: 60, sources: [evidence], guard: earlier });
    expect(again.failures.map((f) => f.code)).toEqual(['DUPLICATE_STEM']);
  });
});
