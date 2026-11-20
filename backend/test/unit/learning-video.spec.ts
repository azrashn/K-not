import { classifyLearning } from '../../src/videos/learning-state';
import { VideoLearningService } from '../../src/videos/video-learning.service';
import type { AppConfig } from '../../src/config/config';

const user = { id: 'owner', role: 'USER' as const };
const span = { start_ms: 100000, end_ms: 120000 };
const cite = { n: 1, video_id: 'up_0123456789', ms: 100000, t_start: 100, t_end: 120, idx: null, transcript: 'Dijkstra: tek kaynaktan en kısa yollar.' };
const evidence = { video_id: cite.video_id, duration_ms: 600000, selection_id: 'a'.repeat(32),
  reason: 'EXPLICIT_SOURCE_SUBJECT', citations: [cite], source_warnings: [], background_references: [] };
function fixture(intervals: any = []) {
  const prisma = { video: { findFirst: jest.fn().mockResolvedValue({ id: 'video', title: 'Lesson', engineVideoId: cite.video_id }) },
    videoProgress: { findUnique: jest.fn().mockResolvedValue(intervals === null ? null : { intervals, positionMs: 599000, revision: 1 }) } };
  const access = { requireMember: jest.fn().mockResolvedValue('STUDENT') };
  return { prisma, access, service: new VideoLearningService(prisma as any, access as any, {} as AppConfig) };
}
afterEach(() => jest.restoreAllMocks());
test.each([
  [[], 'UNWATCHED'], [[{ start_ms: 100000, end_ms: 120000 }], 'WATCHED'],
  [[{ start_ms: 100000, end_ms: 105000 }], 'PARTIALLY_WATCHED'],
  [[{ start_ms: 0, end_ms: 5000 }, { start_ms: 130000, end_ms: 140000 }], 'UNWATCHED'],
  [null, 'UNKNOWN'],
])('source coverage %j => %s independent of last position', (intervals, expected) => {
  expect(classifyLearning(span, intervals).state).toBe(expected);
});
test('missing timestamp and malformed observations are UNKNOWN', () => {
  expect(classifyLearning(null, []).state).toBe('UNKNOWN');
  expect(classifyLearning(span, [{ start_ms: 200, end_ms: 100 }]).state).toBe('UNKNOWN');
});
test('overlapping/repeated observations cannot inflate source coverage', () => {
  expect(classifyLearning(span, [{ start_ms: 100000, end_ms: 110000 }, { start_ms: 100000, end_ms: 110000 }])).toEqual({ state: 'PARTIALLY_WATCHED', coverage: .5 });
});
test.each([[], [{ start_ms: 100000, end_ms: 105000 }], null])('unwatched/partial/unknown never calls explanation automatically', async intervals => {
  const { service } = fixture(intervals);
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(evidence)));
  const response = await service.ask(user, 'course', 'video', 'Dijkstra nedir?', { current_time_ms: 1000 });
  expect(response.status).toBe('GUIDANCE'); expect(response.llm_used).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ question: 'Dijkstra nedir?', video_id: cite.video_id, current_time_ms: 1000 });
});
test('explain now uses server-held sources and rereads progress', async () => {
  const { service, prisma } = fixture([]);
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const payload = JSON.parse(init!.body as string);
    return new Response(JSON.stringify(payload.selection_id ? { answer: 'Kaynaklı açıklama [1]', citations: [cite], llm_used: true, generation_status: 'GENERATED_UNVERIFIED' } : evidence));
  });
  const first = await service.ask(user, 'course', 'video', 'Dijkstra nedir?');
  prisma.videoProgress.findUnique.mockResolvedValue({ intervals: [{ start_ms: 100000, end_ms: 120000 }], revision: 2 });
  const answer = await service.ask(user, 'course', 'video', 'Dijkstra nedir?', { explain_now: true, evidence_id: first.evidence_id! });
  expect(answer.status).toBe('EXPLANATION'); expect(answer.learning_state).toBe('WATCHED');
  expect(answer.answer).toContain('[1]'); expect(answer.support_confirmed).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2); expect(prisma.videoProgress.findUnique).toHaveBeenCalledTimes(2);
});
test('watched sources call explanation on the initial request', async () => {
  const { service } = fixture([{ start_ms: 100000, end_ms: 120000 }]);
  jest.spyOn(globalThis, 'fetch').mockImplementation(async url => new Response(JSON.stringify(String(url).endsWith('video-evidence') ? evidence : { answer: 'Kaynak [1]', citations: [cite], llm_used: true })));
  expect((await service.ask(user, 'course', 'video', 'Dijkstra nedir?')).status).toBe('EXPLANATION');
});
test('foreign owner cannot reuse an evidence receipt', async () => {
  const { service, prisma } = fixture([]);
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(evidence)));
  const first = await service.ask(user, 'course', 'video', 'Dijkstra nedir?');
  prisma.video.findFirst.mockResolvedValue(null);
  await expect(service.ask({ ...user, id: 'other' }, 'course', 'video', 'Dijkstra nedir?', { explain_now: true, evidence_id: first.evidence_id! })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('same asset owned by another user still cannot reuse a receipt', async () => {
  const { service } = fixture([]);
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(evidence)));
  const first = await service.ask(user, 'course', 'video', 'Dijkstra nedir?');
  await expect(service.ask({ ...user, id: 'other' }, 'course', 'video', 'Dijkstra nedir?', { explain_now: true, evidence_id: first.evidence_id! })).rejects.toMatchObject({ code: 'NOT_RETRYABLE' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('no timestamp returns UNKNOWN and never generates an answer', async () => {
  const { service } = fixture([]);
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...evidence, citations: [], selection_id: null })));
  const result = await service.ask(user, 'course', 'video', 'Missing topic');
  expect(result.learning_state).toBe('UNKNOWN'); expect(result.relevant_segment).toBeNull(); expect(result.status).toBe('NO_RELIABLE_EVIDENCE');
  expect(fetch).toHaveBeenCalledTimes(1);
});
