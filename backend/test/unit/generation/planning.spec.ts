import { buildPool } from '../../../src/learning/generation/source-pool';
import {
  examTopics, heading, partLabel, quizTopic, rankParts, TOPIC_NOT_IN_DOCUMENTS, TOPIC_NOT_IN_SOURCES,
} from '../../../src/learning/generation/topic-planner';
import { capacityNote, examItems, MIXED_ORDER, planQuestions, quizItems } from '../../../src/learning/generation/question-plan';
import { isDuplicateStem, quoteKey, RepeatGuard } from '../../../src/learning/generation/repeat-guard';
import { sameRoot } from '../../../src/learning/generation/roots';
import { buildExamProfile } from '../../../src/learning/exam-style';
import { NOTES, SEGMENTS, SLIDES } from './java-course';

const pool = buildPool([NOTES], SEGMENTS);
const ids = (parts: { key: string }[]) => parts.map((p) => p.key);

describe('quiz topic: the parts that are about it', () => {
  test('parts holding the topic word (by root) come first, the most hits first', () => {
    expect(ids(rankParts('kalıtım', pool.parts))).toEqual(['n2', 'n3']);
    expect(ids(rankParts('Çöp toplayıcı ve bellek', pool.parts))).toEqual(['n4']);
  });

  test('a part a search returned counts even without a shared word', () => {
    expect(ids(rankParts('garbage collection', pool.parts, ['n4']))).toEqual(['n4']);
  });

  test('a topic only the transcript mentions: the hint to choose the video', () => {
    expect(() => quizTopic('Intelijayda derleicisi', { ...pool, transcriptsLeftOut: true })).toThrow(TOPIC_NOT_IN_DOCUMENTS);
    expect(() => quizTopic('Python listeleri', { ...pool, transcriptsLeftOut: false })).toThrow(TOPIC_NOT_IN_SOURCES);
  });

  test('the label is the topic as written', () => {
    expect(quizTopic('  final anahtar sözcüğü ', pool)).toMatchObject({ label: 'final anahtar sözcüğü' });
  });
});

describe('a chosen quiz topic stays inside its sections ("Veri tipleri" gave inheritance and Java history)', () => {
  const BOOK = { id: 'pdf_java', kind: 'PDF', title: 'Java programlama', status: 'READY', version: 'v1' };
  const pages = [
    { id: 'p1', text: '1. Java Tarihçesi\nJava 1995 yılında Sun Microsystems tarafından geliştirildi. İlk sürümü 1996 yılında yayımlandı.', location: { kind: 'page', page: 1 } },
    { id: 'p2', text: '2. Veri Tipleri\nJava dilinde veri tipleri ilkel ve referans olarak ikiye ayrılır. İlkel veri tipleri sekiz tanedir.', location: { kind: 'page', page: 2 } },
    { id: 'p3', text: 'int tamsayıları dört baytta tutar. double ondalıklı sayıları sekiz baytta tutar. boolean yalnızca true ya da false değerini alır.', location: { kind: 'page', page: 3 } },
    { id: 'p4', text: '3. Kalıtım\nKalıtım bir sınıfın başka bir sınıfın özelliklerini devralmasıdır. Alt sınıf üst sınıfın metotlarını kullanır.', location: { kind: 'page', page: 4 } },
  ];
  const book = buildPool([BOOK], new Map([[BOOK.id, pages]]));
  // The search returns its top hits whatever they are about.
  const searched = ['p4', 'p1', 'p2', 'p3'];

  test('only the section of the topic, also its following page without the words; search hits elsewhere are left out', () => {
    expect(ids(quizTopic('Veri tipleri', book, searched).parts)).toEqual(['p2', 'p3']);
  });

  test('3 questions over a section that carries 2: two are planned and the existing note says so', () => {
    const plan = planQuestions(quizItems('MULTIPLE_CHOICE', 3), [quizTopic('Veri tipleri', book, searched)], true);
    expect(plan.slots.map((s) => s.part.key)).toEqual(['p2', 'p3']);
    expect(plan.note).toBe('Bu konu için kaynaklar yaklaşık 2 soruya yetiyor; 3 soru istendi.');
    expect(plan.spare).toEqual([]); // a retry does not go to another section either
  });

  test('a part holding only one common word of a two-word topic is not part of it when another holds both', () => {
    const extra = buildPool([BOOK], new Map([[BOOK.id, [...pages, { id: 'p5', text: 'Kapsülleme veri gizlemedir. Alanlara metotlar üzerinden erişilir.', location: { kind: 'page', page: 5 } }]]]));
    expect(ids(quizTopic('Veri tipleri', extra, [...searched, 'p5']).parts)).not.toContain('p5');
  });

  test('a topic in other words (no part holds them) still uses what the search found', () => {
    expect(ids(quizTopic('data types', book, ['p2']).parts)).toEqual(['p2']);
  });
});

