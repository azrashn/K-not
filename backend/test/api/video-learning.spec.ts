/** Real Nest + MySQL; only the video evidence/model boundary is a fake. */
import { Harness } from '../support/harness';
import { FakeAiService } from '../support/fake-ai';
const h = new Harness(), engine = new FakeAiService();
const vid = 'learning-video', engineId = 'up_0123456789';
const citation = { n: 1, video_id: engineId, ms: 100000, t_start: 100, t_end: 120, idx: null,
  transcript: 'Dijkstra tek kaynaktan en kısa yolları bulur.' };
const evidence = { video_id: engineId, duration_ms: 200000, selection_id: 'a'.repeat(32),
  reason: 'EXPLICIT_SOURCE_SUBJECT', citations: [citation], source_warnings: [], background_references: [] };
beforeAll(async () => { await engine.start(); await h.start({ videoServiceUrl: engine.url }); });
afterAll(async () => { await h.stop(); await engine.stop(); });
beforeEach(async () => {
  await h.reset(); engine.reset();
  await h.prisma.video.create({ data: { id: vid, ownerId: h.world.users.ayse, courseId: h.world.courses.vy,
    engineVideoId: engineId, title: 'Lesson', originalFilename: 'test.mp4', contentSha256: 'a'.repeat(64), durationMs: 200000 } });
  engine.on('POST', '/api/local/video-evidence', () => ({ status: 200, body: evidence }));
  engine.on('POST', '/api/local/video-explanation', () => ({ status: 200, body: { answer: 'Kaynaklı açıklama [1]', citations: [citation], llm_used: true } }));
});
const route = () => `/courses/${h.world.courses.vy}/videos/${vid}/answers`;
async function progress(intervals: any[]) {
  await h.prisma.videoProgress.create({ data: { videoId: vid, userId: h.world.users.ayse, positionMs: 180000, intervals, revision: 1 } });
}
test.each([
  [[], 'UNWATCHED'], [[{ start_ms: 100000, end_ms: 120000 }], 'WATCHED'],
  [[{ start_ms: 100000, end_ms: 105000 }], 'PARTIALLY_WATCHED'],
  [[{ start_ms: 0, end_ms: 5000 }, { start_ms: 140000, end_ms: 150000 }], 'UNWATCHED'],
])('real progress %j classifies %s', async (intervals, state) => {
  await progress(intervals);
  const r = await h.http().post(route()).set(await h.as('ayse')).send({ question: 'Dijkstra nedir?', current_time_ms: 1000 }).expect(200);
  expect(r.body.learning_state).toBe(state);
  expect(r.body.relevant_segment.start_ms).toBe(100000);
  const calls = engine.requests.filter(r => r.path.endsWith('video-explanation'));
  expect(calls).toHaveLength(state === 'WATCHED' ? 1 : 0);
});
test('missing progress is UNKNOWN and does not invoke generation', async () => {
  const r = await h.http().post(route()).set(await h.as('ayse')).send({ question: 'Dijkstra nedir?' }).expect(200);
  expect(r.body.learning_state).toBe('UNKNOWN'); expect(r.body.llm_used).toBe(false);
});
test('missing relevant timestamp stays UNKNOWN', async () => {
  engine.on('POST', '/api/local/video-evidence', () => ({ status: 200, body: { ...evidence, citations: [], selection_id: null } }));
  const r = await h.http().post(route()).set(await h.as('ayse')).send({ question: 'Missing' }).expect(200);
  expect(r.body.learning_state).toBe('UNKNOWN'); expect(r.body.relevant_segment).toBeNull();
});
test('explicit explanation after UNWATCHED is sourced and rechecks identity', async () => {
  await progress([]);
  const auth = await h.as('ayse');
  const first = await h.http().post(route()).set(auth).send({ question: 'Dijkstra nedir?' }).expect(200);
  await h.http().post(route()).set(await h.as('mehmet')).send({ question: 'Dijkstra nedir?', explain_now: true, evidence_id: first.body.evidence_id }).expect(404);
  const r = await h.http().post(route()).set(auth).send({ question: 'Dijkstra nedir?', explain_now: true, evidence_id: first.body.evidence_id }).expect(200);
  expect(r.body.answer).toContain('[1]'); expect(r.body.learning_state).toBe('UNWATCHED'); expect(r.body.support_confirmed).toBe(false);
});
test('browser cannot send watched data or identity; foreign users cannot generate', async () => {
  await h.http().post(route()).send({ question: 'test' }).expect(401);
  await h.http().post(route()).set(await h.as('ayse')).send({ question: 'test', user_id: h.world.users.mehmet, watched_percent: 100 }).expect(422);
  await h.http().post(route()).set(await h.as('mehmet')).send({ question: 'test' }).expect(404);
  expect(engine.requests).toHaveLength(0);
});
