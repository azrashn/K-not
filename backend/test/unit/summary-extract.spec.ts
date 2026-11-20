import { KnowledgeService } from '../../src/knowledge/knowledge.service';
import {
  cleanVocabulary, extractConcepts, extractPoints, extractSummary, keyTerms, readableUnit, repairLabel, selectKeyPages, slideUnits,
} from '../../src/knowledge/summary-extract';

const page = (n: number, text: string) => ({ id: `s${n}`.padEnd(64, '0'), text, location: { kind: 'page', page: n } });

/** A small deck: titles, bullets that wrap over lines, a damaged ligature, repeated footers. */
const TOPICS = ['Congestion control', 'Flow control', 'Reliable data transfer', 'Connection management', 'Round trip time', 'Selective repeat', 'Go back N', 'Slow start'];
const deck = Array.from({ length: 48 }, (_, i) => {
  const n = i + 1;
  const topic = TOPICS[i % TOPICS.length];
  return page(n, [
    `${topic}: details`,
    `§${topic} is a mechanism that lets the sender number ${n} adapt its sending rate`,
    `§the receiver acknowledges every segment it gets correctly on path ${n}`,
    `•TCP uses ${topic.toLowerCase()} to avoid overwhelming the network ${n}`,
    i % 4 === 0 ? `•when conges$on appears the sender slows down ${n}` : `•slow start doubles the window every round trip ${n}`,
    `Transport Layer: 3-${n}`,
  ].join(String.fromCharCode(10)));
});

test('a bullet that wraps over lines is one unit; a new statement starting upper case is its own', () => {
  const units = slideUnits('Title here\n§to send the request,\nclient first opens a socket\nto the web server\n§TCP SYN segment\nEthernet frames carry 1500 bytes.').map((u) => u.text);
  expect(units).toEqual(['Title here', 'to send the request, client first opens a socket to the web server', 'TCP SYN segment', 'Ethernet frames carry 1500 bytes.']);
});

test('counters, number tables, diagram glue and foreign alphabets are not statements', () => {
  expect(readableUnit('Transport Layer: 3-12')).toBe(false);
  expect(readableUnit('222.222.222.220 111.111.111.110 E6-E9-00-17-BB-4B CC-49-DE')).toBe(false);
  expect(readableUnit('msg§is passed an application layer message')).toBe(false);
  expect(readableUnit('Nenut cell工 teams научин what the internet has')).toBe(false);
  expect(readableUnit('TCP provides reliable transport between processes')).toBe(true);
});

test('a damaged ligature in a label is put right only with a word the material itself has', () => {
  const pages = [{ units: ['congestion control matters for congestion windows'], heading: null }, { units: ['the congestion window grows'], heading: null }];
  const vocab = cleanVocabulary(pages);
  expect(repairLabel('conges$on control', vocab)).toBe('congestion control');
  expect(repairLabel('quantum$on control', vocab)).toBe('quantum$on control'); // no such word in the material: untouched
});

test('key terms are the stressed ones, not the topic of the whole material and not stop words', () => {
  const pages = (deck as any[]).map((s, i) => ({ segment: s, order: i, heading: s.text.split('\n')[0], units: s.text.split('\n').slice(1), fixed: s.text.split('\n').slice(1), fixedHeading: s.text.split('\n')[0] }));
  const labels = keyTerms(pages as any).map((t) => t.key);
  expect(labels).toEqual(expect.arrayContaining(['congestion control']));
  expect(labels).not.toContain('the');
  expect(labels).not.toContain('with');
});

test('concepts: each has a term, a quote that is literally on the cited page, and never a damaged label', () => {
  const items = extractConcepts(deck) as any[];
  expect(items.length).toBeGreaterThanOrEqual(2);
  for (const it of items) {
    const seg = deck.find((s) => s.id === it.source.id)!;
    expect(seg.text.replace(/\s+/g, ' ')).toContain(it.quote);
    expect(it.term).toMatch(/^[A-Za-z0-9 '-]+$/);
    expect(it.explanation.length).toBeGreaterThanOrEqual(8);
  }
  expect(new Set(items.map((i) => i.quote)).size).toBe(items.length); // no sentence twice
});

test('points: spread over the whole material, in order, each quote literal', () => {
  const items = extractPoints(deck) as any[];
  expect(items.length).toBeGreaterThanOrEqual(3);
  const pagesUsed = items.map((i) => i.source.location.page);
  expect([...pagesUsed].sort((a, b) => a - b)).toEqual(pagesUsed);
  expect(Math.max(...pagesUsed) - Math.min(...pagesUsed)).toBeGreaterThan(24);
  for (const it of items) expect(deck.find((s) => s.id === it.source.id)!.text.replace(/\s+/g, ' ')).toContain(it.quote);
});

test('a material too thin to say anything gives no extractive items (the caller then reports honestly)', () => {
  expect(extractSummary('summary', [page(1, 'Short note.')])).toEqual([]);
  expect(extractSummary('concepts', [])).toEqual([]);
});

test('key pages: a short material is read whole; a long one is covered from start to end, one page per section', () => {
  expect(selectKeyPages(deck.slice(0, 6), 10).picked).toHaveLength(6);
  const { picked, terms } = selectKeyPages(deck, 8);
  expect(picked.length).toBeGreaterThanOrEqual(3);
  expect(picked.length).toBeLessThanOrEqual(8);
  const first = (picked[0].location as any).page, last = (picked[picked.length - 1].location as any).page;
  expect(last - first).toBeGreaterThan(24);
  expect(terms.length).toBeGreaterThan(0);
});

const preview = { material: { id: 'pdf_a', kind: 'PDF', title: 'Deck', source_id: 'src' }, segments: deck };
const user = { id: 'u', role: 'USER' } as any;
const makeService = (ai: any) => {
  const service = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (service as any).preview = jest.fn().mockResolvedValue(preview);
  return service;
};

test('the model reads the key pages with the key terms as a hint, and its verified items are returned as "model"', async () => {
  // the model cites a sentence that really is on the first page it was shown
  const ai = {
    call: jest.fn().mockImplementation(async (_m: string, _p: string, opts: any) => {
      const first = opts.body.evidence[0].text.split(String.fromCharCode(10))[2].replace('§', '');
      return { kind: 'response', status: 200, body: { items: [{ text: 'Alıcı aldığı her parçayı onaylar.', quote: first, source_index: 1 }] } };
    }),
  };
  const result: any = await makeService(ai).summarize(user, 'c', 'pdf_a', 'summary');
  expect(result.method).toBe('model');
  expect(result.items).toHaveLength(1);
  const sent = ai.call.mock.calls[0][2].body;
  expect(sent.terms.length).toBeGreaterThan(0);
  expect(sent.evidence.length).toBeLessThanOrEqual(10);
});

test.each([
  [{ kind: 'timeout' }],
  [{ kind: 'unreachable' }],
  [{ kind: 'response', status: 503, body: {} }],
  [{ kind: 'response', status: 200, body: { items: [{ text: 'Uydurma madde.', quote: 'nowhere in the deck', source_index: 1 }] } }],
])('when the model cannot give a verifiable summary (%j) the key sentences of the whole material are shown, labelled as selected', async (response) => {
  const ai = { call: jest.fn().mockResolvedValue(response) };
  const result: any = await makeService(ai).summarize(user, 'c', 'pdf_a', 'summary');
  expect(result.method).toBe('extractive');
  expect(result.status).toBe('SOURCE_VERIFIED');
  expect(result.items.length).toBeGreaterThanOrEqual(3);
});