describe('exam topics (Azra: one topic "object" for a whole exam)', () => {
  test('past-exam terms the notes hold come first; terms they lack and question words are left out', () => {
    const topics = examTopics(['object', 'hangi', 'kalıtım', 'bellek'], pool);
    expect(topics.slice(0, 2).map((t) => t.label)).toEqual(['kalıtım', 'bellek']);
    expect(topics.map((t) => t.label)).not.toContain('object');
    expect(topics.map((t) => t.label)).not.toContain('hangi');
  });

  test('every part of the notes becomes reachable through some topic', () => {
    const topics = examTopics(['object'], pool);
    const reached = new Set(topics.flatMap((t) => t.parts.map((p) => p.key)));
    expect(reached).toEqual(new Set(['n1', 'n2', 'n3', 'n4', 'n5']));
    expect(topics.length).toBe(5);
    expect(new Set(topics.map((t) => t.label)).size).toBe(topics.length);
  });

  test('terms shared by more past exams come first', () => {
    const topics = examTopics(['kalıtım', 'bellek'], pool, { bellek: 2, 'kalıtım': 1 });
    expect(topics.slice(0, 2).map((t) => t.label)).toEqual(['bellek', 'kalıtım']);
  });

  test('a slide heading is its own topic', () => {
    const topics = examTopics([], buildPool([SLIDES], SEGMENTS));
    expect(topics).toEqual([expect.objectContaining({ label: 'Kapsülleme' })]);
  });

  test('labels: a heading, else the most frequent subject words, never a sentence', () => {
    expect(heading('Kapsülleme\nVeri gizlenir.')).toBe('Kapsülleme');
    expect(heading('Java bir dildir.')).toBeNull();
    expect(partLabel(pool.parts[2].text)).toBe('Final'); // final ×3; no phrase holds it twice
    expect(partLabel(pool.parts[3].text)).toMatch(/^Nesne|^Bellek/);
  });
});

describe('question plan', () => {
  const topics = examTopics(['object'], pool);

  test('Azra: 14 questions over notes that carry 6 are planned as 6 and the note says so', () => {
    const plan = planQuestions(quizItems('MULTIPLE_CHOICE', 10).concat(quizItems('OPEN', 4)), topics);
    expect(plan.slots).toHaveLength(6);
    expect(plan.requested).toBe(14);
    expect(plan.note).toBe('Kaynaklar yaklaşık 6 soruya yetiyor; 14 soru istendi.');
    const uses = new Map<string, number>();
    for (const s of plan.slots) uses.set(s.part.key, (uses.get(s.part.key) ?? 0) + 1);
    expect(uses.get('n4')).toBe(2); // the only part with capacity 2
    for (const [key, n] of uses) expect(n).toBeLessThanOrEqual(pool.parts.find((p) => p.key === key)!.capacity);
    expect(plan.spare).toEqual([]);
  });

  test('every part is used once before any part is used twice', () => {
    const plan = planQuestions(quizItems('TRUE_FALSE', 5), topics);
    expect(new Set(plan.slots.map((s) => s.part.key)).size).toBe(5);
    expect(plan.note).toBeNull();
    expect(plan.spare.map((s) => s.part.key)).toEqual(['n4']);
  });

  test('a calculation goes to a part with numbers (not a lone year) when there is one', () => {
    const plan = planQuestions([{ kind: 'SHORT_ANSWER', variant: 'CALCULATION' }], topics);
    expect(plan.slots[0]).toMatchObject({ kind: 'SHORT_ANSWER', variant: 'CALCULATION' });
    expect(plan.slots[0].part.key).toBe('n5'); // n1 has only the year 1995
  });

  test('a quiz topic with fewer parts than questions says so for the topic', () => {
    const plan = planQuestions(quizItems('OPEN', 4), [quizTopic('kalıtım', pool)], true);
    expect(plan.slots.map((s) => s.part.key)).toEqual(['n2', 'n3']);
    expect(plan.note).toBe('Bu konu için kaynaklar yaklaşık 2 soruya yetiyor; 4 soru istendi.');
  });

  test('the exam plan keeps the past exam mix of kinds', () => {
    const profile = buildExamProfile(['1. Hangisi doğrudur?', 'A) a', 'B) b', 'C) c', '2. Açıklayınız: kalıtım nedir?'].join('\n'));
    const plan = planQuestions(examItems(profile, 4), topics);
    expect(plan.slots.map((s) => s.kind).sort()).toEqual(['MULTIPLE_CHOICE', 'MULTIPLE_CHOICE', 'OPEN', 'OPEN']);
    const calculation = buildExamProfile(['1. Hızı hesaplayınız.', '2. Süreyi hesaplayınız.'].join('\n'));
    expect(planQuestions(examItems(calculation, 1), topics).slots[0])
      .toMatchObject({ kind: 'SHORT_ANSWER', variant: 'CALCULATION' });
  });

  test('capacity note only when fewer are planned', () => {
    expect(capacityNote(5, 5)).toBeNull();
    expect(capacityNote(3, 7)).toBe('Kaynaklar yaklaşık 3 soruya yetiyor; 7 soru istendi.');
  });
});

