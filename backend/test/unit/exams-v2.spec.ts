import { defaultExamCount, ExamsService } from '../../src/learning/exams.service';
import { buildExamProfile } from '../../src/learning/exam-style';
import { commonReason, EXAM_MAX_QUESTIONS, groundTopics, planExamItems, planExamKinds } from '../../src/learning/exam-plan';
import { isDuplicateStem } from '../../src/learning/quiz-repeat';
import { QuizGenerator } from '../../src/learning/quiz-generator';
import { failure } from '../../src/learning/quiz-failures';
import { NOTHING_TO_ASK, UNEXPECTED } from '../../src/learning/generation/exam-builder';
import { NO_DOCUMENT_MESSAGE, TRANSCRIPT_WARNING } from '../../src/learning/generation/source-pool';
import { TOPIC_NOT_IN_DOCUMENTS } from '../../src/learning/generation/topic-planner';
import { NOTES, NOTE_SEGMENTS, SEGMENTS, VIDEO, knowledge as javaCourse } from './generation/java-course';

const EXAM = ['1. Hangisi FIFO çalışır?', 'A) Yığın', 'B) Kuyruk', 'C) Ağaç', '2. BFS hangi yapıyı kullanır? Açıklayınız.',
  '3. Dijkstra negatif kenarla çalışır mı? Doğru veya yanlış yazınız.', '4. 3 düğümlü yolun maliyetini hesaplayınız.'].join('\n');
const profile = buildExamProfile(EXAM);
const u = { id: 'u', role: 'USER' } as any;

type Request = { topic: string; items: { kind: string; variant: string | null }[]; sources: any[]; avoidQuotes: string[];
  budgetSeconds: number; styleHint: string | null };

const STYLES = [{ id: 'e1', name: 'Final', profile, ownerId: 'u' }];
/** examStyle.findMany double: the saved styles of user `u` among the ids asked for (in storage order). */
const styleStore = (styles: { id: string; name: string; profile: any; ownerId?: string }[]) =>
  jest.fn(async ({ where }: any) => styles.filter((s) => where.id.in.includes(s.id) && (s.ownerId ?? 'u') === where.ownerId));

/** A course of graph notes, each segment its own part (2 sentences each: capacity 1). */
const GRAPH = { id: 'file_graph', kind: 'TXT', title: 'Graf notları', status: 'READY', version: 'v1' };
const graphSegments = Array.from({ length: 8 }, (_, i) => ({
  id: `g${i}`, text: `Kuyruk ve BFS konusunun ${i + 1}. bölümü burada anlatılır. BFS bekleyen düğümleri kuyrukta tutar ve katman katman ilerler.`,
}));
const graphCourse = () => javaCourse([GRAPH], new Map([[GRAPH.id, graphSegments]]));

/** `answer(request, call)` decides per request; by default every question is produced. */
function make(answer?: (r: Request, call: number) => any, over: { knowledge?: any; config?: any; styles?: any[] } = {}) {
  const prisma = {
    examStyle: { findMany: styleStore(over.styles ?? STYLES) },
    generatedExam: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date(), finishedAt: null })),
      update: jest.fn(async ({ data }) => data),
    },
  };
  const requests: Request[] = [];
  let n = 0;
  const produce = (r: Request) => ({
    quizzes: r.items.map((_it, slot) => ({ id: `q${++n}`, slot })), stems: [], failures: [],
  });
  const generator = {
    generate: jest.fn(async (_u: any, _c: any, r: Request) => {
      requests.push({ ...r, avoidQuotes: [...(r.avoidQuotes ?? [])] });
      const out = answer?.(r, requests.length);
      if (out instanceof Error) throw out;
      return out ?? produce(r);
    }),
  };
  const svc = new ExamsService(prisma as any, { requireMember: jest.fn() } as any, {} as any, {} as any,
    'knowledge' in over ? over.knowledge : graphCourse(), generator as unknown as QuizGenerator, over.config);
  return { svc, prisma, generator, requests };
}
const created = (prisma: any) => prisma.generatedExam.create.mock.calls[0][0].data;
const last = (prisma: any) => prisma.generatedExam.update.mock.calls.at(-1)[0].data;
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const fails = (r: Request, code: string) =>
  ({ quizzes: [], stems: [], failures: r.items.map((it, slot) => failure(slot, it.kind, code, 2, it.variant)) });
