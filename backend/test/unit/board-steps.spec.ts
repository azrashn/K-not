import { boardSteps, clock, evidenceSteps, firstSentence, quoteIn, sanitizeSteps, shortPhrase } from '../../src/board/steps';

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

describe('evidence steps say only what the evidence says', () => {
  test('one step per evidence sentence, verbatim speech and quote', () => {
    expect(evidenceSteps(ev)).toEqual([
      { board: 'Buharlaşma sıvı suyu buhara dönüştürür', speech: 'Buharlaşma sıvı suyu buhara dönüştürür.', formula: null, mark: null,
        sources: ['a'.repeat(64)], source_ids: [1], quote: 'Buharlaşma sıvı suyu buhara dönüştürür.' },
      { board: 'Yoğuşma buharı yeniden suya çevirir', speech: 'Yoğuşma buharı yeniden suya çevirir.', formula: null, mark: null,
        sources: ['b'.repeat(64)], source_ids: [2], quote: 'Yoğuşma buharı yeniden suya çevirir.' },
    ]);
    for (const step of evidenceSteps(ev)) expect(ev.some(e => e.text.includes(step.speech))).toBe(true);
  });
  test('long text is cut at a word, still a verbatim part; duplicates and empty text are skipped', () => {
    const long = 'kelime '.repeat(80).trim();
    expect(long.startsWith(firstSentence(long))).toBe(true);
    expect(firstSentence(long).length).toBeLessThanOrEqual(280);
    expect(shortPhrase('bir iki üç dört beş altı yedi sekiz dokuz.')).toBe('bir iki üç dört beş altı yedi…');
    expect(evidenceSteps([...ev, { ...ev[0], n: 3 }, { source: 'c', n: 4, text: '  ' }])).toHaveLength(2);
    expect(evidenceSteps(Array.from({ length: 9 }, (_, i) => ({ source: `s${i}`, n: i + 1, text: `Cümle ${i}.` })))).toHaveLength(6);
  });
});

describe('which steps an answer gets', () => {
  test('model steps win when valid', () => {
    expect(boardSteps(true, ev, { steps: [modelStep()], steps_status: 'REPAIRED' }).steps_status).toBe('REPAIRED');
  });
  test.each([
    [undefined], [{ steps: [], steps_status: 'INVALID' }], [{ steps: [], steps_status: 'FAILED' }],
    [{ steps: [modelStep({ sources: ['foreign'] })], steps_status: 'MODEL' }],
  ])('no model, failed, timed out or ungrounded model steps → evidence steps (%j)', (generated) => {
    const r = boardSteps(true, ev, generated);
    expect(r.steps_status).toBe('EVIDENCE');
    expect(r.steps).toEqual(evidenceSteps(ev));
  });
  test('answers that explain nothing get no steps', () => {
    expect(boardSteps(false, ev, { steps: [modelStep()], steps_status: 'MODEL' })).toEqual({ steps: [], steps_status: 'NONE' });
    expect(boardSteps(true, [])).toEqual({ steps: [], steps_status: 'NONE' });
  });
});

test('video moments use the clock the frontend matches', () => {
  expect(clock(434000)).toBe('07:14');
  expect(clock(3723000)).toBe('1:02:03');
});
