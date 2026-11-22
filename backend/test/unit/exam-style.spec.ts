import { buildExamProfile, examStyleHint, EXAM_QUESTIONS_MAX, inlineOptionCount } from '../../src/learning/exam-style';
import { LearningService } from '../../src/learning/learning.service';

const EXAM = [
  '1. Aşağıdaki veri yapılarından hangisi FIFO çalışır?',
  'A) Yığın',
  'B) Kuyruk',
  'C) Ağaç',
  '2. Dijkstra algoritması negatif kenar ağırlıklarıyla doğru çalışır mı? Doğru veya yanlış yazınız.',
  '3. Aşağıdaki grafta BFS ile ziyaret sırasını hesaplayınız.',
].join('\n');

test('profile counts formats from numbering, options, true/false and calculation wording', () => {
  const p = buildExamProfile(EXAM);
  expect(p.question_count).toBe(3);
  expect(p.formats).toEqual({ MULTIPLE_CHOICE: 1, TRUE_FALSE: 1, CALCULATION: 1, SHORT_ANSWER: 0, CLOZE: 0, OPEN: 0 });
  expect(p.calculation_share).toBeCloseTo(0.33, 2);
  expect(p.sample_stems).toHaveLength(2);
  expect(p.topic_terms).toEqual(expect.arrayContaining(['grafta']));
});

test('an unnumbered text is refused instead of guessed', () => {
  expect(() => buildExamProfile('Bu bir sınav değil. Sadece düz bir paragraf.')).toThrow('NO_NUMBERED_QUESTIONS');
});

test('very long exams are cut to the question limit', () => {
  const long = Array.from({ length: EXAM_QUESTIONS_MAX + 10 }, (_, i) => `${i + 1}. Soru ${i} açıklayınız.`).join('\n');
  expect(buildExamProfile(long).question_count).toBe(EXAM_QUESTIONS_MAX);
});

test('the hint is server-built, bounded, and states that facts come from the course source', () => {
  const hint = examStyleHint(buildExamProfile(EXAM));
  expect(hint.length).toBeLessThanOrEqual(1200);
  expect(hint).toContain('yalnız üslup ve biçim için');
  expect(hint).toContain('Olgular ve doğru cevap yalnızca verilen kaynak alıntısından gelsin.');
});

test('creating a style stores only the profile, not the exam text', async () => {
  const prisma = { examStyle: { create: jest.fn(async ({ data }) => ({ id: 'x', name: data.name, createdAt: new Date(), profile: data.profile })) } };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
  const saved = await service.createExamStyle({ id: 'u', role: 'USER' } as any, 'c', { name: ' Final 2025 ', text: EXAM });
  const data = prisma.examStyle.create.mock.calls[0][0].data;
  expect(data.name).toBe('Final 2025');
  expect(JSON.stringify(data)).not.toContain('Yığın');
  expect(saved.profile.question_count).toBe(3);
});

test('an unnumbered exam is a validation error and is not stored', async () => {
  const prisma = { examStyle: { create: jest.fn() } };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any);
  await expect(service.createExamStyle({ id: 'u', role: 'USER' } as any, 'c', { name: 'x', text: 'düz metin ' .repeat(5) }))
    .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(prisma.examStyle.create).not.toHaveBeenCalled();
});

test('a quiz started with a saved style sends its hint to the model', async () => {
  const profile = buildExamProfile(EXAM);
  const prisma = { examStyle: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', profile }) } };
  const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ id: 's', text: 'Dijkstra algoritması negatif kenar ağırlığı ile doğru çalışmaz.', material_id: 'pdf_a', version: 'v', kind: 'PDF' }], video_learning: [] }) };
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 422, body: {} }) };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, knowledge as any, ai as any);
  await expect(service.start({ id: 'u', role: 'USER' } as any, 'c', { topic: 'Dijkstra', kind: 'TRUE_FALSE', exam_style_id: 'e1' })).rejects.toBeTruthy();
  expect(prisma.examStyle.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', courseId: 'c', ownerId: 'u' } });
  expect(ai.call.mock.calls[0][2].body.style_hint).toContain('Sınav stili');
});

