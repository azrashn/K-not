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
