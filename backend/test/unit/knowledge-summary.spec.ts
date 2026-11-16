import { KnowledgeService } from '../../src/knowledge/knowledge.service';
import { pickSpread, verifiedSummaryItems } from '../../src/knowledge/summary';

const segs = [
  { id: 's1', text: 'Kuyruk ilk giren ilk çıkar yapısıdır.', location: { kind: 'page', page: 1 } },
  { id: 's2', text: 'Dijkstra algoritması negatif kenar ağırlığı ile doğru çalışmaz.', location: { kind: 'page', page: 2 } },
];

test('pickSpread covers the whole material instead of only its first segments', () => {
  const list = Array.from({ length: 20 }, (_, i) => i);
  expect(pickSpread(list, 4)).toEqual([0, 5, 10, 15]);
  expect(pickSpread([1, 2], 8)).toEqual([1, 2]);
});

test('a point is kept only when its quote is inside the segment it cites', () => {
  const raw = { points: [
    { text: 'Kuyruk FIFO yapısıdır.', quote: 'ilk giren ilk çıkar yapısıdır', source_index: 1 },
    { text: 'Yanlış atıf.', quote: 'ilk giren ilk çıkar yapısıdır', source_index: 2 },
    { text: 'Değiştirilmiş alıntı.', quote: 'ilk giren son çıkar', source_index: 1 },
    { text: 'Bilinmeyen kaynak.', quote: 'Dijkstra algoritması', source_index: 7 },
  ] };
  const items = verifiedSummaryItems('summary', raw, segs);
  expect(items).toEqual([{ text: 'Kuyruk FIFO yapısıdır.', quote: 'ilk giren ilk çıkar yapısıdır', source: { id: 's1', location: { kind: 'page', page: 1 } } }]);
});

test('concept items need a term and an explanation as well as a verified quote', () => {
  const raw = { concepts: [
    { term: 'Dijkstra', explanation: 'Negatif kenar ağırlığı sorun yaratır.', quote: 'negatif kenar ağırlığı', source_index: 2 },
    { term: 'X', explanation: 'çok kısa', quote: 'negatif kenar ağırlığı', source_index: 2 },
  ] };
  const items = verifiedSummaryItems('concepts', raw, segs) as any[];
  expect(items.map((i) => i.term)).toEqual(['Dijkstra']);
  expect(items[0].source.id).toBe('s2');
});

test('no verifiable point means the summary is not published', async () => {
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { points: [{ text: 'Uydurma madde.', quote: 'hiçbir yerde yok', source_index: 1 }] } }) };
  const service = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (service as any).preview = jest.fn().mockResolvedValue({ material: { id: 'pdf_a', kind: 'PDF', title: 'Notlar', source_id: 'src' }, segments: segs });
  await expect(service.summarize({ id: 'u', role: 'USER' } as any, 'c', 'pdf_a', 'summary')).rejects.toMatchObject({ code: 'GENERATION_FAILED' });
  expect(ai.call.mock.calls[0][1]).toBe('/api/v1/knowledge/summary');
  expect(ai.call.mock.calls[0][2].body.evidence.map((e: any) => e.id)).toEqual(['s1', 's2']);
});

test('a verified summary returns sources with their location and the material it belongs to', async () => {
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body: { points: [{ text: 'Kuyruk FIFO yapısıdır.', quote: 'ilk giren ilk çıkar yapısıdır', source_index: 1 }] } }) };
  const service = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (service as any).preview = jest.fn().mockResolvedValue({ material: { id: 'pdf_a', kind: 'PDF', title: 'Notlar', source_id: 'src' }, segments: segs });
  const result = await service.summarize({ id: 'u', role: 'USER' } as any, 'c', 'pdf_a', 'summary');
  expect(result).toMatchObject({ status: 'SOURCE_VERIFIED', focus: 'summary', material: { id: 'pdf_a' } });
  expect(result.items[0].source).toEqual({ id: 's1', location: { kind: 'page', page: 1 } });
});

test.each([
  [{ kind: 'timeout' }, 'PROVIDER_TIMEOUT'],
  [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 503, body: {} }, 'AI_SERVICE_UNAVAILABLE'],
  [{ kind: 'response', status: 422, body: {} }, 'VALIDATION_ERROR'],
])('summary failure %j is classified', async (response, code) => {
  const ai = { call: jest.fn().mockResolvedValue(response) };
  const service = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (service as any).preview = jest.fn().mockResolvedValue({ material: { id: 'pdf_a' }, segments: segs });
  await expect(service.summarize({ id: 'u', role: 'USER' } as any, 'c', 'pdf_a', 'summary')).rejects.toMatchObject({ code });
});

test('a material with no text is refused before any model call', async () => {
  const ai = { call: jest.fn() };
  const service = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (service as any).preview = jest.fn().mockResolvedValue({ material: { id: 'pdf_a' }, segments: [{ id: 's', text: '   ' }] });
  await expect(service.summarize({ id: 'u', role: 'USER' } as any, 'c', 'pdf_a', 'summary')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(ai.call).not.toHaveBeenCalled();
});
