/** Distinct, diagnosable failures instead of one generic 404. */
import { Harness, PDF } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start({ answerRateLimitPerMinute: 1000 }));
afterAll(() => h.stop());
beforeEach(() => h.reset());

test('an unknown route is ROUTE_NOT_FOUND, not a resource NOT_FOUND', async () => {
  const r = await h.http().post('/no-such-route').set(await h.as('ayse')).send({}).expect(404);
  expect(r.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND', details: { method: 'POST', path: '/no-such-route' } });
});

test('a missing course says which resource was not found', async () => {
  const r = await h.http().get('/courses/does-not-exist').set(await h.as('ayse')).expect(404);
  expect(r.body.error).toMatchObject({ code: 'NOT_FOUND', details: { resource: 'course' } });
  const q = await h.http().post(`/courses/${h.world.courses.os}/quizzes`).set(await h.as('ayse'))
    .send({ document_ids: ['x'], question_count: 5, question_types: ['multiple_choice'], difficulty: 'medium' }).expect(404);
  expect(q.body.error.details).toEqual({ resource: 'course' });
});

test('an ai-service that does not know the quiz route is reported as an outdated service, not a generic error', async () => {
  const id = (await h.uploadOk('ayse', h.world.courses.vy, { file: Buffer.concat([PDF, Buffer.from('z')]) })).id as string;
  await h.makeReady(id);
  h.ai.on('POST', '/api/v1/quiz/generate', () => ({ status: 404, body: { detail: 'Not Found' } }));
  const r = await h.http().post(`/courses/${h.world.courses.vy}/quizzes`).set(await h.as('ayse'))
    .send({ document_ids: [id], question_count: 5, question_types: ['multiple_choice'], difficulty: 'medium' }).expect(503);
  expect(r.body.error).toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE', details: { reason: 'ai_service_outdated' } });
});

test('a database without the latest migration is DATABASE_NOT_MIGRATED', async () => {
  await h.prisma.$executeRawUnsafe('ALTER TABLE `Course` RENAME COLUMN `description` TO `description_tmp`');
  try {
    const r = await h.http().post('/courses').set(await h.as('ayse')).send({ name: 'Migrasyon' }).expect(503);
    expect(r.body.error.code).toBe('DATABASE_NOT_MIGRATED');
  } finally {
    await h.prisma.$executeRawUnsafe('ALTER TABLE `Course` RENAME COLUMN `description_tmp` TO `description`');
  }
});
