import { loadConfig, ConfigError } from '../../src/config/config';
import { ApiError } from '../../src/common/errors';
import { AUDIO_URL_TTL_SECONDS, audioPath, expiryFor, signAudio, verifyAudio } from '../../src/tts/signed-url';
import { TtsService } from '../../src/tts/tts.service';

const SECRET = 'u'.repeat(40);
const KEY = 'ab'.repeat(32);
const NOW = 1_800_000_000;
const user = { id: 'u1', role: 'USER' as const };

describe('signed audio URLs', () => {
  test('a URL is valid for at most 24 h and stable within the hour', () => {
    const exp = expiryFor(NOW);
    expect(exp % 3600).toBe(0);
    expect(exp - NOW).toBeLessThanOrEqual(AUDIO_URL_TTL_SECONDS);
    expect(exp - NOW).toBeGreaterThan(AUDIO_URL_TTL_SECONDS - 3600);
    expect(audioPath('/api', SECRET, KEY, NOW)).toBe(audioPath('/api', SECRET, KEY, NOW + 1));
    expect(audioPath('/api/', SECRET, KEY, NOW)).toMatch(/^\/api\/tts\/audio\/[0-9a-f]{64}\.wav\?exp=\d+&sig=[0-9a-f]{64}$/);
  });

  test('only the right key, expiry and signature pass', () => {
    const exp = expiryFor(NOW);
    const sig = signAudio(SECRET, KEY, exp);
    expect(verifyAudio(SECRET, KEY, String(exp), sig, NOW)).toBe(true);
    expect(verifyAudio(SECRET, KEY, String(exp), sig, exp + 1)).toBe(false); // expired
    expect(verifyAudio(SECRET, 'cd'.repeat(32), String(exp), sig, NOW)).toBe(false); // other audio
    expect(verifyAudio('v'.repeat(40), KEY, String(exp), sig, NOW)).toBe(false); // other secret
    const far = NOW + AUDIO_URL_TTL_SECONDS + 3600;
    expect(verifyAudio(SECRET, KEY, String(far), signAudio(SECRET, KEY, far), NOW)).toBe(false); // too long
    for (const [k, e, s] of [['../x', exp, sig], [KEY, 'abc', sig], [KEY, exp, 'zz'], [KEY, exp, undefined], [KEY, [exp], sig]]) {
      expect(verifyAudio(SECRET, k as string, typeof e === 'number' ? String(e) : e, s, NOW)).toBe(false);
    }
  });
});

describe('TTS service', () => {
  const config = (over = {}) => ({ ttsUrlSecret: SECRET, ttsPublicPrefix: '/api', aiServiceUrl: 'http://ai.test', ragInternalApiToken: 'r'.repeat(20), ...over }) as any;
  const ai = (reply: any) => ({ call: jest.fn().mockResolvedValue(reply) });
  afterEach(() => jest.restoreAllMocks());

  test('speak returns a signed /api URL for the ai-service key; same text, same key', async () => {
    const client = ai({ kind: 'response', status: 200, body: { key: KEY, duration_ms: 900, cached: true } });
    const service = new TtsService(client as any, config());
    const { url } = await service.speak(user, 'y(0) = 1', 'tr');
    expect(url).toMatch(new RegExp(`^/api/tts/audio/${KEY}\\.wav\\?exp=\\d+&sig=[0-9a-f]{64}$`));
    expect(client.call).toHaveBeenCalledWith('POST', '/api/v1/tts', { body: { text: 'y(0) = 1', lang: 'tr' }, timeoutMs: 60000 });
  });

  test.each([
    [{ kind: 'timeout' }, 'PROVIDER_TIMEOUT'],
    [{ kind: 'unreachable' }, 'AI_SERVICE_UNAVAILABLE'],
    [{ kind: 'response', status: 503, body: {} }, 'AI_SERVICE_UNAVAILABLE'],
    [{ kind: 'response', status: 413, body: {} }, 'PAYLOAD_TOO_LARGE'],
    [{ kind: 'response', status: 200, body: { key: '../etc' } }, 'AI_SERVICE_UNAVAILABLE'],
  ])('upstream %j → %s', async (reply, code) => {
    await expect(new TtsService(ai(reply) as any, config()).speak(user, 'a', 'tr')).rejects.toMatchObject({ code });
  });

  test('off without a secret; rate limited per user', async () => {
    await expect(new TtsService(ai({}) as any, config({ ttsUrlSecret: null })).speak(user, 'a', 'tr')).rejects.toBeInstanceOf(ApiError);
    const service = new TtsService(ai({ kind: 'response', status: 200, body: { key: KEY } }) as any, config());
    for (let i = 0; i < 60; i++) await service.speak(user, 'a', 'tr');
    await expect(service.speak(user, 'a', 'tr')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  test('audio is fetched with the internal token only for a valid signature', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('RIFF', { status: 200 }));
    const service = new TtsService(ai({}) as any, config());
    const now = Math.floor(Date.now() / 1000), exp = expiryFor(now);
    expect(await service.audio(KEY, String(exp), signAudio(SECRET, KEY, exp), 'ip')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`http://ai.test/api/v1/tts/audio/${KEY}.wav`, expect.objectContaining({
      headers: { Authorization: `Bearer ${'r'.repeat(20)}` }, redirect: 'error' }));
    expect(await service.audio(KEY, String(exp), signAudio('x'.repeat(40), KEY, exp), 'ip')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await service.audio(KEY, String(exp), signAudio(SECRET, KEY, exp), 'ip')).toBeNull();
  });
});

describe('TTS config', () => {
  const base = { AI_SERVICE_URL: 'http://ai', DATABASE_URL: 'mysql://x/y', JWT_SECRET: 'j'.repeat(32), STORAGE_ROOT: '/tmp',
    RAG_INTERNAL_API_TOKEN: 'r'.repeat(20), INGEST_CALLBACK_TOKEN: 'c'.repeat(20) };
  test('optional, strong and distinct', () => {
    expect(loadConfig(base).ttsUrlSecret).toBeNull();
    expect(loadConfig(base).ttsPublicPrefix).toBe('/api');
    expect(loadConfig({ ...base, TTS_URL_SECRET: SECRET, TTS_PUBLIC_PREFIX: '/knot/api/' }).ttsPublicPrefix).toBe('/knot/api');
    expect(() => loadConfig({ ...base, TTS_URL_SECRET: 'short' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TTS_URL_SECRET: 'j'.repeat(32) })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TTS_PUBLIC_PREFIX: 'https://evil.test' })).toThrow(ConfigError);
  });
});
