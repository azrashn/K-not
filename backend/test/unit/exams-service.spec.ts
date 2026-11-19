import { examNote, ExamsService } from '../../src/learning/exams.service';
import { DOCUMENTS_ONLY_NOTE } from '../../src/learning/quiz-sources';
import { ApiError } from '../../src/common/errors';
import { buildExamProfile } from '../../src/learning/exam-style';

const EXAM = ['1. Hangisi FIFO çalışır?', 'A) Yığın', 'B) Kuyruk', 'C) Ağaç', '2. BFS hangi yapıyı kullanır? Açıklayınız.', '3. DFS hangi yapıyı kullanır? Açıklayınız.', '4. Dijkstra negatif kenarla çalışır mı? Doğru veya yanlış yazınız.'].join('\n');
const profile = buildExamProfile(EXAM);
const u = { id: 'u', role: 'USER' } as any;

function make(over: { prisma?: any; ai?: any; learning?: any; knowledge?: any } = {}) {
  const prisma = {
    examStyle: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', name: 'Final', profile }]) },
    generatedExam: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date(), finishedAt: null })),
      update: jest.fn(async ({ data }) => data),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn(),
    },
    learningQuiz: { findMany: jest.fn().mockResolvedValue([]) },
    ...over.prisma,
  };
  const learning = { start: jest.fn(), quiz: jest.fn(), createExamStyle: jest.fn(async (_u, _c, b) => ({ id: 'new', name: b.name, profile })), ...over.learning };
  const ai = { call: jest.fn(), ...over.ai };
  // Course sources that mention every term of the past exam: topic grounding keeps them all.
  const knowledge = {
    materials: jest.fn().mockResolvedValue([{ id: 'm1', title: 'Notes', status: 'READY' }]),
    preview: jest.fn().mockResolvedValue({ segments: [{ text: EXAM }] }),
    ...over.knowledge,
  };
  const svc = new ExamsService(prisma as any, { requireMember: jest.fn() } as any, ai as any, learning as any, knowledge as any);
  return { svc, prisma, learning, ai, knowledge };
}
const lastUpdate = (prisma: any) => prisma.generatedExam.update.mock.calls.at(-1)[0].data;

describe('upload of a past exam file', () => {
  const pdf = { originalname: 'Final 2025.pdf', buffer: Buffer.from('%PDF-1.4 ...') };
  test('the extracted text becomes a style named after the file', async () => {
    const { svc, ai, learning } = make();
    ai.call.mockResolvedValue({ kind: 'response', status: 200, body: { text: EXAM } });
    await svc.uploadStyleFile(u, 'c', pdf, undefined);
    expect(ai.call.mock.calls[0][1]).toBe('/api/v1/knowledge/exam-text');
    expect(ai.call.mock.calls[0][2].body.kind).toBe('PDF');
    expect(learning.createExamStyle).toHaveBeenCalledWith(u, 'c', { name: 'Final 2025', text: EXAM });
  });
  test('a name given by the student wins', async () => {
    const { svc, ai, learning } = make();
    ai.call.mockResolvedValue({ kind: 'response', status: 200, body: { text: EXAM } });
    await svc.uploadStyleFile(u, 'c', { originalname: 'a.txt', buffer: Buffer.from(EXAM) }, 'Vize 2026');
    expect(learning.createExamStyle.mock.calls[0][2].name).toBe('Vize 2026');
  });
  test.each([
    [{ originalname: 'x.exe', buffer: Buffer.from('MZ') }, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ originalname: 'x.pdf', buffer: Buffer.from('not a pdf') }, 'UNSUPPORTED_MEDIA_TYPE'],
    [{ originalname: 'x.docx', buffer: Buffer.from('plain text') }, 'UNSUPPORTED_MEDIA_TYPE'],
    [undefined, 'VALIDATION_ERROR'],
  ])('%j is refused before any model call', async (file, code) => {
    const { svc, ai } = make();
    await expect(svc.uploadStyleFile(u, 'c', file as any)).rejects.toMatchObject({ code });
    expect(ai.call).not.toHaveBeenCalled();
  });
  test.each([
    [{ kind: 'timeout' }, 'PROVIDER_TIMEOUT'],
    [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE'],
    [{ kind: 'response', status: 503, body: {} }, 'AI_SERVICE_UNAVAILABLE'],
    [{ kind: 'response', status: 422, body: {} }, 'VALIDATION_ERROR'],
  ])('reader failure %j is %s and nothing is saved', async (reply, code) => {
    const { svc, ai, learning } = make();
    ai.call.mockResolvedValue(reply);
    await expect(svc.uploadStyleFile(u, 'c', pdf)).rejects.toMatchObject({ code });
    expect(learning.createExamStyle).not.toHaveBeenCalled();
  });
});

