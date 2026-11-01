/** Upload validation, ownership/visibility, source viewer, file download, deletion. */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

import { Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start({ uploadMaxBytes: 64 * 1024 }));
afterAll(() => h.stop());
beforeEach(() => h.reset());

const tmpFiles = () => (existsSync(path.join(h.storageRoot, 'tmp')) ? readdirSync(path.join(h.storageRoot, 'tmp')) : []);
const pdf = (tag: string) => Buffer.concat([PDF, Buffer.from(`% ${tag}\n`)]);

describe('upload', () => {
  test('stores the PDF, records metadata and creates a QUEUED INITIAL job', async () => {
    const file = pdf('a');
    const r = await h.upload('ayse', h.world.courses.vy, { file, name: 'Hafta4_AVL_Ağaçları.pdf', type: 'slide' }).expect(201);
    expect(r.body).toMatchObject({
      course_id: h.world.courses.vy, owner_id: h.world.users.ayse, visibility: 'PRIVATE', document_type: 'slide',
      title: 'Hafta4_AVL_Ağaçları', original_filename: 'Hafta4_AVL_Ağaçları.pdf', mime_type: 'application/pdf',
      size_bytes: file.length, page_count: null, can_delete: true, notices: [],
      status: { state: 'UPLOADED', ui_state: 'uploaded', stage: null, error: null },
    });
    expect(r.body.id).toMatch(/^c[0-9a-z]{24}$/);
    const doc = await h.prisma.document.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(doc.contentSha256).toBe(createHash('sha256').update(file).digest('hex'));
    expect(doc.activeContentHash).toBe(doc.contentSha256);
    expect(readFileSync(path.join(h.storageRoot, doc.storageKey))).toEqual(file);
    const job = await h.activeJob(doc.id);
    expect(job).toMatchObject({ kind: 'INITIAL', status: 'QUEUED', attempt: 1, indexingVersion: 'c1', indexVersionId: h.world.ivId });
    expect(tmpFiles()).toEqual([]);
  });

  test('rejects non-PDF content regardless of the declared type or extension (415)', async () => {
    const r = await h.upload('ayse', h.world.courses.vy, { file: Buffer.from('\x89PNG\r\n\x1a\n not a pdf'), name: 'x.pdf' }).expect(415);
    expect(r.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(await h.prisma.document.count()).toBe(0);
    expect(tmpFiles()).toEqual([]);
  });

  test('rejects files above the size limit (413) and removes the partial file', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(70 * 1024, 0x20)]);
    const r = await h.upload('ayse', h.world.courses.vy, { file: big }).expect(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    await new Promise((res) => setTimeout(res, 100));
    expect(tmpFiles()).toEqual([]);
    expect(await h.prisma.document.count()).toBe(0);
  });

  test('validates fields: missing file, bad document_type, bad visibility, long title, empty file', async () => {
    const noFile = await h.http().post(`/courses/${h.world.courses.vy}/documents`).set(await h.as('ayse')).field('document_type', 'slide').expect(422);
    expect(noFile.body.error.code).toBe('VALIDATION_ERROR');
    await h.upload('ayse', h.world.courses.vy, { type: 'pdf' }).expect(422);
    await h.upload('ayse', h.world.courses.vy, { visibility: 'PUBLIC' }).expect(422);
    await h.upload('ayse', h.world.courses.vy, { title: 'x'.repeat(301) }).expect(422);
    await h.upload('ayse', h.world.courses.vy, { file: Buffer.alloc(0) }).expect((r) => expect([415, 422]).toContain(r.status));
    expect(await h.prisma.document.count()).toBe(0);
    expect(tmpFiles()).toEqual([]);
  });

  test('only instructors upload COURSE documents (403 for students)', async () => {
    const r = await h.upload('ayse', h.world.courses.vy, { visibility: 'COURSE' }).expect(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    const ok = await h.upload('instructor', h.world.courses.vy, { visibility: 'COURSE' }).expect(201);
    expect(ok.body.visibility).toBe('COURSE');
  });

  test('non-members get 404 before the body is stored; admins without membership cannot upload', async () => {
    await h.upload('outsider', h.world.courses.vy).expect(404);
    await h.upload('ayse', h.world.courses.os).expect(404);
    await h.upload('admin', h.world.courses.vy).expect(404);
    expect(tmpFiles()).toEqual([]);
  });

  test('duplicate upload by the same owner is 409 with the existing id; re-upload after delete is allowed', async () => {
    const first = await h.uploadOk('ayse', h.world.courses.vy, { file: pdf('dup') });
    const dup = await h.upload('ayse', h.world.courses.vy, { file: pdf('dup'), name: 'other-name.pdf' }).expect(409);
    expect(dup.body.error).toMatchObject({ code: 'DUPLICATE_DOCUMENT', details: { existing_document_id: first.id } });
    await h.uploadOk('mehmet', h.world.courses.vy, { file: pdf('dup') }); // other owner: allowed
    await h.http().delete(`/documents/${first.id}`).set(await h.as('ayse')).expect(202);
    const again = await h.uploadOk('ayse', h.world.courses.vy, { file: pdf('dup') });
    expect(again.id).not.toBe(first.id); // a new document_id: cannot collide with stale chunks
    expect(tmpFiles()).toEqual([]);
  });

  test('concurrent identical uploads: exactly one wins, the other is 409', async () => {
    const results = await Promise.all([1, 2, 3].map(() => h.upload('ayse', h.world.courses.vy, { file: pdf('race') })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await h.prisma.document.count()).toBe(1);
  });

  test('a student copy of a COURSE document gets the SAME_AS_COURSE_DOCUMENT notice', async () => {
    await h.uploadOk('instructor', h.world.courses.vy, { visibility: 'COURSE', file: pdf('shared') });
    const copy = await h.uploadOk('ayse', h.world.courses.vy, { file: pdf('shared') });
    expect(copy.notices).toEqual(['SAME_AS_COURSE_DOCUMENT']);
  });
});

describe('visibility and ownership', () => {
  let privateAyse: string;
  let privateMehmet: string;
  let courseDoc: string;
  let otherCourse: string;

  beforeEach(async () => {
    privateAyse = (await h.uploadOk('ayse', h.world.courses.vy, { file: pdf('ayse') })).id;
    privateMehmet = (await h.uploadOk('mehmet', h.world.courses.vy, { file: pdf('mehmet') })).id;
    courseDoc = (await h.uploadOk('instructor', h.world.courses.vy, { visibility: 'COURSE', file: pdf('course') })).id;
    otherCourse = (await h.uploadOk('mehmet', h.world.courses.os, { file: pdf('os') })).id;
  });

  test('lists show COURSE documents plus my own PRIVATE ones', async () => {
    const ids = async (who: 'ayse' | 'mehmet' | 'instructor') =>
      (await h.http().get(`/courses/${h.world.courses.vy}/documents`).set(await h.as(who)).expect(200)).body.map((d: { id: string }) => d.id).sort();
    expect(await ids('ayse')).toEqual([privateAyse, courseDoc].sort());
    expect(await ids('mehmet')).toEqual([privateMehmet, courseDoc].sort());
    expect(await ids('instructor')).toEqual([courseDoc]);
    await h.http().get(`/courses/${h.world.courses.os}/documents`).set(await h.as('ayse')).expect(404);
  });

  test("another user's PRIVATE document is 404 on every route (cross-user)", async () => {
    const auth = await h.as('ayse');
    for (const p of [`/documents/${privateMehmet}`, `/documents/${privateMehmet}/file`, `/documents/${privateMehmet}/pages/1`]) {
      const r = await h.http().get(p).set(auth).expect(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    }
    await h.http().delete(`/documents/${privateMehmet}`).set(auth).expect(404);
    await h.http().post(`/documents/${privateMehmet}/retry`).set(auth).expect(404);
  });

  test('documents of a course I am not in are 404 (cross-course)', async () => {
    await h.http().get(`/documents/${otherCourse}`).set(await h.as('ayse')).expect(404);
    await h.http().get(`/documents/${otherCourse}`).set(await h.as('instructor')).expect(404);
    await h.http().get(`/documents/${otherCourse}`).set(await h.as('mehmet')).expect(200);
  });

  test('COURSE documents: members view; students may not delete (403); instructor and admin may', async () => {
    await h.http().get(`/documents/${courseDoc}`).set(await h.as('ayse')).expect(200).expect((r) => expect(r.body.can_delete).toBe(false));
    await h.http().delete(`/documents/${courseDoc}`).set(await h.as('ayse')).expect(403);
    await h.http().delete(`/documents/${courseDoc}`).set(await h.as('instructor')).expect(202);
    const second = (await h.uploadOk('instructor', h.world.courses.vy, { visibility: 'COURSE', file: pdf('course2') })).id;
    await h.http().delete(`/documents/${second}`).set(await h.as('admin')).expect(202);
  });

  test("admins cannot read other users' PRIVATE documents but can delete them", async () => {
    await h.http().get(`/documents/${privateAyse}`).set(await h.as('admin')).expect(404);
    await h.http().get(`/documents/${privateAyse}/file`).set(await h.as('admin')).expect(404);
    await h.http().delete(`/documents/${privateAyse}`).set(await h.as('admin')).expect(202);
  });

  test('instructors cannot see or delete students\' PRIVATE documents', async () => {
    await h.http().get(`/documents/${privateAyse}`).set(await h.as('instructor')).expect(404);
    await h.http().delete(`/documents/${privateAyse}`).set(await h.as('instructor')).expect(404);
  });

  test('removing a membership removes access to my own PRIVATE documents at once', async () => {
    await h.prisma.courseMembership.delete({ where: { userId_courseId: { userId: h.world.users.ayse, courseId: h.world.courses.vy } } });
    await h.http().get(`/documents/${privateAyse}`).set(await h.as('ayse')).expect(404);
    await h.http().get(`/courses/${h.world.courses.vy}/documents`).set(await h.as('ayse')).expect(404);
  });
});

describe('source viewer and file download', () => {
  test('serves pages from the artifact; 409 before READY; 404 for unknown version or page', async () => {
    const id = (await h.uploadOk('ayse', h.world.courses.vy)).id;
    const auth = await h.as('ayse');
    const notReady = await h.http().get(`/documents/${id}/pages/1`).set(auth).expect(409);
    expect(notReady.body.error.code).toBe('DOCUMENT_NOT_READY');
    await h.makeReady(id, ['Veri Yapıları · Hafta 4', 'AVL ağacı 𝑛 düğüm']);
    const p2 = await h.http().get(`/documents/${id}/pages/2`).set(auth).expect(200);
    expect(p2.body).toEqual({ document_id: id, indexing_version: 'c1', page: 2, page_count: 2, char_start: 25, char_end: 42, text: 'AVL ağacı 𝑛 düğüm' });
    await h.http().get(`/documents/${id}/pages/1?indexing_version=c1`).set(auth).expect(200);
    await h.http().get(`/documents/${id}/pages/3`).set(auth).expect(404);
    await h.http().get(`/documents/${id}/pages/0`).set(auth).expect(404);
    await h.http().get(`/documents/${id}/pages/abc`).set(auth).expect(404);
    await h.http().get(`/documents/${id}/pages/1?indexing_version=c0`).set(auth).expect(404);
    await h.http().get(`/documents/${id}/pages/1?indexing_version=..%2F..%2Fetc`).set(auth).expect(422);
  });

  test('file download streams the original with safe headers', async () => {
    const file = pdf('download');
    const id = (await h.uploadOk('ayse', h.world.courses.vy, { file, name: 'Ders Notu ç.pdf' })).id;
    const r = await h.http().get(`/documents/${id}/file`).set(await h.as('ayse')).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe(`inline; filename*=UTF-8''${encodeURIComponent('Ders Notu ç.pdf')}`);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.body).toEqual(file);
  });

  test('deleted documents are gone from list, detail, pages and file immediately', async () => {
    const id = (await h.uploadOk('ayse', h.world.courses.vy)).id;
    await h.makeReady(id);
    const auth = await h.as('ayse');
    const del = await h.http().delete(`/documents/${id}`).set(auth).expect(202);
    expect(del.body).toEqual({ id, state: 'DELETING' });
    for (const p of [`/documents/${id}`, `/documents/${id}/pages/1`, `/documents/${id}/file`]) await h.http().get(p).set(auth).expect(404);
    expect((await h.http().get(`/courses/${h.world.courses.vy}/documents`).set(auth).expect(200)).body).toEqual([]);
    await h.http().delete(`/documents/${id}`).set(auth).expect(404);
    const row = await h.prisma.document.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'DELETING', activeContentHash: null, activeJobId: null, purgedAt: null });
    expect(row.deletedAt).not.toBeNull();
  });
});
