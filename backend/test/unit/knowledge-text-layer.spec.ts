import { KnowledgeService } from '../../src/knowledge/knowledge.service';

const user = { id: 'u', role: 'USER' } as any;
const material = { id: 'pdf_a', kind: 'PDF', status: 'READY', version: 'v1', row: { storageKey: 'documents/a/original.pdf' } };

function service(body: unknown, materials = [material]) {
  const ai = { call: jest.fn().mockResolvedValue({ kind: 'response', status: 200, body }) };
  const s = new KnowledgeService({} as any, {} as any, ai as any, {} as any, {} as any, {} as any);
  (s as any).materials = jest.fn().mockResolvedValue(materials);
  return { s, ai };
}

test('the page text layer is asked for the material version and passed on as lines of words', async () => {
  const { s, ai } = service({ material_id: 'pdf_a', version: 'v1', page: 2, page_count: 3,
    lines: [[['Veri', 0.1, 0.1, 0.2, 0.12], ['tipleri', 0.21, 0.1, 0.3, 0.12]]] });
  await expect(s.visualText(user, 'c', 'pdf_a', 2)).resolves.toEqual({
    material_id: 'pdf_a', page: 2, lines: [[['Veri', 0.1, 0.1, 0.2, 0.12], ['tipleri', 0.21, 0.1, 0.3, 0.12]]],
  });
  expect(ai.call).toHaveBeenCalledWith('POST', '/api/v1/knowledge/render/text', expect.objectContaining({
    body: { course_id: 'c', material_id: 'pdf_a', version: 'v1', storage_key: 'documents/a/original.pdf', page: 2 },
  }));
});

test('malformed words are dropped, never passed to the page', async () => {
  const { s } = service({ material_id: 'pdf_a', version: 'v1', page: 1,
    lines: [[['ok', 0, 0, 0.5, 0.5], ['far', 0, 0, 2, 0.5], [3, 0, 0, 0.1, 0.1], 'x'], 'not a line', []] });
  expect((await s.visualText(user, 'c', 'pdf_a', 1)).lines).toEqual([[['ok', 0, 0, 0.5, 0.5]]]);
});

test('a layer for another version or page is refused', async () => {
  const { s } = service({ material_id: 'pdf_a', version: 'old', page: 1, lines: [] });
  await expect(s.visualText(user, 'c', 'pdf_a', 1)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
});

test('a material that is not a ready PDF or slide deck has no page layer', async () => {
  const { s, ai } = service({}, [{ ...material, kind: 'VIDEO' }]);
  await expect(s.visualText(user, 'c', 'pdf_a', 1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(ai.call).not.toHaveBeenCalled();
});
