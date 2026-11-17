import { boardSteps, clip, clock, evidenceSteps, quoteIn, sanitizeSteps, sentences, shortPhrase, topicWords } from '../../src/board/steps';

const ev = [
  { source: 'a'.repeat(64), n: 1, text: 'Buharlaşma sıvı suyu buhara dönüştürür. Isı gerekir.' },
  { source: 'b'.repeat(64), n: 2, text: 'Yoğuşma buharı yeniden suya çevirir.' },
];
const modelStep = (over: Record<string, unknown> = {}) => ({
  board: 'Su → buhar', speech: 'Isınan su buhara dönüşür.', formula: null, mark: 'underline',
  sources: ['a'.repeat(64)], source_ids: [1], quote: 'sıvı suyu buhara', ...over,
});

describe('model steps are checked again against this answer', () => {
  test('valid step keeps its fields; ids follow the evidence, not the model', () => {
    expect(sanitizeSteps([modelStep({ source_ids: [9] })], ev)).toEqual([{
      board: 'Su → buhar', speech: 'Isınan su buhara dönüşür.', formula: null, mark: 'underline',
      sources: ['a'.repeat(64)], source_ids: [1], quote: 'sıvı suyu buhara',
    }]);
  });
  test('a step without a source of this answer is dropped', () => {
    expect(sanitizeSteps([modelStep({ sources: ['foreign'] }), modelStep({ sources: [] }), modelStep({ board: 'İkinci', sources: ['b'.repeat(64)], quote: '' })], ev)
      .map(s => s.board)).toEqual(['İkinci']);
  });
  test('broken shapes are dropped, an invented quote is removed', () => {
    expect(sanitizeSteps([null, 'x', modelStep({ board: '' }), modelStep({ speech: 'x'.repeat(2000) })], ev)).toEqual([]);
    const [step] = sanitizeSteps([modelStep({ quote: 'kaynakta olmayan cümle', mark: 'glow', formula: '  ' })], ev);
    expect(step.quote).toBeUndefined();
    expect(step.mark).toBeNull();
    expect(step.formula).toBeNull();
    expect(sanitizeSteps('nope', ev)).toEqual([]);
  });
  test('quotes match regardless of case, spacing and Turkish i', () => {
    expect(quoteIn('SIVI  SUYU', [ev[0].text])).toBe(true);
    expect(quoteIn('yoğuşma', [ev[0].text])).toBe(false);
  });
});

const java = {
  source: 'j'.repeat(64), n: 1, order: [0, 0, 0, 0, 0],
  text: "Java 1990'ların başında Sun Microsystems tarafından geliştirildi. Dil bugün de yaygın olarak kullanılıyor.\n"
    + 'Bir Java kodu önce javac ile derlenir. Derlenen sınıf java komutu ile çalıştırılır. Bu kadar.',
};
const asked = (question: string, answer = '') => ({ question, answer });

describe('evidence sentences', () => {
  test('split at sentence ends and sentence-like new lines, not at abbreviations, decimals or wrapped lines', () => {
    expect(sentences('Pi 3.14 olarak alınır. Örn. bu değer vb. yerlerde geçer! Yeni cümle?').map(s => s.text))
      .toEqual(['Pi 3.14 olarak alınır.', 'Örn. bu değer vb. yerlerde geçer!', 'Yeni cümle?']);
    expect(sentences('Başlık\nİlk cümle burada\nsatıra taştı.').map(s => s.text)).toEqual(['Başlık', 'İlk cümle burada satıra taştı.']);
    const text = 'Bir.  İki   üç.';
    for (const s of sentences(text)) expect(text.slice(s.offset).replace(/\s+/g, ' ').trim().startsWith(s.text)).toBe(true);
  });
  test('topic words drop citation labels and stopwords and fold Turkish i', () => {
    expect(topicWords('Java kodu nasıl ÇALIŞTIRILIR? [2]')).toEqual(['java', 'kodu', 'çaliştirilir']);
  });
  test('long sentences are cut at a word, still a verbatim part', () => {
    const long = 'kelime '.repeat(80).trim();
    expect(long.startsWith(clip(long))).toBe(true);
    expect(clip(long).length).toBeLessThanOrEqual(280);
    expect(shortPhrase('bir iki üç dört beş altı yedi sekiz dokuz.')).toBe('bir iki üç dört beş altı yedi…');
  });
});