const hang = () => new Promise(() => undefined);

describe('v2 exam plan', () => {
  test('a calculation stays a calculation; the kind mix is the legacy one', () => {
    const items = planExamItems(profile, 8);
    expect(items.map((i) => i.kind)).toEqual(planExamKinds(profile, 8));
    expect(items.filter((i) => i.kind === 'SHORT_ANSWER').every((i) => i.variant === 'CALCULATION')).toBe(true);
    expect(items.some((i) => i.variant === 'CALCULATION')).toBe(true);
  });
});

describe('Azra\'s trial: the Java course with notes and a video', () => {
  const java = buildExamProfile(['1. Object nedir? Açıklayınız.', '2. Object sınıfı hangi pakettedir?', 'A) java.lang', 'B) java.io',
    'C) java.util', ...Array.from({ length: 12 }, (_, i) => `${i + 3}. Object kavramını açıklayınız (${i}).`)].join('\n'));
  const styles = [{ id: 'j', name: 'Java vize', profile: java }];

  test('14 questions over notes that carry 6: planned as 6, never from the transcript, said in the note', async () => {
    const course = javaCourse([NOTES, VIDEO]);
    const { svc, prisma, requests } = make(undefined, { knowledge: course, styles });
    const exam = await svc.create(u, 'c', { exam_style_id: 'j', count: 14 });
    expect(exam).toMatchObject({ status: 'GENERATING', requested: 6 });
    expect(created(prisma).note).toBe('Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.');
    expect(created(prisma).topics.length).toBeGreaterThan(1); // not one topic ("object") for the whole exam
    await settle();
    expect(requests.every((r) => r.sources.length === 1 && r.sources[0].material_id === NOTES.id)).toBe(true);
    expect(new Set(requests.map((r) => r.sources[0].id))).toEqual(new Set(NOTE_SEGMENTS.map((s) => s.id)));
    expect(course.preview.mock.calls.map((c: any[]) => c[2])).toEqual([NOTES.id]);
    expect(last(prisma)).toMatchObject({ status: 'READY', note: 'Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.' });
    expect(last(prisma).items).toHaveLength(6);
  });

  test('used sentences travel with every later request of the exam', async () => {
    const { svc, requests } = make(undefined, { knowledge: javaCourse([NOTES]), styles });
    await svc.create(u, 'c', { exam_style_id: 'j', count: 3 });
    await settle();
    expect(requests.map((r) => r.avoidQuotes)).toEqual([[], [], []]); // the fake stores nothing; the guard is the generator's
    expect(requests.every((r) => r.budgetSeconds === 240 && r.styleHint?.includes('Object'))).toBe(true);
  });

  test('a course with only the video: transcript questions, with the warning first in the note', async () => {
    const { svc, prisma, requests } = make(undefined, { knowledge: javaCourse([VIDEO]), styles });
    await svc.create(u, 'c', { exam_style_id: 'j', count: 2 });
    expect(created(prisma).note).toBe(TRANSCRIPT_WARNING);
    await settle();
    expect(requests.every((r) => r.sources[0].material_id === VIDEO.id)).toBe(true);
    expect(last(prisma).note).toBe(TRANSCRIPT_WARNING);
  });

  test('QUIZ_TRANSCRIPT_POLICY=never without a document asks for one and creates nothing', async () => {
    const { svc, prisma } = make(undefined, { knowledge: javaCourse([VIDEO]), styles, config: { quizEngine: 'v2', quizTranscriptPolicy: 'never' } });
    await expect(svc.create(u, 'c', { exam_style_id: 'j', count: 2 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: NO_DOCUMENT_MESSAGE });
    expect(prisma.generatedExam.create).not.toHaveBeenCalled();
  });

  test('a written topic only the transcript mentions is refused with the hint to choose the video', async () => {
    const { svc, prisma } = make(undefined, { knowledge: javaCourse([NOTES, VIDEO]), styles });
    await expect(svc.create(u, 'c', { exam_style_id: 'j', count: 2, topics: ['Intelijayda derleicisi'] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: TOPIC_NOT_IN_DOCUMENTS });
    expect(prisma.generatedExam.create).not.toHaveBeenCalled();
  });
});

describe('creating a v2 exam', () => {
  test('written topics are kept as written and bound to the parts that hold them', async () => {
    const { svc, prisma, requests } = make();
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 2, topics: ['BFS kuyruğu', 'Kırmızı-siyah ağaç', 'BFS kuyruğu'] });
    expect(created(prisma).topics).toEqual(['BFS kuyruğu']); // the tree is in no source; the repeat is dropped
    await settle();
    expect(requests.every((r) => r.topic === 'BFS kuyruğu')).toBe(true);
  });

  test('a course without usable text is refused before an exam exists', async () => {
    // A scanned PDF: its pages have no extractable text.
    const empty = javaCourse([GRAPH], new Map([[GRAPH.id, [{ id: 'x', text: '[Bu sayfada çıkarılabilir metin yok.]', location: { kind: 'page', page: 1, empty: true } }, { id: 'y', text: '   ' }]]]));
    const { svc, prisma } = make(undefined, { knowledge: empty });
    await expect(svc.create(u, 'c', { exam_style_id: 'e1', count: 2 })).rejects.toMatchObject({ message: NOTHING_TO_ASK });
    expect(prisma.generatedExam.create).not.toHaveBeenCalled();
  });

  test('only one exam per course runs at a time', async () => {
    const { svc, prisma } = make();
    prisma.generatedExam.count.mockResolvedValue(1);
    await expect(svc.create(u, 'c', { exam_style_id: 'e1', count: 2 })).rejects.toMatchObject({ code: 'JOB_ALREADY_RUNNING' });
  });

  test('a partial exam keeps what was made and says why the rest was not, per question', async () => {
    const { svc, prisma } = make((r) => (r.sources[0].id === 'g1' ? fails(r, 'BAD_FORMAT') : undefined));
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 8 });
    await settle();
    const data = last(prisma);
    expect(data.status).toBe('PARTIAL');
    expect(data.items).toHaveLength(7);
    expect(data.note).toBe('8 sorudan 7\'si hazırlandı. Hazırlanamayan 1 sorunun 1\'inde neden: Soru, türünün gerektirdiği biçime uymuyordu. Her soru en fazla 5 kez denendi.');
    expect(data.failures).toEqual([
      expect.objectContaining({ code: 'BAD_FORMAT', reason: expect.any(String), topic: expect.any(String), kind: expect.any(String) }),
      expect.objectContaining({ code: 'BAD_FORMAT' }),
      expect.objectContaining({ code: 'BAD_FORMAT' }),
      expect.objectContaining({ code: 'BAD_FORMAT' }),
      expect.objectContaining({ code: 'BAD_FORMAT' }),
    ]);
  });

  test('an unreachable model ends the exam as failed with that reason', async () => {
    const { svc, prisma, requests } = make((r) => fails(r, 'MODEL_UNREACHABLE'));
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 4 });
    await settle();
    expect(requests).toHaveLength(1);
    expect(last(prisma)).toMatchObject({ status: 'FAILED', note: 'Soru hazırlayan modele ulaşılamadığı için üretim durduruldu. Kaynaklara dayalı soru hazırlanamadı.' });
  });

  test('an unexpected error ends the run as failed', async () => {
    const { svc, prisma } = make(() => new Error('boom'));
    await svc.create(u, 'c', { exam_style_id: 'e1', count: 2 });
    await settle();
    expect(last(prisma)).toMatchObject({ status: 'FAILED', note: UNEXPECTED });
  });

  test('QUIZ_ENGINE=legacy keeps the legacy run and topics', async () => {
    const own = { materials: jest.fn().mockResolvedValue([]), preview: jest.fn() };
    const legacy = make(undefined, { knowledge: own, config: { quizEngine: 'legacy' } });
    expect(legacy.svc.quizEngine).toBe('legacy');
    const learning = { start: jest.fn(() => new Promise(() => undefined)) };
    (legacy.svc as any).learning = learning;
    await legacy.svc.create(u, 'c', { exam_style_id: 'e1', count: 2, topics: ['BFS'] });
    await new Promise((r) => setImmediate(r));
    expect(legacy.generator.generate).not.toHaveBeenCalled();
    expect(own.materials).not.toHaveBeenCalled();
    expect(learning.start).toHaveBeenCalled();
  });

  test('a service built without the generator is legacy', () => {
    expect(new ExamsService({} as any, {} as any, {} as any, {} as any).quizEngine).toBe('legacy');
  });
});

