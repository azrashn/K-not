import { mergeWatched, progressView } from '../../src/videos/watch-intervals';
import { VideoProgressService } from '../../src/videos/video-progress.service';
import type { AppConfig } from '../../src/config/config';

const user = { id: 'owner', role: 'USER' as const };
const video = { id: 'video', courseId: 'course', ownerId: user.id, engineVideoId: 'up_0123456789', durationMs: 100000 };
const interval = (start_ms: number, end_ms: number) => ({ start_ms, end_ms });
function fixture() {
  const prisma = { video: { findFirst: jest.fn().mockResolvedValue(video), update: jest.fn() },
    videoProgress: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(async ({ data }) => data), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const access = { requireMember: jest.fn().mockResolvedValue('STUDENT') };
  return { prisma, access, service: new VideoProgressService(prisma as any, access as any, {} as AppConfig) };
}
afterEach(() => jest.restoreAllMocks());

test('union merges overlap/replay without filling a seek gap', () => {
  const source = [interval(20000, 25000), interval(1000, 5000), interval(0, 2000), interval(25000, 30000), interval(0, 2000)];
  expect(mergeWatched(source, 100000)).toEqual([interval(0, 5000), interval(20000, 30000)]);
  expect(source[0].end_ms).toBe(25000);
});
test.each([[-1, 4], [4, 4], [8, 3], [0, 100001], [0.5, 4], [NaN, 4]])('invalid interval %s–%s is rejected', (start, end) => {
  expect(() => mergeWatched([interval(start, end)], 100000)).toThrow();
});
test('last position never upgrades watched percentage or proves mastery', () => {
  const result = progressView(video.id, 100000, { positionMs: 90000, intervals: [interval(0, 5000)], revision: 1 });
  expect(result.watched_percent).toBe(5);
  expect(result.position_ms).toBe(90000);
  expect(result.observation).toBe('MEDIA_PLAYBACK_ONLY');
});
test('progress is scoped to owner and course before any engine access', async () => {
  const { prisma, service } = fixture(); prisma.video.findFirst.mockResolvedValue(null);
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(service.get(user, 'wrong-course', video.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(prisma.video.findFirst).toHaveBeenCalledWith({ where: { id: video.id, courseId: 'wrong-course', ownerId: user.id } });
  expect(fetch).not.toHaveBeenCalled(); expect(prisma.videoProgress.findUnique).not.toHaveBeenCalled();
});
test('cached server duration keeps progress reads independent of model/engine', async () => {
  const { service } = fixture(); const fetch = jest.spyOn(globalThis, 'fetch');
  expect((await service.get(user, 'course', video.id)).duration_ms).toBe(100000);
  expect(fetch).not.toHaveBeenCalled();
});
test('first save persists a small interval with independent playback position', async () => {
  const { service, prisma } = fixture();
  const result = await service.save(user, 'course', video.id, 80000, [interval(0, 5000)]);
  expect(result.watched_ms).toBe(5000); expect(result.position_ms).toBe(80000);
  expect(prisma.videoProgress.create).toHaveBeenCalledWith({ data: { videoId: video.id, userId: user.id,
    positionMs: 80000, intervals: [interval(0, 5000)], revision: 1 } });
});
test('concurrent revision conflict reloads and unions the other tabs intervals', async () => {
  const { service, prisma } = fixture();
  prisma.videoProgress.findUnique.mockResolvedValueOnce({ positionMs: 0, intervals: [], revision: 1 })
    .mockResolvedValueOnce({ positionMs: 5000, intervals: [interval(0, 5000)], revision: 2 });
  prisma.videoProgress.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
  const result = await service.save(user, 'course', video.id, 25000, [interval(20000, 25000)]);
  expect(result.intervals).toEqual([interval(0, 5000), interval(20000, 25000)]);
  expect(result.revision).toBe(3);
});
test('untrusted positions and oversized observation batches are rejected', async () => {
  const { service, prisma } = fixture();
  await expect(service.save(user, 'course', video.id, 100001, [])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await expect(service.save(user, 'course', video.id, 0, Array(61).fill(interval(0, 1)))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  expect(prisma.videoProgress.create).not.toHaveBeenCalled();
});
test('duration comes from scoped engine metadata, not request body', async () => {
  const { service, prisma } = fixture(); prisma.video.findFirst.mockResolvedValue({ ...video, durationMs: null });
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ video_id: video.engineVideoId, duration_ms: 123456 })));
  expect((await service.get(user, 'course', video.id)).duration_ms).toBe(123456);
  expect(prisma.video.update).toHaveBeenCalledWith({ where: { id: video.id }, data: { durationMs: 123456 } });
});
test('wrong engine identity never changes duration', async () => {
  const { service, prisma } = fixture(); prisma.video.findFirst.mockResolvedValue({ ...video, durationMs: null });
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ video_id: 'up_aaaaaaaaaa', duration_ms: 123456 })));
  await expect(service.get(user, 'course', video.id)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  expect(prisma.video.update).not.toHaveBeenCalled();
});