describe('evidence steps say only what the evidence says, about the question', () => {
  test('the sentences that answer the question, not the history sentence that only says "Java"', () => {
    const steps = evidenceSteps([java], asked('Java kodu nasıl çalıştırılır?'));
    // "Java" is in 3 of the 5 sentences: it does not count, so the history sentence scores 0.
    expect(steps.map(s => s.speech)).toEqual(['Bir Java kodu önce javac ile derlenir.', 'Derlenen sınıf java komutu ile çalıştırılır.']);
    expect(steps.map(s => s.speech).join(' ')).not.toContain('1990');
    expect(steps[0]).toEqual({ board: 'Bir Java kodu önce javac ile derlenir', speech: 'Bir Java kodu önce javac ile derlenir.',
      formula: null, mark: null, sources: [java.source], source_ids: [1], quote: 'Bir Java kodu önce javac ile derlenir.' });
    for (const s of steps) expect(java.text.replace(/\s+/g, ' ')).toContain(s.quote);
  });
  test('a word in more than half of the sentences counts only below 3 sentences', () => {
    const two = { source: 's', n: 1, text: 'Java kodu javac ile derlenir. Java sınıfı komutla çalışır.' };
    expect(evidenceSteps([two], asked('Java'))).toHaveLength(2);
    const three = { ...two, text: two.text + ' Java nesne yönelimli bir dildir. Hava bugün çok güzel görünüyor.' };
    // "Java" is in 3 of 4 sentences; "derlenir" is not common and alone decides.
    expect(evidenceSteps([three], asked('Java derlenir mi?')).map(s => s.speech)).toEqual(['Java kodu javac ile derlenir.']);
  });
  test('when only common words match, they count after all, still with the half-score cut', () => {
    const at = (n: number, ms: number, text: string) => ({ source: clock(ms), n, text, order: [ms] });
    const lecture = [at(1, 30000, 'Dijkstra algoritması en kısa yolları bulur.'), at(2, 10000, 'Dijkstra bir öncelik kuyruğu kullanır.'),
      at(3, 50000, 'Dijkstra algoritması negatif kenarlarla çalışmaz.'), at(4, 70000, 'Bugün hava çok güzel görünüyor.')];
    // "Dijkstra" (3 of 4) and "algoritması" (2 of 4, not common) — first pass: algoritması alone.
    expect(evidenceSteps(lecture, asked('Dijkstra algoritması')).map(s => s.sources[0])).toEqual(['00:30', '00:50']);
    // "Dijkstra nedir?": only the common word matches → second pass, every Dijkstra sentence, in time order.
    expect(evidenceSteps(lecture, asked('Dijkstra nedir?')).map(s => s.sources[0])).toEqual(['00:10', '00:30', '00:50']);
    // A non-common answer word already scores in the first pass: no second pass, the common word stays out.
    expect(evidenceSteps(lecture, asked('Dijkstra nedir?', 'Kuyruk kullanır.')).map(s => s.sources[0])).toEqual(['00:10']);
    // Second pass keeps the half-score cut: "Dijkstra" and "graf" are both common; question + answer (3)
    // keeps the Dijkstra sentences, the answer-only graph sentence (1) is dropped.
    const graph = [at(1, 10000, 'Dijkstra graf üzerinde en kısa yolu bulur.'), at(2, 20000, 'Dijkstra graf kenarlarını tek tek gezer.'),
      at(3, 30000, 'Dijkstra graf düğümlerini kuyruğa koyar.'), at(4, 40000, 'Graf düğümleri derste ayrıntılı çizildi.'),
      at(5, 50000, 'Bugün hava çok güzel görünüyor.')];
    expect(evidenceSteps(graph, asked('Dijkstra nedir?', 'Graf')).map(s => s.sources[0])).toEqual(['00:10', '00:20', '00:30']);
  });
  test('the Java history sentence stays out: the first pass already found the answer', () => {
    expect(evidenceSteps([java], asked('Java nedir, kodu nasıl çalıştırılır?')).map(s => s.speech).join(' ')).not.toContain('1990');
  });
  test('the written answer counts too, a question word twice as much; under half the best score is dropped', () => {
    const text = 'Defter masanın üstünde durur. Defter rafın içinde bekler. Lamba masanın yanında yanar. '
      + 'Kapı sabah erkenden açılır. Pencere akşam geç kapanır. Halı yerde sessizce yatar.';
    const e = [{ source: 's', n: 1, text }];
    // 3 (question + answer), 2 (question), 1 (answer: under 3 / 2, dropped).
    expect(evidenceSteps(e, asked('Defter', 'Masa')).map(s => s.speech)).toEqual(['Defter masanın üstünde durur.', 'Defter rafın içinde bekler.']);
    expect(evidenceSteps(e, asked('Işık', 'Lamba')).map(s => s.speech)).toEqual(['Lamba masanın yanında yanar.']);
  });
  test('at most 5, chosen by score, shown in document order', () => {
    const text = [
      ...[0, 1, 2, 3, 4, 5].map(i => `Adım ${i} javac kullanır.`),
      ...[0, 1].map(j => `Son ${j} adımda javac derleyicisini çağırır.`),
      ...Array.from({ length: 9 }, (_, k) => `Not ${k} başka konudan bahseder.`),
    ].join(' ');
    const steps = evidenceSteps([{ source: 's', n: 1, text }], asked('javac derleyicisini'));
    expect(steps.map(s => s.speech)).toEqual(['Adım 0 javac kullanır.', 'Adım 1 javac kullanır.', 'Adım 2 javac kullanır.',
      'Son 0 adımda javac derleyicisini çağırır.', 'Son 1 adımda javac derleyicisini çağırır.']);
  });
  test('documents follow material, page and offset; video follows time, not relevance', () => {
    const page = (n: number, p: number, text: string) => ({ source: `p${p}`, n, text, order: [0, p, 0, 0, 0] });
    expect(evidenceSteps([page(1, 5, 'Sonra çıkan buhar soğuyarak yoğuşur.'), page(2, 2, 'Önce su ısıtılır ve buhar oluşur.')], asked('buhar'))
      .map(s => s.sources[0])).toEqual(['p2', 'p5']);
    const at = (n: number, ms: number, text: string) => ({ source: clock(ms), n, text, order: [ms] });
    const video = [at(1, 23000, 'Cava. Dijkstra algoritması en kısa yolu bulur. Ders burada kısa bir ara verdi.'),
      at(2, 88000, 'Dijkstra kenar ağırlıkları negatif olmamalı der. Sonraki konu ağaç yapıları olacak.'),
      at(3, 44000, 'Dijkstra başlangıçta kaynağın uzaklığını sıfır yapar. Öğrenciler not almaya devam etti.')];
    const steps = evidenceSteps(video, asked('Dijkstra algoritması nasıl çalışır?'));
    expect(steps.map(s => s.sources[0])).toEqual(['00:23', '00:44', '01:28']);
    expect(steps.map(s => s.speech)).not.toContain('Cava.');
  });
  test('short sentences, repeats and overlapping chunks are left out', () => {
    const a = { source: 'a', n: 1, text: 'Java derlenir. Java kodu javac ile derlenir.' };
    const b = { source: 'b', n: 2, text: 'kodu javac ile derlenir. Önce Java kodu javac ile derlenir. Hava bugün çok güzel görünüyor. Akşam yağmur yağabilir diyorlar.' };
    expect(evidenceSteps([a, b], asked('kodu')).map(s => s.speech)).toEqual(['Java kodu javac ile derlenir.']);
  });
  test('nothing shares a word with the question: no steps', () => {
    expect(evidenceSteps([java], asked('Python listesi'))).toEqual([]);
    expect(evidenceSteps([{ source: 'c', n: 1, text: '  ' }], asked('Java'))).toEqual([]);
  });
});

