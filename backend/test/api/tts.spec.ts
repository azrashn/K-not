/** /api/tts over real HTTP + auth; the ai-service is the fake. */
import { Harness } from '../support/harness';

const h = new Harness();
const SECRET = 't'.repeat(40);
const KEY = 'ab'.repeat(32);
beforeAll(async () => { await h.start({ ttsUrlSecret: SECRET, ttsPublicPrefix: '/api' }); });
afterAll(async () => { await h.stop(); });
beforeEach(async () => {
  await h.reset();
  h.ai.on('POST', '/api/v1/tts', () => ({ status: 200, body: { key: KEY, duration_ms: 800, cached: false } }));
  h.ai.on('GET', '/api/v1/tts/audio/', () => ({ status: 200, body: 'RIFF' }));
});

test('speaking needs a login; the URL plays without one and only while its signature holds', async () => {
  await h.http().post('/tts').send({ text: 'merhaba', lang: 'tr' }).expect(401);
  await h.http().post('/tts').set(await h.as('ayse')).send({ text: 'merhaba', lang: 'de' }).expect(422);
  await h.http().post('/tts').set(await h.as('ayse')).send({ text: 'merhaba', lang: 'tr', user_id: 'x' }).expect(422);
  const r = await h.http().post('/tts').set(await h.as('ayse')).send({ text: 'merhaba', lang: 'tr' }).expect(200);
  expect(r.body.url).toMatch(new RegExp(`^/api/tts/audio/${KEY}\\.wav\\?exp=\\d+&sig=[0-9a-f]{64}$`));
  expect(h.ai.calls('POST', '/api/v1/tts')[0].headers.authorization).toBe('Bearer rag-test-token-0123456789');

  const path = r.body.url.replace(/^\/api/, '');
  const audio = await h.http().get(path).expect(200);
  expect(audio.headers['content-type']).toBe('audio/wav');
  expect(audio.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
  expect(audio.headers['x-content-type-options']).toBe('nosniff');

  await h.http().get(path.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64))).expect(404);
  await h.http().get(path.replace(/exp=\d+/, 'exp=1')).expect(404);
  await h.http().get(`/tts/audio/${KEY}.wav`).expect(404);
  expect(h.ai.calls('GET', '/api/v1/tts/audio/')).toHaveLength(1);
});
