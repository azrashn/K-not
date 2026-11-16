import { buildExamProfile, examStyleHint, EXAM_QUESTIONS_MAX } from '../../src/learning/exam-style';
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
  expect(p.formats).toEqual({ MULTIPLE_CHOICE: 1, TRUE_FALSE: 1, CALCULATION: 1, OPEN: 0 });
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