describe('which steps an answer gets', () => {
  const q = asked('Sıvı su buhara nasıl dönüşür?');
  test('model steps win when valid', () => {
    expect(boardSteps(true, ev, q, { steps: [modelStep()], steps_status: 'REPAIRED' }).steps_status).toBe('REPAIRED');
  });
  test.each([
    [undefined], [{ steps: [], steps_status: 'INVALID' }], [{ steps: [], steps_status: 'FAILED' }],
    [{ steps: [modelStep({ sources: ['foreign'] })], steps_status: 'MODEL' }],
  ])('no model, failed, timed out or ungrounded model steps → evidence steps (%j)', (generated) => {
    const r = boardSteps(true, ev, q, generated);
    expect(r.steps_status).toBe('EVIDENCE');
    expect(r.steps).toEqual(evidenceSteps(ev, q));
    // "buhar" is in 2 of the 3 sentences and does not count; "Isı gerekir." is under 4 words.
    expect(r.steps.map(s => s.speech)).toEqual(['Buharlaşma sıvı suyu buhara dönüştürür.']);
  });
  test('answers that explain nothing, or evidence that does not match, get no steps', () => {
    expect(boardSteps(false, ev, q, { steps: [modelStep()], steps_status: 'MODEL' })).toEqual({ steps: [], steps_status: 'NONE' });
    expect(boardSteps(true, [], q)).toEqual({ steps: [], steps_status: 'NONE' });
    expect(boardSteps(true, ev, asked('Fotosentez'), { steps: [], steps_status: 'FAILED' })).toEqual({ steps: [], steps_status: 'NONE' });
  });
});

test('video moments use the clock the frontend matches', () => {
  expect(clock(434000)).toBe('07:14');
  expect(clock(3723000)).toBe('1:02:03');
});