test('another student\'s style, or an unknown one, is not found and nothing is sent to the model', async () => {
  const prisma = { examStyle: { findFirst: jest.fn().mockResolvedValue(null) } };
  const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ id: 's', text: 'Dijkstra algoritması negatif kenar ağırlığı ile doğru çalışmaz.', material_id: 'pdf_a', version: 'v', kind: 'PDF' }], video_learning: [] }) };
  const ai = { call: jest.fn() };
  const service = new LearningService(prisma as any, { requireMember: jest.fn() } as any, knowledge as any, ai as any);
  await expect(service.start({ id: 'u', role: 'USER' } as any, 'c', { topic: 'Dijkstra', kind: 'TRUE_FALSE', exam_style_id: 'other' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(ai.call).not.toHaveBeenCalled();
});

// A PDF often puts the options on the question's own line. The Java midterm of the test package:
// two multiple-choice questions written that way were read as open questions.
const INLINE_EXAM = [
  'JAVA PROGRAMLAMA - VİZE SINAVI',
  '1. Java dilini hangi şirket geliştirmiştir? a) Microsoft b) Sun Microsystems c) Apple d) IBM',
  '2. Java kaynak kodu derleyici tarafından hangi biçime çevrilir? a) Makine kodu b) Bytecode c) Assembly d) HTML',
  "3. Java Sanal Makinesi (JVM) bytecode'u çalıştırır. (Doğru / Yanlış)",
  '4. Java nesne yönelimli bir programlama dilidir. (Doğru / Yanlış)',
  '5. Java programlarının farklı işletim sistemlerinde çalışabilmesinin nedenini kısaca açıklayınız.',
  '6. Çöp toplayıcının (garbage collector) görevi nedir? Açıklayınız.',
].join('\n');

test('options written on the question line make it a multiple-choice question', () => {
  const p = buildExamProfile(INLINE_EXAM);
  expect(p.question_count).toBe(6);
  expect(p.formats).toEqual({ MULTIPLE_CHOICE: 2, TRUE_FALSE: 2, CALCULATION: 0, SHORT_ANSWER: 0, CLOZE: 0, OPEN: 2 });
});

test('inline options count only as an ordered run a, b, c', () => {
  expect(inlineOptionCount('hangisi? a) Microsoft b) Sun c) Apple d) IBM')).toBe(4);
  expect(inlineOptionCount('hangisi? A) Microsoft B) Sun C) Apple')).toBe(3);
  expect(inlineOptionCount('(a) bir (b) iki (c) üç')).toBe(3);
  // an "A)" in running text, or letters out of order, are not a list of options
  expect(inlineOptionCount('Madde A) tanımlayın; sonra C) ile karşılaştırın.')).toBe(1);
  expect(inlineOptionCount('Kaç tane? Yazınız.')).toBe(0);
});

test('a question with options on separate lines is still counted once', () => {
  const p = buildExamProfile(EXAM);
  expect(p.formats.MULTIPLE_CHOICE).toBe(1);
});

// What the PDF extractor really returns for the Java midterm: the options sit on the line under the question.
const PDF_SHAPED = [
  'JAVA PROGRAMLAMA - VİZE SINAVI',
  '1. Java dilini hangi şirket geliştirmiştir?',
  'a) Microsoft b) Sun Microsystems c) Apple d) IBM',
  '2. Java kaynak kodu derleyici tarafından hangi biçime çevrilir?',
  'a) Makine kodu b) Bytecode c) Assembly d) HTML',
  "3. Java Sanal Makinesi (JVM) bytecode'u çalıştırır. (Doğru / Yanlış)",
  '4. Java nesne yönelimli bir programlama dilidir. (Doğru / Yanlış)',
  '5. Java programlarının farklı işletim sistemlerinde çalışabilmesinin nedenini',
  'kısaca açıklayınız.',
  '6. Çöp toplayıcının (garbage collector) görevi nedir? Açıklayınız.',
].join('\n');

test('all options on the line under the question make it multiple choice (the extracted midterm PDF)', () => {
  const p = buildExamProfile(PDF_SHAPED);
  expect(p.question_count).toBe(6);
  expect(p.formats).toEqual({ MULTIPLE_CHOICE: 2, TRUE_FALSE: 2, CALCULATION: 0, SHORT_ANSWER: 0, CLOZE: 0, OPEN: 2 });
});

// Short answers and blanks are told apart from open questions (they were all counted as "açık uçlu").
const MORE_KINDS = [
  '1. TCP hangi katmanda çalışır? (kısa yanıt)',
  '2. Boşluğu doldurunuz: Veri iletiminde kayıp paketleri yeniden göndermek için ____ kullanılır.',
  '3. Kaynak kodu bytecode a çeviren araca ne denir?',
  '4. Çöp toplayıcının görevini kısaca açıklayınız.',
  '5. Tıkanıklık denetiminin amacını açıklayınız.',
  '6. Aşağıdaki cümleyi tamamlayınız: Java nesne ...... bir dildir.',
].join('\n');

test('short answers and blanks are counted on their own, "kısaca açıklayınız" stays open', () => {
  const p = buildExamProfile(MORE_KINDS);
  expect(p.formats).toEqual({
    MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, SHORT_ANSWER: 2, CLOZE: 2, OPEN: 2,
  });
});

test('the hint names short answers and blanks only when the exam has them', () => {
  expect(examStyleHint(buildExamProfile(MORE_KINDS))).toContain('kısa yanıt 2, boşluk doldurma 2, açık uçlu 2');
  expect(examStyleHint(buildExamProfile(EXAM))).not.toContain('kısa yanıt');
});

// ── what the reference set of real exams taught the reader ─────────────────────────────────────
const one = (text: string) => {
  const p = buildExamProfile(text);
  return Object.entries(p.formats).filter(([, n]) => n > 0).map(([f, n]) => `${f}:${n}`).join(',');
};

describe('sub-questions are not options', () => {
  test('(a) (b) (c) written as instructions or with points belong to one written question', () => {
    expect(one([
      '4. Türkiye\'de iç göçlerin büyük çoğunluğu kırsal kesimden kentlere doğru gerçekleşmektedir.',
      'a) İç göçlerin temel ekonomik nedenlerinden ikisini yazınız. (10 Puan)',
      'b) Yoğun göç alan büyükşehirlerde ortaya çıkan sorunlardan ikisini açıklayınız. (10 Puan)',
      'c) Çözüm olarak üretilebilecek bir politikayı belirtiniz. (5 Puan)',
    ].join('\n'))).toBe('OPEN:1');
    expect(one([
      '1. A database has 4 transactions.',
      '(a) Find all frequent itemsets using the Apriori algorithm.',
      '(b) List all strong association rules.',
      '(c) Show your work.',
    ].join('\n'))).toBe('CALCULATION:1');
  });

  test('descriptive options that merely contain a verb stay options', () => {
    expect(one([
      '2. Select the best description of inheritance:',
      'a) Allows a programmer to extend classes without code duplication.',
      'b) Allows a programmer to write a subclass that overrides private methods.',
      'c) Allows a programmer to write a concrete subclass without overriding abstract methods.',
      'd) Prevents a programmer from reusing code.',
    ].join('\n'))).toBe('MULTIPLE_CHOICE:1');
  });
});

describe('true / false markers', () => {
  test('"T F", "TRUE FALSE", "TRUE/FALSE:" and a capital YES NO mark a statement', () => {
    expect(one('1. T F A density-based clustering algorithm can generate non-globular clusters.')).toBe('TRUE_FALSE:1');
    expect(one('1. A Java class may implement multiple interfaces. TRUE FALSE')).toBe('TRUE_FALSE:1');
    expect(one('1. TRUE/FALSE: This fragment compiles without errors or warnings.')).toBe('TRUE_FALSE:1');
    expect(one('1. Indicate whether the following lines compile.\nA YES NO\nB YES NO')).toBe('TRUE_FALSE:1');
  });

  test('a group instruction turns the (a) (b) (c) lines into statements, not options', () => {
    expect(one([
      '1. Identify each statement as true or false by filling in the appropriate bubble.',
      '(a) Comments in a Java program are ignored by the compiler.',
      '(b) A variable declared in a for loop is accessible after the loop.',
      '(c) An int holds 32 bits.',
    ].join('\n'))).toBe('TRUE_FALSE:1');
    expect(one([
      '1. Aşağıdaki ifadelerin başına doğru ise (D), yanlış ise (Y) yazınız.',
      'a) Enzimler tepkimelerden değişmeden çıkar.',
      'b) Prokaryot hücrede çekirdek bulunur.',
      'c) Mitoz sonunda iki hücre oluşur.',
    ].join('\n'))).toBe('TRUE_FALSE:1');
  });

  test('a lone "true" or a circled "Yes No" with a justification is not a true/false item', () => {
    expect(one('1. Write a method that returns true when the array is sorted.')).toBe('OPEN:1');
    expect(one('9. (4 points) Are the two clusters well separated? Circle an answer: Yes No. Now justify your answer.')).toBe('OPEN:1');
  });
});

describe('calculation, short answers and numbering', () => {
  test('English calculation cues', () => {
    expect(one('3. How many calls are made to combRec when you execute combRec(4,2)?')).toBe('CALCULATION:1');
    expect(one('3. Assuming min_sup = 60%, find all frequent itemsets. Show your work.')).toBe('CALCULATION:1');
  });

  test('"what does this program print" without options is a short answer; with options it is multiple choice', () => {
    expect(one('4. What does this program print?\nclass P { }')).toBe('SHORT_ANSWER:1');
    expect(one('5. Aşağıdaki programın ekran çıktısı ne olur?\na) 10\nb) 20\nc) 30\nd) Derleme hatası')).toBe('MULTIPLE_CHOICE:1');
  });

  test('a question numbered "1.a" starts a question', () => {
    expect(one('1.a Which data type can handle both quantities?\na. int\nb. double\nc. float\nd. short')).toBe('MULTIPLE_CHOICE:1');
  });
});

describe('Problem N numaralaması ve kök biçimleri', () => {
  const TEXT = [
    'Problem 1 (20 points)',
    'Which of the following is NOT a property of a stack?',
    'a) LIFO',
    'b) Push',
    'c) Random access',
    'Question 2: Justify why quicksort is faster in practice. Explain why.',
    'Soru 3) Aşağıdakilerden hangisi en uygun tanımdır?',
    'A) x',
    'B) y',
    'C) z',
  ].join('\n');

  it('Problem / Question / Soru numaralı sorular sayılır, soru metni sonraki satırdan alınır', () => {
    const p = buildExamProfile(TEXT);
    expect(p.question_count).toBe(3);
    expect(p.formats.MULTIPLE_CHOICE).toBe(2);
    expect(p.sample_stems[0]).toMatch(/NOT a property/);
  });

  it('kök biçimleri yalnızca açıkça yazılı kalıplardan sayılır', () => {
    const p = buildExamProfile(TEXT);
    expect(p.stem_styles).toEqual({ NEGATIVE: 1, BEST_ANSWER: 1, WHICH_OF: 2, JUSTIFY: 1 });
  });

  it('ipucu, soruların dörtte birinde ve en az iki kez geçen kökü söyler; tek tük kökü söylemez; eski profilde değişmez', () => {
    const many = buildExamProfile(['1. Hangisi değildir? a) x b) y c) z', '2. Hangisi yanlıştır? a) x b) y c) z', '3. Bir şey yazınız.'].join('\n'));
    expect(examStyleHint(many)).toContain('olumsuz kök');
    const once = buildExamProfile('1. Hangisi değildir? a) x b) y c) z\n2. Bir şey yazınız.\n3. Başka.\n4. Daha.\n5. Son.');
    expect(examStyleHint(once)).not.toContain('olumsuz kök');
    const { stem_styles, ...old } = many;
    expect(examStyleHint(old)).not.toContain('kök biçimleri');
  });
});
