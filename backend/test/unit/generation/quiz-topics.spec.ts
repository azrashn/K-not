import { LearningService } from '../../../src/learning/learning.service';
import { buildPool } from '../../../src/learning/generation/source-pool';
import { cleanHeading, examTopics, heading, subjectLabel, suggestTopics, VERB_FORM } from '../../../src/learning/generation/topic-planner';
import type { PoolMaterial, PoolSegment } from '../../../src/learning/generation/source-pool';
import { fold } from '../../../src/learning/generation/roots';
import { knowledge as course, NOTES, SEGMENTS, SLIDES, VIDEO } from './java-course';

const u = { id: 'u', role: 'USER' } as any;
const service = (materials: any[], policy: 'documents_first' | 'never' = 'documents_first') => {
  const k = course(materials);
  const learning = new LearningService({} as any, { requireMember: jest.fn() } as any, k as any, {} as any, undefined,
    { quizEngine: 'v2', quizTranscriptPolicy: policy } as any);
  return { learning, k };
};

describe('topic suggestions for the quiz form (Azra: the raw video title filled the topic)', () => {
  test('headings first, then the subject words of the parts; never a file or video title', async () => {
    const { learning } = service([NOTES, SLIDES, VIDEO]);
    const { topics } = await learning.quizTopics(u, 'c');
    expect(topics[0]).toBe('Kapsülleme');
    expect(topics).toHaveLength(5);
    for (const t of topics) {
      expect(t.length).toBeLessThanOrEqual(60);
      expect(t).not.toMatch(/Dakikada|java-notlari|Nesneye yönelik programlama/);
      expect(t).not.toMatch(/Ceva|Neave|Intelijayda/); // the transcript is not read when documents exist
    }
    expect(new Set(topics.map((t) => t.toLocaleLowerCase('tr'))).size).toBe(topics.length);
  });

  test('a course without usable sources, or without a document under "never", gives no suggestions', async () => {
    expect(await service([]).learning.quizTopics(u, 'c')).toEqual({ topics: [] });
    expect(await service([VIDEO], 'never').learning.quizTopics(u, 'c')).toEqual({ topics: [] });
  });

  test('a course with only the video suggests from its transcript, but only a noun it repeats', async () => {
    // Each transcript part names "object" once: nothing to suggest (the form then offers the video's subject).
    expect((await service([VIDEO]).learning.quizTopics(u, 'c')).topics).toEqual([]);
    const segments = new Map([[VIDEO.id, [{ id: 'v9', text: 'Kalıtım ile alt sınıf üst sınıfın alanlarını devralır. Kalıtım kodu tekrar kullanmayı sağlar.', location: { kind: 'video', start_ms: 0 } }]]]);
    const k = course([VIDEO], segments);
    const learning = new LearningService({} as any, { requireMember: jest.fn() } as any, k as any, {} as any, undefined,
      { quizEngine: 'v2', quizTranscriptPolicy: 'documents_first' } as any);
    expect((await learning.quizTopics(u, 'c')).topics).toEqual(['Kalıtım']);
  });

  test('at most the asked number, and only as many labels as needed are computed', () => {
    const pool = buildPool([NOTES, SLIDES], SEGMENTS);
    expect(suggestTopics(pool, 2)).toEqual(['Kapsülleme', expect.any(String)]);
    expect(suggestTopics(pool, 0)).toEqual([]);
  });
});

/** Mac trial: a PDF of lecture notes with numbered sections, a page header on every page and pages that
 *  start in the middle of a sentence. The form showed "g, float, double, char ve", "verilere yalnızca
 *  metotlar aracılığıyla eri…" and "1 JAVA PROGRAMLAMA - VİZE SINAVI". */
const LECTURE: PoolMaterial = { id: 'pdf_java', kind: 'PDF', title: 'Java Programlama – Ders Notları', status: 'READY', version: 'v1' };
const HEADER = '1 JAVA PROGRAMLAMA - VİZE SINAVI';
const LECTURE_PAGES: PoolSegment[] = [
  { id: 'p1', text: `${HEADER}\nJava Programlama – Ders Notları\n3. Nesne Yönelimli Programlama\nNesne yönelimli programlamada veriler sınıfların içinde tutulur. Bir sınıfın alanları dışarıdan gizlenir. Nesneler birbirine mesaj gönderir.` },
  { id: 'p2', text: `${HEADER}\ng, float, double, char ve\nboolean türleri ilkel türlerdir. Bir int değişkeni 32 bit yer kaplar. Bir double değişkeni 64 bit yer kaplar.` },
  { id: 'p3', text: `${HEADER}\nverilere yalnızca metotlar aracılığıyla eri…\nKapsülleme sayesinde alanlar korunur. Erişim belirleyicileri görünürlüğü ayarlar. Bu yapı hataları azaltır.` },
  { id: 'p4', text: `${HEADER}\n4. Veri Tipleri\nProgramlarda int, long, float, double, char ve boolean ilkel veri tipleri kullanılır. Her tipin sabit bir boyutu vardır. String bir ilkel tip değildir.` },
  { id: 'p5', text: `${HEADER}\nverilere yalnızca metotlar aracılığıyla eri-\nşilir. Getter ve setter metotları alanlara güvenli erişim sağlar. Alanlar genellikle private tanımlanır.` },
];
const lecturePool = () => buildPool([LECTURE], new Map([[LECTURE.id, LECTURE_PAGES]]));

