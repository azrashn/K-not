import { ConfigError, loadConfig } from '../../../src/config/config';
import {
  buildPool, chooseMaterials, loadPool, NO_DOCUMENT_MESSAGE, NOTHING_READY_MESSAGE, PART_CHARS, partCapacity,
  sentenceSpans, splitSegment, TRANSCRIPT_WARNING, usableSentences,
} from '../../../src/learning/generation/source-pool';
import { knowledge, NOTES, SEGMENTS, SLIDES, VIDEO } from './java-course';

const u = { id: 'u', role: 'USER' } as any;
const COURSE = [NOTES, VIDEO];

describe('QUIZ_TRANSCRIPT_POLICY setting', () => {
  const env = (extra: Record<string, string> = {}) => ({
    AI_SERVICE_URL: 'http://localhost:8100', DATABASE_URL: 'mysql://x', JWT_SECRET: 'x'.repeat(32), STORAGE_ROOT: '/tmp',
    RAG_INTERNAL_API_TOKEN: 'a'.repeat(16), INGEST_CALLBACK_TOKEN: 'b'.repeat(16), ...extra,
  });
  test('defaults to documents_first', () => expect(loadConfig(env()).quizTranscriptPolicy).toBe('documents_first'));
  test('accepts both values in any case', () => {
    expect(loadConfig(env({ QUIZ_TRANSCRIPT_POLICY: ' Never ' })).quizTranscriptPolicy).toBe('never');
    expect(loadConfig(env({ QUIZ_TRANSCRIPT_POLICY: 'DOCUMENTS_FIRST' })).quizTranscriptPolicy).toBe('documents_first');
  });
  test('rejects anything else', () => {
    expect(() => loadConfig(env({ QUIZ_TRANSCRIPT_POLICY: 'always' }))).toThrow(ConfigError);
  });
});

describe('documents_first: a course with documents never uses the transcript', () => {
  test('the whole course: documents only, no warning, and it knows the transcript was left out', async () => {
    const k = knowledge(COURSE);
    const pool = await loadPool(k as any, u, 'c', {}, 'documents_first');
    expect(pool.parts.length).toBeGreaterThan(0);
    expect(pool.parts.every((p) => p.material_id === NOTES.id && !p.transcript)).toBe(true);
    expect(pool.parts.some((p) => /Ceva|Neave|Intelijayda/.test(p.text))).toBe(false);
    expect(pool).toMatchObject({ transcript: false, warning: null, transcriptsLeftOut: true });
    expect(k.preview.mock.calls.map((c: any[]) => c[2])).toEqual([NOTES.id]); // the transcript is not even read
  });

  test.each([
    ['a selected scope that names the video', { scope: { mode: 'selected', material_ids: [VIDEO.id] } }],
    ['the video as the active material', { material_id: VIDEO.id }],
    ['watched-only practice', { watched_only: true }],
  ])('%s: transcript with the warning', (_name, req) => {
    const choice = chooseMaterials(COURSE, req, 'documents_first');
    expect(choice.materials).toEqual([VIDEO]);
    const pool = buildPool(choice.materials, SEGMENTS);
    expect(pool.transcript).toBe(true);
    expect(pool.warning).toBe(TRANSCRIPT_WARNING);
  });

  test('a course without any document: transcript with the warning', async () => {
    const pool = await loadPool(knowledge([VIDEO]) as any, u, 'c', {}, 'documents_first');
    expect(pool.parts.every((p) => p.transcript)).toBe(true);
    expect(pool.warning).toBe('Sorular videonun otomatik transkriptinden hazırlanıyor; yazım hataları olabilir.');
    expect(pool.transcriptsLeftOut).toBe(false);
  });

  test('selecting a document and the video uses both, with the warning', () => {
    const choice = chooseMaterials(COURSE, { scope: { mode: 'selected', material_ids: [NOTES.id, VIDEO.id] } }, 'documents_first');
    expect(choice.materials.map((m) => m.id)).toEqual([NOTES.id, VIDEO.id]);
    expect(choice.transcript).toBe(true);
  });

  test('nothing ready in scope is refused', () => {
    expect(() => chooseMaterials([{ ...NOTES, status: 'PROCESSING' }], {}, 'documents_first')).toThrow(NOTHING_READY_MESSAGE);
  });
});

