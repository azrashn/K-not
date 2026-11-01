import { VideosService, validateVideo } from '../../src/videos/videos.service';
import type { AppConfig } from '../../src/config/config';
import { canonicalVideoLink } from '../../src/videos/video-link';
import { VideoLearningService } from '../../src/videos/video-learning.service';

const user = { id: 'student-a', role: 'USER' as const, email: 'a@example.test' };
const engine = 'up_0123456789';
const row = { id: 'local-video', courseId: 'course-a', ownerId: user.id,
  title: 'lecture.mp4', engineVideoId: engine, contentSha256: 'a'.repeat(64), createdAt: new Date() };
function fixture() {
  const prisma = { video: { findFirst: jest.fn().mockResolvedValue(row), findMany: jest.fn(), findUnique: jest.fn(),
    count: jest.fn().mockResolvedValue(1), delete: jest.fn().mockResolvedValue(row) } };
  const access = { requireMember: jest.fn().mockResolvedValue('STUDENT') };
  const service = new VideosService(prisma as any, access as any, { videoServiceUrl: 'http://127.0.0.1:7862' } as AppConfig);
  return { prisma, access, service };
}
afterEach(() => jest.restoreAllMocks());

test('foreign video cannot be removed or reach the engine', async () => {
  const { prisma, service } = fixture();
  prisma.video.findFirst.mockResolvedValue(null);
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(service.remove(user, 'course-a', row.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(prisma.video.delete).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
test('shared assets retain physical data and remove only the owned record', async () => {
  const { prisma, service } = fixture();
  prisma.video.count.mockResolvedValue(2);
  const fetch = jest.spyOn(globalThis, 'fetch');
  expect(await service.remove(user, 'course-a', row.id)).toEqual({ deleted: true, shared_asset_retained: true });
  expect(prisma.video.delete).toHaveBeenCalledWith({ where: { id: row.id } });
  expect(fetch).not.toHaveBeenCalled();
});
test('last reference is deleted only after confirmed engine cleanup', async () => {
  const { prisma, service } = fixture();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    expect(String(url)).toBe(`http://127.0.0.1:7862/api/videos/${engine}?preserve_sessions=true`);
    expect(options?.method).toBe('DELETE');
    expect(prisma.video.delete).not.toHaveBeenCalled();
    return new Response(JSON.stringify({ ok: true, video_id: engine }));
  });
  expect((await service.remove(user, 'course-a', row.id)).shared_asset_retained).toBe(false);
  expect(prisma.video.delete).toHaveBeenCalledTimes(1);
});
test.each([409, 500])('engine cleanup failure %s keeps the record for retry', async status => {
  const { prisma, service } = fixture();
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
  await expect(service.remove(user, 'course-a', row.id)).rejects.toMatchObject({
    code: status === 409 ? 'JOB_ALREADY_RUNNING' : 'AI_SERVICE_UNAVAILABLE' });
  expect(prisma.video.delete).not.toHaveBeenCalled();
});
test('retry completes when engine cleanup already finished before a previous interruption', async () => {
  const { prisma, service } = fixture();
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
  expect((await service.remove(user, 'course-a', row.id)).deleted).toBe(true);
  expect(prisma.video.delete).toHaveBeenCalledTimes(1);
});
test('interrupted deletion leaves a removable card instead of breaking the full video list', async () => {
  const { prisma, service } = fixture();
  prisma.video.findMany.mockResolvedValue([row]);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
  const result = await service.list(user, 'course-a');
  expect(result.videos[0]).toMatchObject({ id: row.id, status: 'failed' });
  expect(result.videos[0].error).toContain('Kaydı kaldırıp');
});
test('same-content uploads and cleanup serialize; the next operation is released after failure', async () => {
  const { service } = fixture();
  const order: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = (service as any).withContentLock('hash', async () => { order.push(1); await gate; order.push(2); throw new Error('failed'); });
  const second = (service as any).withContentLock('hash', async () => { order.push(3); });
  const failed = expect(first).rejects.toThrow('failed');
  await Promise.resolve(); expect(order).toEqual([1]);
  release(); await failed; await second;
  expect(order).toEqual([1, 2, 3]);
});

test('link imports rebuild fixed origins and reject SSRF, folders and playlists', () => {
  expect(canonicalVideoLink('https://youtu.be/BaW_jenozKc?t=10&list=ignored')).toBe('https://www.youtube.com/watch?v=BaW_jenozKc');
  expect(canonicalVideoLink('https://drive.google.com/open?id=0ByeS4oOUV-49Zzh4R1J6R09zazQ')).toBe('https://drive.google.com/file/d/0ByeS4oOUV-49Zzh4R1J6R09zazQ/view');
  for (const url of ['http://127.0.0.1/', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc',
    'https://youtube.com@127.0.0.1/watch?v=BaW_jenozKc', 'https://www.youtube.com/playlist?list=x',
    'https://drive.google.com/drive/folders/abcdef', 'https://youtu.be:8080/BaW_jenozKc']) {
    expect(() => canonicalVideoLink(url)).toThrow('HTTPS');
  }
});
test('non-members cannot trigger link downloads', async () => {
  const { access, service } = fixture();
  access.requireMember.mockRejectedValue(new Error('not a member'));
  const fetch = jest.spyOn(globalThis, 'fetch');
  await expect(service.importLink(user, 'other-course', 'https://youtu.be/BaW_jenozKc')).rejects.toThrow('not a member');
  expect(fetch).not.toHaveBeenCalled();
});
test('imported video uses existing private upload path and strips remote title controls', async () => {
  const { service } = fixture();
  const bytes = Buffer.from('0000ftyp0000');
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes, { headers: {
    'x-video-title': encodeURIComponent('A/lecture\n'), 'x-video-extension': '.mp4' } }));
  const upload = jest.spyOn(service, 'upload').mockResolvedValue({ id: 'private-row' } as any);
  await service.importLink(user, 'course-a', 'https://youtu.be/BaW_jenozKc');
  expect(upload).toHaveBeenCalledWith(user, 'course-a', expect.objectContaining({ originalname: 'A lecture.mp4', buffer: bytes }));
});
test('download failure is actionable and releases the import slot', async () => {
  const { service } = fixture();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 413 }));
  for (let n = 0; n < 2; n++) {
    await expect(service.importLink(user, 'course-a', 'https://youtu.be/BaW_jenozKc')).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  }
});
test('streaming downloads are capped even without a content-length header', async () => {
  const { service } = fixture();
  const cancel = jest.fn();
  let chunks = 0;
  const block = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({ pull(controller) {
    if (chunks++ < 101) controller.enqueue(block); else controller.close();
  }, cancel });
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream));
  const upload = jest.spyOn(service, 'upload');
  await expect(service.importLink(user, 'course-a', 'https://youtu.be/BaW_jenozKc')).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  expect(upload).not.toHaveBeenCalled();
});

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
  const { prisma, access } = fixture();
  const service = new VideoLearningService(prisma as any, access as any, {} as AppConfig);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ video_id: engine, duration_ms: 100000,
    citations: [{ video_id: 'up_aaaaaaaaaa', n: 1, ms: 1000, t_start: 1, t_end: 2 }] }), { status: 200 }));
  await expect(service.ask(user, 'course-a', row.id, 'question')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
});
test('valid citations map to local IDs without exposing engine URLs or upgrading support', async () => {
  const { prisma, access } = fixture();
  const service = new VideoLearningService({ ...prisma, videoProgress: { findUnique: jest.fn().mockResolvedValue({ intervals: [] }) } } as any, access as any, {} as AppConfig);
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ video_id: engine, duration_ms: 100000, selection_id: 'a'.repeat(32),
    citations: [{ video_id: engine, n: 1, idx: 2, ms: 10000, t_start: 9, t_end: 12,
      transcript: 'quote', media_url: 'http://internal.example/video', owner: 'local' }] }), { status: 200 }));
  const result = await service.ask(user, 'course-a', row.id, 'question');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).video_id).toBe(engine);
  expect(result.support_confirmed).toBe(false);
  expect(result.citations[0]).toMatchObject({ video_id: row.id, timestamp_ms: 10000, frame_index: 2 });
  expect(JSON.stringify(result)).not.toContain('internal.example');
});