describe('creating an exam from several past exams', () => {
  const MIDTERM = ['1. Huffman kodlamasında hangi yapı kullanılır?', 'A) Yığın', 'B) Öncelik kuyruğu', 'C) Liste', 'D) Ağaç',
    '2. Huffman ağacının yüksekliğini hesaplayınız.'].join('\n');
  const midterm = buildExamProfile(MIDTERM);
  const both = [
    { id: 'e2', name: 'Vize', profile: midterm }, // stored first: the order chosen by the student must still win
    { id: 'e1', name: 'Final', profile },
    { id: 'theirs', name: 'Başkası', profile, ownerId: 'other' },
  ];

  test('the hint, plan and stored styles come from every selected exam, in the order chosen', async () => {
    const { svc, prisma, requests } = make(hang, { styles: both });
    const exam = await svc.create(u, 'c', { exam_style_ids: ['e1', 'e2'], count: 6, topics: ['BFS'] });
    await settle();
    expect(created(prisma)).toMatchObject({ styleId: 'e1', styleIds: ['e1', 'e2'], title: '2 geçmiş sınavdan yeni sınav', requested: 6 });
    expect(exam).toMatchObject({ style_id: 'e1', style_ids: ['e1', 'e2'] });
    expect(requests[0].styleHint).toContain('2 geçmiş sınav, toplam 6 soru;');
    expect(requests[0].styleHint).toContain(profile.sample_stems[0]);
    expect(requests[0].styleHint).toContain(midterm.sample_stems[0]);
  });

  test('a single style through exam_style_ids is the same as exam_style_id', async () => {
    const a = make(hang);
    const b = make(hang);
    await a.svc.create(u, 'c', { exam_style_id: 'e1', count: 4 });
    await b.svc.create(u, 'c', { exam_style_ids: ['e1'], count: 4 });
    await settle();
    const strip = (d: any) => ({ ...d, id: undefined });
    expect(strip(created(b.prisma))).toEqual(strip(created(a.prisma)));
    expect(b.requests[0].styleHint).toBe(a.requests[0].styleHint);
    expect(created(a.prisma).title).toBe('Final — yeni sınav');
  });

  test('a style of someone else among the selection is not found and nothing is created', async () => {
    const { svc, prisma } = make(hang, { styles: both });
    await expect(svc.create(u, 'c', { exam_style_ids: ['e1', 'theirs'], count: 3 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.generatedExam.create).not.toHaveBeenCalled();
  });

  test('without a count the exam has the average size of the selected exams', async () => {
    const { svc, prisma } = make(hang, { styles: both });
    await svc.create(u, 'c', { exam_style_ids: ['e1', 'e2'], topics: ['BFS'] }); // 4 and 2 questions
    expect(created(prisma).requested).toBe(3);
  });

  test.each([
    [{ exam_style_id: 'e1', exam_style_ids: ['e2'] }, 'birlikte gönderilemez'],
    [{}, 'En az bir geçmiş sınav'],
    [{ exam_style_ids: [] }, '1 ile 5 arasında'],
    [{ exam_style_ids: ['a', 'b', 'c', 'd', 'e', 'f'] }, '1 ile 5 arasında'],
    [{ exam_style_ids: ['e1', 'e1'] }, 'birden fazla kez'],
  ])('%j is a validation error', async (body, message) => {
    const { svc, prisma } = make(hang, { styles: both });
    await expect(svc.create(u, 'c', { count: 2, ...body })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining(message) });
    expect(prisma.examStyle.findMany).not.toHaveBeenCalled();
  });

  test('the legacy engine refuses several exams with a clear message and keeps a single one', async () => {
    const legacy = make(undefined, { styles: both, config: { quizEngine: 'legacy' } });
    (legacy.svc as any).learning = { start: jest.fn(hang) };
    await expect(legacy.svc.create(u, 'c', { exam_style_ids: ['e1', 'e2'], count: 2, topics: ['BFS'] }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: expect.stringContaining('yalnız yeni soru motoruyla') });
    await legacy.svc.create(u, 'c', { exam_style_ids: ['e2'], count: 2, topics: ['BFS'] });
    await new Promise((r) => setImmediate(r));
    expect((legacy.svc as any).learning.start.mock.calls[0][2]).toMatchObject({ exam_style_id: 'e2' });
    expect(legacy.generator.generate).not.toHaveBeenCalled();
  });

  test('older exams without styleIds report their one style', async () => {
    const { svc } = make();
    expect((svc as any).summary({ id: 'x', items: [], styleId: 'e1', styleIds: null })).toMatchObject({ style_ids: ['e1'] });
    expect((svc as any).summary({ id: 'x', items: [], styleId: null, styleIds: null })).toMatchObject({ style_ids: [] });
  });
});

describe('default exam size', () => {
  test('is the rounded average, kept within 1..20', () => {
    const p = (n: number) => ({ ...profile, question_count: n });
    expect(defaultExamCount([p(4), p(5)])).toBe(5);
    expect(defaultExamCount([p(30), p(40)])).toBe(EXAM_MAX_QUESTIONS);
    expect(defaultExamCount([p(0)])).toBe(1);
  });
});

// The legacy engine still grounds its topics with these (QUIZ_ENGINE=legacy).
describe('legacy helpers ported from origin/feature/quiz-quality-overhaul', () => {
  const SOURCES = [
    { title: 'Chapter_3', text: 'Transport vs. network layer services and protocols\ntransport layer: communication between processes' },
    { title: 'Chapter_3', text: 'TCP: overview\nreliable, in-order byte stream; TCP uses a three-way handshake' },
    { title: 'Chapter_6', text: 'Link layer: services\nframing, link access: encapsulate datagram into frame' },
    { title: 'Chapter_6', text: 'Chapter 6\n12' },
  ];
  test('keeps past-exam terms the sources contain, most frequent first, and drops the rest', () => {
    const { topics, dropped } = groundTopics(['puan', 'TCP', 'framing', 'Dijkstra'], SOURCES, 2);
    expect(topics.slice(0, 2)).toEqual(['TCP', 'framing']);
    expect(dropped).toEqual(['puan', 'Dijkstra']);
  });
  test('fills up with source headings when the past exam shares no words with the course', () => {
    const { topics } = groundTopics(['kalıtım', 'polimorfizm'], SOURCES, 5);
    expect(topics).toContain('Link layer: services');
    expect(topics).toContain('TCP: overview');
    expect(topics).not.toContain('Chapter 6');
    expect(new Set(topics).size).toBe(topics.length);
  });
  test('takes headings from every material in turn', () => {
    expect(groundTopics([], SOURCES, 2).topics.slice(0, 2)).toEqual(['Transport vs. network layer services and protocols', 'Link layer: services']);
  });
  test('names the reason most attempts failed with', () => {
    expect(commonReason([{ reason: 'a' }, { reason: 'b' }, { reason: 'b' }])).toEqual({ reason: 'b', count: 2 });
    expect(commonReason([])).toBeNull();
  });
  test('reworded copies are caught, different questions are not', () => {
    const q = 'Java’da bir sınıftan oluşturulan örneğe ne ad verilir?';
    expect(isDuplicateStem('Bir sınıftan oluşturulan örneğe Java’da ne ad verilir?', [q])).toBe(true);
    expect(isDuplicateStem('Polimorfizm çalışma zamanında hangi metodu seçer?', [q])).toBe(false);
    expect(isDuplicateStem('x', [])).toBe(false);
  });
});

describe('the generator refuses a repeated question before storing it', () => {
  test('a near copy of an earlier exam question is a DUPLICATE_STEM failure', async () => {
    const TEXT = 'BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır.';
    const q = { slot: 0, kind: 'OPEN', question: 'BFS bekleyen düğümleri hangi yapıda tutar, açıklayınız?', options: [], expected: '',
      quote: TEXT, source_index: 1, quality: { pipeline_version: 'single-call-v1', deterministic_validation: true } };
    const prisma = { learningQuiz: { create: jest.fn() } };
    const knowledge = { ask: jest.fn().mockResolvedValue({ evidence: [{ id: 's', text: TEXT }], video_learning: [] }), source: jest.fn() };
    const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { questions: [q], failures: [] } }) };
    const generator = new QuizGenerator(prisma as any, knowledge as any, ai as any);
    const r = await generator.generate(u, 'c', { topic: 'BFS', items: [{ kind: 'OPEN' }], budgetSeconds: 240,
      avoidStems: ['Bekleyen düğümleri BFS hangi yapıda tutar? Açıklayınız.'] });
    expect(r.failures[0].code).toBe('DUPLICATE_STEM');
    expect(prisma.learningQuiz.create).not.toHaveBeenCalled();
  });
});

void SEGMENTS;
