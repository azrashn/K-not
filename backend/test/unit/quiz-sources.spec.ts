import {
  DOCUMENTS_ONLY_MISSING, findQuizSources, isTranscriptId, pickQuizMaterials, videoChosen,
} from '../../src/learning/quiz-sources';
import { loadSourceTexts } from '../../src/learning/source-texts';

const u = { id: 'u', role: 'USER' } as any;
const doc = (id: string, text = 'Java nesne yönelimli bir dildir.') => ({ id, text, material_id: 'pdf_notes', version: 'v', kind: 'PDF', title: 'java-notlari' });
const clip = (id: string, text = 'Ceva object oriented bir dildir.') => ({ id, text, material_id: 'video_java', version: 'v', kind: 'VIDEO', title: '2 Dakikada Java' });
const MATERIALS = [
  { id: 'pdf_notes', kind: 'PDF', status: 'READY', title: 'java-notlari' },
  { id: 'file_slides', kind: 'TXT', status: 'READY', title: 'slaytlar' },
  { id: 'video_java', kind: 'VIDEO', status: 'READY', title: '2 Dakikada Java' },
];

function knowledge(evidence: any[], over: any = {}) {
  return {
    ask: jest.fn().mockResolvedValue({ evidence, video_learning: evidence.map((e) => ({ source_id: e.id, state: 'WATCHED' })) }),
    materials: jest.fn().mockResolvedValue(MATERIALS),
    preview: jest.fn().mockResolvedValue({ segments: [] }),
    ...over,
  };
}

describe('documents come before automatic transcripts', () => {
  test('when both match, only the document excerpts are used', async () => {
    const k = knowledge([clip('v1'), doc('d1'), clip('v2'), doc('d2')]);
    const found = await findQuizSources(k as any, u, 'c', { topic: 'Java' });
    expect(found.map((e) => e.id)).toEqual(['d1', 'd2']);
    expect(k.ask).toHaveBeenCalledTimes(1);
    expect(k.materials).not.toHaveBeenCalled();
  });

  test('when only transcripts matched but the course has documents, the documents are asked alone', async () => {
    const k = knowledge([clip('v1'), clip('v2')]);
    k.ask.mockResolvedValueOnce({ evidence: [clip('v1'), clip('v2')], video_learning: [] })
      .mockResolvedValueOnce({ evidence: [doc('d1')], video_learning: [] });
    const found = await findQuizSources(k as any, u, 'c', { topic: 'Java' });
    expect(found.map((e) => e.id)).toEqual(['d1']);
    expect(k.ask.mock.calls[1][2].scope).toEqual({ mode: 'selected', material_ids: ['pdf_notes', 'file_slides'] });
  });

  test('a topic only the transcript mentions is NO_SOURCE with a hint, never the transcript', async () => {
    const k = knowledge([]);
    k.ask.mockResolvedValueOnce({ evidence: [clip('v1')], video_learning: [] })
      .mockResolvedValueOnce({ evidence: [], video_learning: [] });
    await expect(findQuizSources(k as any, u, 'c', { topic: 'Final Neave' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: DOCUMENTS_ONLY_MISSING });
  });

  test('a course with nothing but videos still uses the transcript', async () => {
    const k = knowledge([clip('v1')], { materials: jest.fn().mockResolvedValue([MATERIALS[2]]) });
    const found = await findQuizSources(k as any, u, 'c', { topic: 'Java' });
    expect(found.map((e) => e.id)).toEqual(['v1']);
    expect(k.ask).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['a selected scope that names the video', { scope: { mode: 'selected', material_ids: ['video_java', 'pdf_notes'] } }],
    ['the video as the active material', { material_id: 'video_java' }],
    ['watched-only practice', { watched_only: true }],
  ])('%s keeps the transcript', async (_name, request) => {
    const k = knowledge([clip('v1'), doc('d1')]);
    const found = await findQuizSources(k as any, u, 'c', { topic: 'Java', ...request });
    expect(found.map((e) => e.id)).toEqual(['v1', 'd1']);
    expect(k.materials).not.toHaveBeenCalled();
  });
});

describe('which materials a quiz may draw from', () => {
  test('video ids are recognised', () => {
    expect(isTranscriptId('video_x')).toBe(true);
    expect(isTranscriptId('pdf_x')).toBe(false);
    expect(isTranscriptId(undefined)).toBe(false);
  });

  test('the whole course: documents only, and it says transcripts were left out', () => {
    const pick = pickQuizMaterials(MATERIALS, {});
    expect(pick.materials.map((m) => m.id)).toEqual(['pdf_notes', 'file_slides']);
    expect(pick.documentsOnly).toBe(true);
  });

  test('a course without videos leaves nothing out', () => {
    expect(pickQuizMaterials(MATERIALS.slice(0, 2), {}).documentsOnly).toBe(false);
  });

  test('a course with only videos keeps them', () => {
    const pick = pickQuizMaterials([MATERIALS[2]], {});
    expect(pick).toEqual({ materials: [MATERIALS[2]], documentsOnly: false });
  });

  test('a selection that names a video is an explicit choice', () => {
    const scope = { mode: 'selected', material_ids: ['video_java'] };
    expect(videoChosen({ scope })).toBe(true);
    expect(pickQuizMaterials(MATERIALS, { scope }).materials.map((m) => m.id)).toEqual(['video_java']);
  });

  test('materials that are not ready are never used', () => {
    const pick = pickQuizMaterials([{ ...MATERIALS[0], status: 'PROCESSING' }, MATERIALS[2]], {});
    expect(pick.materials.map((m) => m.id)).toEqual(['video_java']);
  });
});

describe('source texts for exam topics', () => {
  test('transcripts are not read when the course has documents', async () => {
    const k = knowledge([], { preview: jest.fn().mockResolvedValue({ segments: [{ text: 'Sınıflar ve nesneler' }] }) });
    const sources = await loadSourceTexts(k as any, u, 'c', undefined);
    expect(k.preview.mock.calls.map((c: any[]) => c[2])).toEqual(['pdf_notes', 'file_slides']);
    expect(sources.documentsOnly).toBe(true);
    expect(sources.texts).toHaveLength(2);
  });
});