describe('quiz items', () => {
  test('one kind, 1 to 15 questions', () => {
    expect(quizItems('CLOZE', 3)).toEqual([{ kind: 'CLOZE' }, { kind: 'CLOZE' }, { kind: 'CLOZE' }]);
    for (const bad of [0, 16, 2.5, NaN]) expect(() => quizItems('OPEN', bad)).toThrow('1 ile 15');
  });

  test('"Karışık" takes the kinds in turn', () => {
    expect(quizItems('MIXED', 7).map((i) => i.kind)).toEqual([...MIXED_ORDER, ...MIXED_ORDER.slice(0, 2)]);
  });

  test('an unknown kind is refused', () => expect(() => quizItems('ESSAY' as any, 2)).toThrow('Bilinmeyen'));
});

describe('repeat guard (Azra: "açalım/açmak", "sürecinde/sürecinin")', () => {
  test.each([['açalım', 'açmak'], ['sürecinde', 'sürecinin'], ['bellek', 'belleği'], ['kuyruk', 'kuyruğu'], ['ağaç', 'ağacı']])(
    '%s and %s share a root', (a, b) => expect(sameRoot(a, b) && sameRoot(b, a)).toBe(true),
  );
  test.each([['dizi', 'dizin'], ['açık', 'açmak'], ['veri', 'verim'], ['açalım', 'açı']])(
    '%s and %s are different words', (a, b) => expect(sameRoot(a, b)).toBe(false),
  );

  test('stems that differ only in suffixes are repeats', () => {
    expect(isDuplicateStem('Java dosyasını nasıl açalım?', ['Java dosyasını açmak için ne yapılır?'])).toBe(true);
    expect(isDuplicateStem('Derleme sürecinde hangi araç kullanılır?', ['Derleme sürecinin hangi aracı kullanılır?'])).toBe(true);
    expect(isDuplicateStem('Derleme sürecinde hangi araç kullanılır?', ['Çöp toplayıcı belleği ne zaman boşaltır?'])).toBe(false);
  });

  test('a used sentence is recognised whatever its case, spacing or final period', () => {
    const guard = new RepeatGuard({ quotes: ['Bytecode, JVM üzerinde çalışır.'] });
    expect(guard.isUsedQuote('  bytecode, jvm üzerinde   çalışır')).toBe(true);
    expect(guard.isUsedQuote('JVM bytecode çalıştırır.')).toBe(false);
    expect(quoteKey('Kalıtım VARDIR.')).toBe('kalitim vardir');
  });

  test('accepted questions are remembered and sent within the request limits', () => {
    const guard = new RepeatGuard();
    for (let i = 0; i < 70; i++) guard.accept(`Soru ${i} hakkında ne söylenir?`, `Kaynak cümlesi numara ${i}.`);
    expect(guard.avoidStems()).toHaveLength(10);
    expect(guard.avoidStems().at(-1)).toBe('Soru 69 hakkında ne söylenir?');
    expect(guard.avoidQuotes()).toHaveLength(60);
    guard.accept('Kalıtım nedir?', 'Kaynak cümlesi numara 69.'); // the same sentence is not stored twice
    expect(guard.avoidQuotes()).toHaveLength(60);
    expect(guard.isRepeat('Kalıtım nedir ve ne işe yarar?')).toBe(true);
  });
});
