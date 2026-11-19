import { groundTopics, planExamItems, planExamKinds } from '../../src/learning/exam-plan';
import {
  buildExamProfile, EXAM_HINT_MAX, examStyleHint, ExamProfile, mergeExamProfiles, MERGED_STEM_CHARS, MERGED_TERMS_MAX,
} from '../../src/learning/exam-style';

const profile = (p: Partial<Omit<ExamProfile, 'formats'>> & { formats?: Partial<ExamProfile['formats']> } = {}): ExamProfile => {
  const { formats: given, ...rest } = p;
  const formats = { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, OPEN: 0, ...given };
  const question_count = Object.values(formats).reduce((a, b) => a + b, 0);
  return {
    question_count,
    calculation_share: 0,
    average_stem_chars: 60,
    sample_stems: [],
    topic_terms: [],
    ...rest,
    formats,
  };
};
const count = (kinds: string[]) => kinds.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});

/** The hint as it was before several exams could be combined. */
function previousHint(profile: ExamProfile): string {
  const f = profile.formats;
  return [
    `Sınav stili (yalnız üslup ve biçim için): ${profile.question_count} soru;`,
    `çoktan seçmeli ${f.MULTIPLE_CHOICE}, doğru/yanlış ${f.TRUE_FALSE}, hesaplama ${f.CALCULATION}, açık uçlu ${f.OPEN};`,
    `ortalama soru uzunluğu yaklaşık ${profile.average_stem_chars} karakter.`,
    profile.topic_terms.length ? `Sık geçen terimler: ${profile.topic_terms.join(', ')}.` : '',
    profile.sample_stems.length ? `Örnek soru kalıpları: ${profile.sample_stems.map((s) => `“${s}”`).join(' ')}.` : '',
    'Olgular ve doğru cevap yalnızca verilen kaynak alıntısından gelsin.',
  ].filter(Boolean).join(' ').slice(0, 1200);
}

describe('one past exam stays exactly as before', () => {
  const single = buildExamProfile([
    '1. Dijkstra algoritmasında kenar ağırlıkları için hangisi doğrudur?',
    'A) a', 'B) b', 'C) c',
    '2. Kırmızı-siyah ağaçta kök düğümün rengi siyahtır. Doğru mu yanlış mı?',
    '3. Grafın en kısa yol uzunluğunu hesaplayınız.',
  ].join('\n'));

  test('merging one profile returns it unchanged', () => {
    const merged = mergeExamProfiles([single]);
    const { exam_count, term_exams, ...rest } = merged;
    expect(rest).toEqual(single);
    expect(exam_count).toBe(1);
    expect(Object.values(term_exams).every((n) => n === 1)).toBe(true);
  });
  test('the hint of one exam is byte for byte the previous hint', () => {
    expect(examStyleHint(single)).toBe(previousHint(single));
    expect(examStyleHint(mergeExamProfiles([single]))).toBe(previousHint(single));
  });
  test('the kind plan of one exam does not change', () => {
    expect(planExamItems(mergeExamProfiles([single]), 7)).toEqual(planExamItems(single, 7));
  });
});