describe('never: transcripts are not used at all', () => {
  test('a course with documents: documents only', () => {
    expect(chooseMaterials(COURSE, {}, 'never')).toEqual({ materials: [NOTES], transcript: false, transcriptsLeftOut: true });
  });

  test.each([
    ['a course with only a video', [VIDEO], {}],
    ['a chosen video', COURSE, { scope: { mode: 'selected', material_ids: [VIDEO.id] } }],
    ['watched-only practice', COURSE, { watched_only: true }],
  ])('%s asks for a document', (_name, materials, req) => {
    expect(() => chooseMaterials(materials as any, req, 'never')).toThrow(NO_DOCUMENT_MESSAGE);
    try {
      chooseMaterials(materials as any, req, 'never');
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.message).toBe('Soru üretmek için derse en az bir belge (PDF, slayt ya da metin) yükleyin.');
    }
  });

  test('a selection of a document and the video keeps only the document', () => {
    const choice = chooseMaterials(COURSE, { scope: { mode: 'selected', material_ids: [NOTES.id, VIDEO.id] } }, 'never');
    expect(choice.materials).toEqual([NOTES]);
  });
});

describe('parts and capacity', () => {
  test('sentences are counted as the ai-service numbers them', () => {
    expect(usableSentences('Java bir dildir. JVM bytecode çalıştırır.')).toBe(2);
    expect(usableSentences('Ok. Java bir programlama dilidir.')).toBe(1); // a short piece joins the next
    expect(usableSentences('Başlık\nİçerik cümlesi buradadır.')).toBe(1);
    expect(usableSentences('a'.repeat(1300))).toBe(3); // over 600 characters: counted as its pieces
    expect(sentenceSpans('')).toEqual([]);
  });

  test('a part carries 2 questions with six sentences, 1 with fewer, none without', () => {
    expect([partCapacity(6), partCapacity(5), partCapacity(1), partCapacity(0)]).toEqual([2, 1, 1, 0]);
  });

  test('every part of the notes is its own part, with its capacity and source link', () => {
    const pool = buildPool([NOTES], SEGMENTS);
    expect(pool.parts.map((p) => [p.key, p.capacity])).toEqual([['n1', 1], ['n2', 1], ['n3', 1], ['n4', 2], ['n5', 1]]);
    expect(pool.capacity).toBe(6);
    expect(pool.parts[0]).toMatchObject({ id: 'n1', material_id: NOTES.id, version: 'v1', kind: 'TXT', title: 'java-notlari', order: 0 });
  });

  test('a PDF page without text and an empty segment give no part', () => {
    const pool = buildPool([SLIDES], SEGMENTS);
    expect(pool.parts.map((p) => p.key)).toEqual(['s1']);
  });

  test('a long segment is cut at sentence ends into parts the ai-service shows whole', () => {
    const sentence = (i: number) => `Bu ${i}. cümle, uzun bir ders notunun yalnızca bir parçasıdır ve tek başına anlamlıdır.`;
    const text = Array.from({ length: 40 }, (_, i) => sentence(i + 1)).join(' ');
    const pieces = splitSegment(text);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(PART_CHARS);
      expect(text.includes(piece)).toBe(true); // the quote check and the source link still hold
      expect(piece.endsWith('.')).toBe(true);
    }
    expect(pieces.join(' ')).toBe(text);
    const pool = buildPool([NOTES], new Map([[NOTES.id, [{ id: 'long', text }]]]));
    expect(pool.parts.map((p) => p.key)).toEqual(pieces.map((_, i) => `long#${i + 1}`));
    expect(new Set(pool.parts.map((p) => p.id))).toEqual(new Set(['long']));
  });

  test('watched-only keeps only the eligible segments', () => {
    const pool = buildPool([VIDEO], SEGMENTS, new Set(['v2']));
    expect(pool.parts.map((p) => p.id)).toEqual(['v2']);
  });

  test('an unreadable material adds nothing', async () => {
    const pool = await loadPool(knowledge([NOTES, { ...SLIDES, id: 'pdf_missing' }]) as any, u, 'c', {}, 'documents_first');
    expect(new Set(pool.parts.map((p) => p.material_id))).toEqual(new Set([NOTES.id]));
  });
});
