import { ConfigError, loadConfig } from '../../src/config/config';

const base = {
  DATABASE_URL: 'mysql://u:p@h:3306/d', JWT_SECRET: 'x'.repeat(32), STORAGE_ROOT: '/tmp/s', AI_SERVICE_URL: 'http://ai:8100/',
  RAG_INTERNAL_API_TOKEN: 'r'.repeat(16), INGEST_CALLBACK_TOKEN: 'c'.repeat(16),
};

test('defaults follow the contracts', () => {
  const c = loadConfig(base);
  expect(c).toMatchObject({ jwtTtlSeconds: 3600, uploadMaxBytes: 30 * 1024 * 1024, ingestStallTimeoutSeconds: 300, ingestMaxAutoAttempts: 3,
    answerRateLimitPerMinute: 20, answerTimeoutMs: 35_000, retrieveTimeoutMs: 10_000, ingestionTimeoutMs: 10_000, aiServiceUrl: 'http://ai:8100' });
});

test.each([
  ['missing JWT secret', { JWT_SECRET: '' }],
  ['short JWT secret', { JWT_SECRET: 'short' }],
  ['missing callback token', { INGEST_CALLBACK_TOKEN: '' }],
  ['identical internal tokens', { INGEST_CALLBACK_TOKEN: 'r'.repeat(16) }],
  ['non-http AI URL', { AI_SERVICE_URL: 'ftp://x' }],
  ['bad integer', { UPLOAD_MAX_BYTES: '30MB' }],
])('rejects %s', (_n, change) => {
  expect(() => loadConfig({ ...base, ...change })).toThrow(ConfigError);
});
