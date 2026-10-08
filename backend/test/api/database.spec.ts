/** Migrations and the relational constraints the lifecycle relies on (data-model.md §2–§4). */
import { Harness } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start());
afterAll(() => h.stop());
beforeEach(() => h.reset());

const doc = (id: string, extra: Record<string, unknown> = {}) => ({
  id, courseId: h.world.courses.vy, ownerId: h.world.users.ayse, documentType: 'slide', title: 't', originalFilename: 'a.pdf',
  mimeType: 'application/pdf', sizeBytes: 10, contentSha256: 'a'.repeat(64), activeContentHash: 'a'.repeat(64),
  storageKey: `documents/${id}/original.pdf`, ...extra,
});

test('all migrations are applied and the schema has the binding tables', async () => {
  const rows = await h.prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
    'SELECT migration_name, finished_at FROM _prisma_migrations');
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((r) => r.finished_at)).toBe(true);
  const tables = await h.prisma.$queryRawUnsafe<{ t: string }[]>('SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  expect(tables.map((r) => r.t)).toEqual(expect.arrayContaining(['User', 'Course', 'CourseMembership', 'Document', 'DocumentProcessingJob', 'IndexVersion']));
});

test('dedup key: same owner+course+hash is unique, but deleted rows (NULL hash) never conflict', async () => {
  await h.prisma.document.create({ data: doc('doc-1') });
  await expect(h.prisma.document.create({ data: doc('doc-2') })).rejects.toMatchObject({ code: 'P2002' });
  await h.prisma.document.update({ where: { id: 'doc-1' }, data: { activeContentHash: null, deletedAt: new Date() } });
  await h.prisma.document.create({ data: doc('doc-2') });
  await h.prisma.document.update({ where: { id: 'doc-2' }, data: { activeContentHash: null, deletedAt: new Date() } });
  await h.prisma.document.create({ data: doc('doc-3') }); // two NULL rows coexist
  await h.prisma.document.create({ data: doc('doc-4', { ownerId: h.world.users.mehmet }) }); // other owner: allowed
});

test('activeJobId is unique and course code+term is unique', async () => {
  await h.prisma.document.create({ data: doc('doc-1', { activeJobId: 'job-x' }) });
  await expect(h.prisma.document.create({ data: doc('doc-2', { activeJobId: 'job-x', activeContentHash: 'b'.repeat(64) }) }))
    .rejects.toMatchObject({ code: 'P2002' });
  await expect(h.prisma.course.create({ data: { code: 'BIL 211', name: 'x', term: 'Güz 2026' } })).rejects.toMatchObject({ code: 'P2002' });
});

test('Turkish text round-trips through utf8mb4', async () => {
  await h.prisma.document.create({ data: doc('doc-tr', { title: 'Hafta 4 — AVL Ağaçları ığüşöç İĞÜŞÖÇ 𝑛' }) });
  expect((await h.prisma.document.findUniqueOrThrow({ where: { id: 'doc-tr' } })).title).toBe('Hafta 4 — AVL Ağaçları ığüşöç İĞÜŞÖÇ 𝑛');
});