describe('creating an exam', () => {
  test('an unknown style or one that belongs to someone else is not found', async () => {
    const { svc } = make({ prisma: { examStyle: { findMany: jest.fn().mockResolvedValue([]) } } });
    await expect(svc.create(u, 'c', { exam_style_id: 'x', count: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  test('only one exam per course runs at a time', async () => {
    const { svc, prisma } = make();
    prisma.generatedExam.count.mockResolvedValue(1);
    await expect(svc.create(u, 'c', { exam_style_id: 'e1', count: 3 })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
  });
  test('a style without topic terms and sources without headings needs topics from the student', async () => {
    const empty = { ...profile, topic_terms: [] };
    const { svc } = make({
      prisma: { examStyle: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', name: 'x', profile: empty }]) } },
      knowledge: { preview: jest.fn().mockResolvedValue({ segments: [] }) },
    });
    await expect(svc.create(u, 'c', { exam_style_id: 'e1', count: 3 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  test('past-exam terms the course never mentions are replaced by the headings of the course sources', async () => {
    const other = { ...profile, topic_terms: ['kalıtım', 'polimorfizm'] };
    const { svc, prisma } = make({
      prisma: { examStyle: { findMany: jest.fn().mockResolvedValue([{ id: 'e1', name: 'x', profile: other }]) } },
      knowledge: { preview: jest.fn().mockResolvedValue({ segments: [{ text: 'Link layer: services\nframing, link access' }, { text: 'TCP: overview\nreliable byte stream' }] }) },
    });
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 2 });
    const topics = prisma.generatedExam.create.mock.calls[0][0].data.topics;
    expect(topics).toEqual(['Link layer: services', 'TCP: overview']);
  });
  test('topics the student writes are used as written, never filtered', async () => {
    const { svc, prisma, knowledge } = make();
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 2, topics: ['Benim konum'] });
    expect(prisma.generatedExam.create.mock.calls[0][0].data.topics).toEqual(['Benim konum']);
    expect(knowledge.preview).not.toHaveBeenCalled();
  });
  test('when the course also has videos, topics come from documents and the exam says transcripts were left out', async () => {
    const { svc, prisma, learning, knowledge } = make({
      knowledge: {
        materials: jest.fn().mockResolvedValue([
          { id: 'pdf_m', kind: 'PDF', title: 'Notes', status: 'READY' },
          { id: 'video_v', kind: 'VIDEO', title: '2 Dakikada Java', status: 'READY' },
        ]),
      },
    });
    learning.start.mockResolvedValue({ id: 'q1' });
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 1 });
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(knowledge.preview.mock.calls.map((call: any[]) => call[2])).toEqual(['pdf_m']);
    expect(lastUpdate(prisma)).toMatchObject({ status: 'READY', note: DOCUMENTS_ONLY_NOTE });
  });
  test('the source note comes first and the whole note fits the 300-character column', () => {
    expect(examNote(null, null)).toBeNull();
    expect(examNote(DOCUMENTS_ONLY_NOTE, null)).toBe(DOCUMENTS_ONLY_NOTE);
    expect(examNote(DOCUMENTS_ONLY_NOTE, '3 sorudan 2\'si hazırlanabildi.')).toBe(`${DOCUMENTS_ONLY_NOTE} 3 sorudan 2'si hazırlanabildi.`);
    expect(examNote(DOCUMENTS_ONLY_NOTE, 'x'.repeat(400))).toHaveLength(300);
  });
  test('it is accepted at once with the planned size, before any question exists', async () => {
    const { svc, prisma, learning } = make();
    learning.start.mockImplementation(() => new Promise(() => undefined)); // never finishes
    const exam = await svc.create(u, 'c', { exam_style_id: 'e1', count: 4, topics: ['BFS'] });
    expect(exam).toMatchObject({ status: 'GENERATING', requested: 4, produced: 0 });
    expect(prisma.generatedExam.create.mock.calls[0][0].data.styleId).toBe('e1');
  });
});

describe('the generation run', () => {
  const run = (svc: any, kinds: string[], topics: string[]) => svc.run(u, 'c', 'x1', 'e1', kinds, topics, undefined);

  test('a topic without a source is skipped and the next topic is tried', async () => {
    const { svc, prisma, learning } = make();
    learning.start
      .mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'Bu konuda kaynak bulunamadı.'))
      .mockResolvedValueOnce({ id: 'q1' });
    await run(svc, ['MULTIPLE_CHOICE'], ['yok', 'BFS']);
    const data = lastUpdate(prisma);
    expect(data.status).toBe('READY');
    expect(data.items).toEqual([{ quiz_id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'BFS' }]);
    expect(data.failures).toHaveLength(1);
    expect(learning.start.mock.calls[1][2]).toMatchObject({ topic: 'BFS', kind: 'MULTIPLE_CHOICE', exam_style_id: 'e1' });
  });
  test('when only some questions can be sourced the exam is partial and says why', async () => {
    const { svc, prisma, learning } = make();
    learning.start
      .mockResolvedValueOnce({ id: 'q1' })
      .mockRejectedValue(new ApiError('VALIDATION_ERROR', 'Kaynak bulunamadı.'));
    await run(svc, ['MULTIPLE_CHOICE', 'OPEN'], ['BFS']);
    const data = lastUpdate(prisma);
    expect(data.status).toBe('PARTIAL');
    expect(data.items).toHaveLength(1);
    expect(data.note).toContain("2 sorudan 1'i");
  });
  test('nothing sourced means failed with advice, never an invented question', async () => {
    const { svc, prisma, learning } = make();
    learning.start.mockRejectedValue(new ApiError('GENERATION_FAILED', 'Soru kalite kontrolünden geçmedi.'));
    await run(svc, ['OPEN'], ['a', 'b']);
    const data = lastUpdate(prisma);
    expect(data.status).toBe('FAILED');
    expect(data.items).toEqual([]);
    expect(data.note).toContain('En sık neden (2/2 deneme): Soru kalite kontrolünden geçmedi.');
  });
  test('a model outage stops the run at once instead of retrying every topic', async () => {
    const { svc, prisma, learning } = make();
    learning.start.mockResolvedValueOnce({ id: 'q1' }).mockRejectedValue(new ApiError('AI_SERVICE_UNAVAILABLE', 'Model yanıt veremedi.'));
    await run(svc, ['MULTIPLE_CHOICE', 'OPEN', 'OPEN'], ['a', 'b', 'c']);
    expect(learning.start).toHaveBeenCalledTimes(2);
    expect(lastUpdate(prisma)).toMatchObject({ status: 'PARTIAL' });
    expect(lastUpdate(prisma).note).toContain('model');
  });
  test('attempts are bounded so a hopeless topic list cannot loop forever', async () => {
    const { svc, learning } = make();
    learning.start.mockRejectedValue(new ApiError('VALIDATION_ERROR', 'Kaynak yok.'));
    await run(svc, ['OPEN', 'OPEN'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(learning.start.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe('reading an exam', () => {
  const row = { id: 'x1', courseId: 'c', userId: 'u', title: 'T', status: 'READY', requested: 2, topics: [], failures: [], note: null, styleId: 'e1', createdAt: new Date(), finishedAt: null,
    items: [{ quiz_id: 'q1', kind: 'MULTIPLE_CHOICE', topic: 'BFS' }, { quiz_id: 'q2', kind: 'OPEN', topic: 'DFS' }] };

  test('a question whose source was removed is marked unavailable, not shown stale', async () => {
    const { svc, prisma, learning } = make();
    prisma.generatedExam.findFirst.mockResolvedValue(row);
    learning.quiz.mockResolvedValueOnce({ id: 'q1', question: 'Q?' }).mockRejectedValueOnce(new ApiError('NOT_FOUND', 'x'));
    const exam = await svc.get(u, 'c', 'x1');
    expect(exam.questions.map((q: any) => q.available)).toEqual([true, false]);
  });
  test('another student cannot read the exam', async () => {
    const { svc, prisma } = make();
    prisma.generatedExam.findFirst.mockResolvedValue(null);
    await expect(svc.get(u, 'c', 'x1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.generatedExam.findFirst.mock.calls[0][0].where).toMatchObject({ userId: 'u', courseId: 'c' });
  });
  test('the answer key names the correct option text, and open questions have no key answer', async () => {
    const { svc, prisma } = make();
    prisma.generatedExam.findFirst.mockResolvedValue(row);
    prisma.learningQuiz.findMany.mockResolvedValue([
      { id: 'q1', kind: 'MULTIPLE_CHOICE', data: { options: ['Yığın', 'Kuyruk', 'Ağaç', 'Küme'], expected: '1', explanation: 'FIFO.', quote: 'BFS kuyruk kullanır.', source: { title: 'Notlar', location: { page: 3 } } } },
      { id: 'q2', kind: 'OPEN', data: { options: [], expected: '', explanation: 'Açıkla.', quote: 'DFS yığın kullanır.', source: { title: 'Notlar', location: { page: 4 } } } },
    ]);
    const { key } = await svc.key(u, 'c', 'x1');
    expect(key[0]).toMatchObject({ index: 1, expected: 'Kuyruk', explanation: 'FIFO.' });
    expect(key[1]).toMatchObject({ index: 2, expected: null });
  });
  test('removing an exam only removes the caller\'s own', async () => {
    const { svc, prisma } = make();
    await svc.remove(u, 'c', 'x1');
    expect(prisma.generatedExam.deleteMany).toHaveBeenCalledWith({ where: { id: 'x1', courseId: 'c', userId: 'u' } });
  });
  test('after a restart, runs that were generating are marked failed', async () => {
    const { svc, prisma } = make();
    await svc.onModuleInit();
    expect(prisma.generatedExam.updateMany.mock.calls[0][0]).toMatchObject({ where: { status: 'GENERATING' }, data: { status: 'FAILED' } });
  });
});
