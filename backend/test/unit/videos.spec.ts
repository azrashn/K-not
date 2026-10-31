import { VideosService, validateVideo } from '../../src/videos/videos.service';
import type { AppConfig } from '../../src/config/config';

const user = { id: 'student-a', role: 'USER' as const, email: 'a@example.test' };
const engine = 'up_0123456789';
const row = { id: 'local-video', courseId: 'course-a', ownerId: user.id,
  title: 'lecture.mp4', engineVideoId: engine, createdAt: new Date() };
function fixture() {
  const prisma = { video: { findFirst: jest.fn().mockResolvedValue(row), findMany: jest.fn(), findUnique: jest.fn() } };
  const access = { requireMember: jest.fn().mockResolvedValue('STUDENT') };
  const service = new VideosService(prisma as any, access as any, { videoServiceUrl: 'http://127.0.0.1:7862' } as AppConfig);
  return { prisma, access, service };
}
afterEach(() => jest.restoreAllMocks());

test('rejects spoofed video extensions before contacting the engine', () => {
  expect(() => validateVideo({ originalname: 'lecture.mp4', size: 5, buffer: Buffer.from('%PDF-') } as any)).toThrow('MP4');
});
test('non-members cannot read a transcript or contact the engine', async () => {
  const { access, service } = fixture();
  access.requireMember.mockRejectedValue(new Error('not a member'));
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(service.transcript(user, 'other-course', row.id)).rejects.toThrow('not a member');
  expect(fetch).not.toHaveBeenCalled();
});
test('private video lookup requires both uploader and course', async () => {
  const { prisma, service } = fixture();
  prisma.video.findFirst.mockResolvedValue(null);
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(service.media(user, 'course-a', 'foreign-video')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(prisma.video.findFirst).toHaveBeenCalledWith({ where: { id: 'foreign-video', courseId: 'course-a', ownerId: user.id } });
  expect(fetch).not.toHaveBeenCalled();
});
test('upstream citation leakage fails closed', async () => {
  const { service } = fixture();
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: 'do not show',
    citations: [{ video_id: 'up_aaaaaaaaaa', n: 1, ms: 1000, t_start: 1, t_end: 2 }] }), { status: 200 }));
  await expect(service.ask(user, 'course-a', row.id, 'question')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
});
test('valid citations map to local IDs without exposing engine URLs or upgrading support', async () => {
  const { service } = fixture();
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: 'experimental', llm_used: true,
    citations: [{ video_id: engine, n: 1, idx: 2, ms: 10000, t_start: 9, t_end: 12,
      transcript: 'quote', media_url: 'http://internal.example/video', owner: 'local' }] }), { status: 200 }));
  const result = await service.ask(user, 'course-a', row.id, 'question');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).video_ids).toEqual([engine]);
  expect(result.support_confirmed).toBe(false);
  expect(result.citations[0]).toMatchObject({ video_id: row.id, timestamp_ms: 10000, frame_index: 2 });
  expect(JSON.stringify(result)).not.toContain('internal.example');
});