describe('topic suggestions come from the section headings, cleaned (Mac trial)', () => {
  test('numbered headings, without their number, in sentence case', () => {
    const topics = suggestTopics(lecturePool());
    expect(topics.slice(0, 2)).toEqual(['Nesne yönelimli programlama', 'Veri tipleri']);
  });

  test('never a piece of a sentence, a page header, boilerplate or the document title', () => {
    const topics = suggestTopics(lecturePool());
    expect(topics.length).toBeGreaterThan(0);
    for (const t of topics) {
      expect(t).not.toMatch(/^\p{Ll}/u); // starts like a sentence continued from the page before
      expect(t).not.toMatch(/(…|\.\.\.|-)$/u); // a cut word
      expect(t).not.toMatch(/\s(ve|ile|veya)$/iu);
      expect(t).not.toMatch(/VİZE|SINAV|Ders Notları|^\d/u);
      expect(t.toLocaleLowerCase('tr')).not.toBe('java programlama');
    }
  });

  test('the exam topic planner uses the same headings', () => {
    const labels = examTopics([], lecturePool()).map((t) => t.label);
    expect(labels).toEqual(expect.arrayContaining(['Nesne yönelimli programlama', 'Veri tipleri']));
    for (const l of labels) expect(l).not.toMatch(/^\p{Ll}|…$|-$|\s(ve|ile)$|VİZE|^\d/u);
  });

  test.each([
    ['4. Veri Tipleri', 'Veri tipleri'],
    ['3.1 Sınıflar ve Nesneler', 'Sınıflar ve nesneler'],
    ['NESNE YÖNELİMLİ PROGRAMLAMA', 'Nesne yönelimli programlama'],
    ['2) JVM Mimarisi', 'JVM mimarisi'],
    ['Kapsülleme', 'Kapsülleme'],
  ])('%s → %s', (line, clean) => expect(cleanHeading(line)).toBe(clean));

  test.each([
    'g, float, double, char ve',
    'verilere yalnızca metotlar aracılığıyla eri…',
    'verilere yalnızca metotlar aracılığıyla eri-',
    '1 JAVA PROGRAMLAMA - VİZE SINAVI',
    'Final Sınavı',
    'Java platform bağımsızdır',
  ])('refused: %s', (line) => expect(cleanHeading(line)).toBeNull());

  test('the document name is not a topic; a name the text writes with a capital keeps it', () => {
    expect(cleanHeading('Java Programlama', { title: 'Java Programlama – Ders Notları' })).toBeNull();
    expect(cleanHeading('Java Sanal Makinesi', { text: 'Kod derlendikten sonra Java bytecode çalışır.' })).toBe('Java sanal makinesi');
    expect(heading('Kapsülleme\nVeri gizlenir.')).toBe('Kapsülleme');
  });
});

/** Windows trial: a document without numbered headings gave "çevrilir", "collector", "çalışabilmesinin". */
describe('suggestions without headings: a noun or noun phrase the part repeats, else nothing', () => {
  test.each([
    'çevrilir', 'alınır', 'çalışır', 'çalışabilmesinin', 'derlenmesi', 'programlamasının', 'kullanarak', 'kullanılan',
    'tanımlanan', 'geliyor', 'derlemek', 'yapamaz', 'nesnedir', 'basittir',
  ])('%s is a verb form', (w) => expect(VERB_FORM.test(fold(w))).toBe(true));

  test.each(['durum', 'değer', 'satır', 'kültür', 'yumuşak', 'grup', 'sınıf', 'kalıtım', 'derleyici', 'bytecode', 'collector'])(
    '%s is not', (w) => expect(VERB_FORM.test(fold(w))).toBe(false),
  );

  test('a phrase the noun stands in is named whole ("Garbage collector", not "collector")', () => {
    const text = 'Garbage collector kullanılmayan nesneleri siler. Java sanal makinesinde garbage collector arka planda çalışır.';
    expect(subjectLabel(text)).toBe('Garbage collector');
  });

  test('only verbs, function words and words met once: no label, and no suggestion', () => {
    const text = 'Kaynak kod derleyici tarafından çevrilir ve çalışabilmesinin koşulları sağlanır. There is also more.';
    expect(subjectLabel(text)).toBeNull();
    const pool = buildPool([NOTES], new Map([[NOTES.id, [{ id: 'x1', text }]]]));
    expect(suggestTopics(pool)).toEqual([]);
  });

  test('no suggestion is ever a verb form or a function word', () => {
    const pool = buildPool([NOTES, SLIDES], SEGMENTS);
    for (const t of suggestTopics(pool)) {
      for (const w of t.split(/\s+/)) expect(VERB_FORM.test(fold(w))).toBe(false);
      expect(t).not.toMatch(/^(The|There|Also|Ve|İle|Için|Gibi)\b/u);
    }
  });
});
