import type { AiCallResult, AiServiceClient } from '../../src/ai/ai-client';
import { IndexVersionService } from '../../src/ai/index-versions';
import type { AppConfig } from '../../src/config/config';
import type { PrismaService } from '../../src/prisma/prisma.service';

const FP = 'sha256:7858637ffe512d13b894af08f99e75f8f42be36c457e2e02192bacdfd6671616';
const IV = { id: 'cmvgoka8u00061wu3atwinewl', collectionName: 'knot_chunks_v1', embeddingFingerprint: FP, status: 'ACTIVE' };

function guardFor(ready: AiCallResult) {
  const prisma = { indexVersion: { findFirst: async () => IV } } as unknown as PrismaService;
  const ai = { call: async () => ready } as unknown as AiServiceClient;
  return new IndexVersionService(prisma, ai, { readyCheckIntervalMs: 10_000 } as AppConfig);
}

const notReady = (index: Record<string, unknown>): AiCallResult => ({
  kind: 'response',
  status: 503,
  body: { status: 'not_ready', checks: { index: 'RETRIEVAL_UNAVAILABLE', index_reason: 'chroma_http_unreachable localhost:8000' }, index },
});

test('stamp "unknown" with the configured fingerprint is not a mismatch (nothing indexed or Chroma down)', async () => {
  const g = guardFor(notReady({ collection: 'knot_chunks_v1', embedding_fingerprint: FP, index_version_id: null, stamp: 'unknown' }));
  expect((await g.check()).state).toBe('ok');
});

test('stamp "unknown" without any fingerprint is unavailable, not a mismatch', async () => {
  const g = guardFor(notReady({ collection: 'knot_chunks_v1', embedding_fingerprint: null, index_version_id: null, stamp: 'unknown' }));
  expect((await g.check()).state).toBe('unavailable');
});

test('stamp "unknown" still flags a configured fingerprint that differs', async () => {
  const g = guardFor(notReady({ collection: 'knot_chunks_v1', embedding_fingerprint: 'sha256:' + 'f'.repeat(64), index_version_id: null, stamp: 'unknown' }));
  expect(await g.check()).toMatchObject({ state: 'mismatch', reason: 'embedding fingerprint differs from the ACTIVE IndexVersion' });
});

test('a full stamp from another index version is a mismatch', async () => {
  const g = guardFor({ kind: 'response', status: 200,
    body: { status: 'ready', index: { collection: 'knot_chunks_v1', embedding_fingerprint: FP, index_version_id: 'other', stamp: 'full' } } });
  expect(await g.check()).toMatchObject({ state: 'mismatch', reason: 'collection is stamped with another index version' });
});

test('a pre-C-1 service without stamp keeps the old rule: missing fingerprint is a mismatch', async () => {
  const g = guardFor(notReady({ collection: 'knot_chunks_v1', embedding_fingerprint: null, index_version_id: null }));
  expect((await g.check()).state).toBe('mismatch');
});

test('unreachable ai-service is unavailable', async () => {
  expect((await guardFor({ kind: 'unreachable' }).check()).state).toBe('unavailable');
});