describe('several past exams are combined into one profile', () => {
  test('the kind mix is weighted by question count', () => {
    const big = profile({ formats: { MULTIPLE_CHOICE: 10 } });
    const small = profile({ formats: { TRUE_FALSE: 2 } });
    const merged = mergeExamProfiles([big, small]);
    expect(merged.question_count).toBe(12);
    expect(merged.formats).toEqual({ MULTIPLE_CHOICE: 10, TRUE_FALSE: 2, CALCULATION: 0, OPEN: 0 });
    expect(count(planExamKinds(merged, 6))).toEqual({ MULTIPLE_CHOICE: 5, TRUE_FALSE: 1 });
  });
  test('calculation share is recomputed over all questions', () => {
    const merged = mergeExamProfiles([profile({ formats: { CALCULATION: 3, OPEN: 1 } }), profile({ formats: { OPEN: 4 } })]);
    expect(merged.calculation_share).toBe(0.38);
  });
  test('average stem length is weighted by question count', () => {
    const merged = mergeExamProfiles([
      profile({ formats: { OPEN: 9 }, average_stem_chars: 100 }),
      profile({ formats: { OPEN: 1 }, average_stem_chars: 10 }),
    ]);
    expect(merged.average_stem_chars).toBe(91);
  });
  test('a term in two exams comes before the top term of one exam', () => {
    const merged = mergeExamProfiles([
      profile({ formats: { OPEN: 1 }, topic_terms: ['dijkstra', 'graf'] }),
      profile({ formats: { OPEN: 1 }, topic_terms: ['huffman', 'Graf'] }),
    ]);
    expect(merged.topic_terms[0]).toBe('graf');
    expect(merged.term_exams).toEqual({ dijkstra: 1, graf: 2, huffman: 1 });
    // Equal exam counts: the higher rank inside its exam wins, then the alphabet.
    expect(merged.topic_terms).toEqual(['graf', 'dijkstra', 'huffman']);
  });
  test('higher ranks inside the exams break ties between terms of the same exam count', () => {
    const merged = mergeExamProfiles([
      profile({ formats: { OPEN: 1 }, topic_terms: ['zincir', 'ağaç'] }),
      profile({ formats: { OPEN: 1 }, topic_terms: ['zincir', 'ağaç'] }),
    ]);
    expect(merged.topic_terms).toEqual(['zincir', 'ağaç']);
  });
  test(`at most ${MERGED_TERMS_MAX} terms are kept`, () => {
    const terms = (p: string) => Array.from({ length: 8 }, (_, i) => `${p}terim${i}`);
    const merged = mergeExamProfiles([
      profile({ formats: { OPEN: 1 }, topic_terms: terms('a') }),
      profile({ formats: { OPEN: 1 }, topic_terms: terms('b') }),
    ]);
    expect(merged.topic_terms).toHaveLength(MERGED_TERMS_MAX);
  });
  test('every exam gives at least one sample stem, taken in turn and shortened', () => {
    const long = 'x'.repeat(200);
    const merged = mergeExamProfiles([
      profile({ formats: { OPEN: 2 }, sample_stems: ['A1', 'A2'] }),
      profile({ formats: { OPEN: 2 }, sample_stems: ['B1', 'B2'] }),
      profile({ formats: { OPEN: 1 }, sample_stems: [long] }),
    ]);
    expect(merged.sample_stems).toEqual(['A1', 'B1', 'x'.repeat(MERGED_STEM_CHARS), 'A2', 'B2']);
  });
  test('no profile is an error', () => {
    expect(() => mergeExamProfiles([])).toThrow('NO_PROFILES');
  });
});

describe('the hint of several exams', () => {
  const guard = 'Olgular ve doğru cevap yalnızca verilen kaynak alıntısından gelsin.';

  test('names how many exams it comes from', () => {
    const hint = examStyleHint(mergeExamProfiles([
      profile({ formats: { OPEN: 3 }, sample_stems: ['A1'] }),
      profile({ formats: { OPEN: 4 }, sample_stems: ['B1'] }),
    ]));
    expect(hint).toContain('2 geçmiş sınav, toplam 7 soru;');
    expect(hint).toContain('“A1” “B1”');
    expect(hint.endsWith(guard)).toBe(true);
  });
  test('five long exams stay within the limit, keep one stem each and never lose the source rule', () => {
    const exams = Array.from({ length: 5 }, (_, e) => profile({
      formats: { MULTIPLE_CHOICE: 20 },
      sample_stems: [`${e}`.repeat(160), `${e}b`.repeat(80)],
      topic_terms: Array.from({ length: 8 }, (_, i) => `uzunterimsözcüğü${e}${i}`),
    }));
    const hint = examStyleHint(mergeExamProfiles(exams));
    expect(hint.length).toBeLessThanOrEqual(EXAM_HINT_MAX);
    expect(hint.endsWith(guard)).toBe(true);
    for (let e = 0; e < 5; e++) expect(hint).toContain(`“${`${e}`.repeat(MERGED_STEM_CHARS)}”`);
  });
  test('an oversized profile is cut before the source rule, not after', () => {
    const hint = examStyleHint(profile({ formats: { OPEN: 1 }, topic_terms: ['y'.repeat(2000)] }));
    expect(hint.length).toBeLessThanOrEqual(EXAM_HINT_MAX);
    expect(hint.endsWith(guard)).toBe(true);
  });
});

describe('grounding with an exam priority', () => {
  const sources = [{ title: 'Ders', text: 'graf graf graf graf dijkstra huffman huffman' }];

  test('without a priority the order is source frequency, as before', () => {
    expect(groundTopics(['dijkstra', 'huffman', 'graf'], sources, 1).topics.slice(0, 3)).toEqual(['graf', 'huffman', 'dijkstra']);
  });
  test('terms shared by more exams come first; source frequency orders the rest', () => {
    const r = groundTopics(['graf', 'huffman', 'dijkstra', 'yok'], sources, 1, { dijkstra: 3, huffman: 1, graf: 1, yok: 5 });
    expect(r.topics.slice(0, 3)).toEqual(['dijkstra', 'graf', 'huffman']);
  });
  test('a term the sources do not contain is still dropped, whatever its priority', () => {
    const r = groundTopics(['graf', 'yok'], sources, 1, { yok: 5 });
    expect(r.topics).not.toContain('yok');
    expect(r.dropped).toEqual(['yok']);
  });
});
