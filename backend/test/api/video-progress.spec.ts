import { Harness } from '../support/harness';
import { VideosService } from '../../src/videos/videos.service';
const h = new Harness();
let id: string;
beforeAll(async () => h.start());
afterAll(async () => h.stop());
beforeEach(async () => {
  await h.reset();
  id = 'progress-test-video';
  await h.prisma.video.create({ data: { id, ownerId: h.world.users.ayse, courseId: h.world.courses.vy,
    title: 'Test video', originalFilename: 'test.mp4', contentSha256: 'a'.repeat(64),
    engineVideoId: 'up_0123456789', durationMs: 100000 } });
});
const route = () => `/courses/${h.world.courses.vy}/videos/${id}/progress`;
test('anonymous and other-user progress reads/writes fail', async () => {
  await h.http().get(route()).expect(401);
  await h.http().get(route()).set(await h.as('mehmet')).expect(404);
  await h.http().put(route()).set(await h.as('mehmet')).send({ position_ms: 0, intervals: [] }).expect(404);
});
test('multipart parser preserves Turkish video filenames before the engine boundary', async () => {
  const upload = jest.spyOn(h.app.get(VideosService), 'upload').mockImplementation(async (_u, _c, file) => ({ title: file?.originalname }) as any);
  try {
    const response = await h.http().post(`/courses/${h.world.courses.vy}/videos`).set(await h.as('ayse'))
      .attach('file', Buffer.from('0000ftyp0000'), 'İğüş — ders.mp4').expect(201);
    expect(response.body.title).toBe('İğüş — ders.mp4');
  } finally { upload.mockRestore(); }
});
test('real database keeps the seek gap and last position across GET requests', async () => {
  await h.http().put(route()).set(await h.as('ayse')).send({ position_ms: 90000, intervals: [{ start_ms: 0, end_ms: 5000 }] }).expect(200);
  const result = await h.http().get(route()).set(await h.as('ayse'));
  expect(result.body.position_ms).toBe(90000);
  expect(result.body.watched_ms).toBe(5000);
  expect(result.body.intervals).toEqual([{ start_ms: 0, end_ms: 5000 }]);
});
test('invalid ranges and spoofed duration are rejected without a database write', async () => {
  await h.http().put(route()).set(await h.as('ayse')).send({ position_ms: 0, intervals: [], duration_ms: 900000 }).expect(422);
  await h.http().put(route()).set(await h.as('ayse')).send({ position_ms: 100001, intervals: [] }).expect(422);
  await h.http().put(route()).set(await h.as('ayse')).send({ position_ms: 0, intervals: [{ start_ms: 4000, end_ms: 3000 }] }).expect(422);
  expect(await h.prisma.videoProgress.count()).toBe(0);
});
test('concurrent writes union observations and replays remain idempotent', async () => {
  const first = { position_ms: 5000, intervals: [{ start_ms: 0, end_ms: 5000 }] };
  const second = { position_ms: 25000, intervals: [{ start_ms: 20000, end_ms: 25000 }] };
  const auth = await h.as('ayse');
  await Promise.all([h.http().put(route()).set(auth).send(first).expect(200), h.http().put(route()).set(auth).send(second).expect(200)]);
  await h.http().put(route()).set(auth).send(first).expect(200);
  const result = await h.http().get(route()).set(auth);
  expect(result.body.watched_ms).toBe(10000);
  expect(result.body.intervals).toHaveLength(2);
});
