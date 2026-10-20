/** Student-created personal courses: creation, ownership, edit permissions, upload into the new course. */
import { chain, Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset());

const create = (who: 'ayse' | 'mehmet' | 'outsider' | 'admin', body: Record<string, unknown>) =>
  chain(h.as(who).then((auth) => ({ test: h.http().post('/courses').set(auth).send(body) })));

test('creates a personal course: creator becomes a member and owner; code is generated when omitted', async () => {
  const r = await create('ayse', { name: '  Ayşe’nin Dersi ', instructor_name: 'Dr. X', term: 'Güz 2026', description: 'Notlarım' }).expect(201);
  expect(r.body).toMatchObject({ name: 'Ayşe’nin Dersi', instructor_name: 'Dr. X', term: 'Güz 2026', description: 'Notlarım', my_role: 'STUDENT', is_owner: true, can_edit: true });
  expect(r.body.code).toMatch(/^K-[0-9A-F]{8}$/);
  const list = await h.http().get('/courses').set(await h.as('ayse')).expect(200);
  expect(list.body.map((c: { id: string }) => c.id)).toContain(r.body.id);
  expect((await h.http().get('/courses').set(await h.as('mehmet')).expect(200)).body.map((c: { id: string }) => c.id)).not.toContain(r.body.id);
});

test('preserves enrolled courses: not owner, cannot edit', async () => {
  const list = (await h.http().get('/courses').set(await h.as('ayse')).expect(200)).body;
  expect(list[0]).toMatchObject({ code: 'BIL 211', is_owner: false, can_edit: false, description: null });
});

test('validation: name required, term defaults, explicit duplicate code conflicts', async () => {
  await create('ayse', { name: '   ' }).expect(422);
  await create('ayse', {}).expect(422);
  await create('ayse', { name: 'x', unknown: 1 }).expect(422);
  const a = await create('ayse', { name: 'Kod dersi', code: 'MY 101' }).expect(201);
  expect(a.body.term).toBe('Kişisel');
  const dup = await create('mehmet', { name: 'Başka', code: 'MY 101' }).expect(409);
  expect(dup.body.error.code).toBe('DUPLICATE_COURSE');
  await create('mehmet', { name: 'Başka', code: 'MY 101', term: 'Bahar 2027' }).expect(201);
});

test('only the owner may edit: members 403, non-members 404, seeded courses cannot be edited by students', async () => {
  const c = (await create('ayse', { name: 'Benim' }).expect(201)).body;
  const patch = (who: 'ayse' | 'mehmet' | 'outsider', id: string, body: Record<string, unknown>) =>
    chain(h.as(who).then((auth) => ({ test: h.http().patch(`/courses/${id}`).set(auth).send(body) })));
  const ok = await patch('ayse', c.id, { name: 'Yeni ad', description: '', instructor_name: 'Prof. Y' }).expect(200);
  expect(ok.body).toMatchObject({ name: 'Yeni ad', description: null, instructor_name: 'Prof. Y' });
  await patch('outsider', c.id, { name: 'hack' }).expect(404);
  await patch('ayse', h.world.courses.vy, { name: 'hack' }).expect(403);
  await patch('ayse', c.id, { name: '' }).expect(422);
  const cleared = await patch('ayse', c.id, { code: null, term: null, instructor_name: null }).expect(200);
  expect(cleared.body).toMatchObject({ code: c.code, term: c.term, instructor_name: null });
  const after = await h.http().get(`/courses/${c.id}`).set(await h.as('ayse')).expect(200);
  expect(after.body.name).toBe('Yeni ad');
});

test('the owner can upload a PDF into the new course; other users cannot', async () => {
  const c = (await create('ayse', { name: 'Yükleme' }).expect(201)).body;
  const doc = await h.uploadOk('ayse', c.id, { file: Buffer.concat([PDF, Buffer.from('x')]) });
  expect(doc.id).toBeTruthy();
  const res = await h.http().post(`/courses/${c.id}/documents`).set(await h.as('mehmet')).attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(404);
});
