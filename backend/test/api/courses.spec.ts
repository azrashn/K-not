import { Harness } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset());

test('GET /courses lists only courses with a membership, with my role and visible counts', async () => {
  const mehmet = await h.http().get('/courses').set(await h.as('mehmet')).expect(200);
  expect(mehmet.body.map((c: { code: string }) => c.code)).toEqual(['BIL 211', 'BIL 304']);
  expect(mehmet.body[0]).toMatchObject({ name: 'Veri Yapıları', instructor_name: 'Doç. Dr. M. Aydın', term: 'Güz 2026', my_role: 'STUDENT',
    documents: { total: 0, ready: 0, processing: 0, failed: 0 } });
  const ayse = await h.http().get('/courses').set(await h.as('ayse')).expect(200);
  expect(ayse.body.map((c: { code: string }) => c.code)).toEqual(['BIL 211']);
  expect((await h.http().get('/courses').set(await h.as('outsider')).expect(200)).body).toEqual([]);
});

test('a non-member gets 404 (not 403) for a course; admins may view any course', async () => {
  const r = await h.http().get(`/courses/${h.world.courses.os}`).set(await h.as('ayse')).expect(404);
  expect(r.body.error.code).toBe('NOT_FOUND');
  await h.http().get(`/courses/does-not-exist`).set(await h.as('ayse')).expect(404);
  const a = await h.http().get(`/courses/${h.world.courses.os}`).set(await h.as('admin')).expect(200);
  expect(a.body.my_role).toBeNull();
  await h.http().get(`/courses/${h.world.courses.vy}`).set(await h.as('instructor')).expect(200).expect((res) => expect(res.body.my_role).toBe('INSTRUCTOR'));
});

test('course counts include COURSE documents and only my own PRIVATE ones', async () => {
  await h.uploadOk('ayse', h.world.courses.vy, { name: 'a.pdf' });
  await h.uploadOk('mehmet', h.world.courses.vy, { name: 'm.pdf', file: Buffer.from('%PDF-1.4 mehmet') });
  await h.uploadOk('instructor', h.world.courses.vy, { visibility: 'COURSE', file: Buffer.from('%PDF-1.4 course') });
  const r = await h.http().get(`/courses/${h.world.courses.vy}`).set(await h.as('ayse')).expect(200);
  expect(r.body.documents).toEqual({ total: 2, ready: 0, processing: 2, failed: 0 });
});

test('malformed identifiers are rejected before any query', async () => {
  await h.http().get('/courses/..%2F..%2Fetc').set(await h.as('ayse')).expect((res) => expect([404, 422]).toContain(res.status));
  await h.http().get(`/courses/${'x'.repeat(200)}`).set(await h.as('ayse')).expect(422);
});
