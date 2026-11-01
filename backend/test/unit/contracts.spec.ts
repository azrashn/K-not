/** Cross-language contract parity: fingerprint algorithm and callback event parsing. */
import { fingerprint } from '../../src/ai/index-versions';
import { EventValidationError, parseIngestionEvent } from '../../src/jobs/ingestion-event';
import { E5_SMALL_MVP } from '../../scripts/seed';

test('fingerprint equals the documented (Python) values', () => {
  expect(fingerprint({ backend: 'sentence_transformers', model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2', revision: null,
    dimension: 384, query_prefix: '', document_prefix: '', normalize: true, distance: 'cosine' }))
    .toBe('sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d');
  expect(fingerprint(E5_SMALL_MVP)).toBe('sha256:7858637ffe512d13b894af08f99e75f8f42be36c457e2e02192bacdfd6671616');
  expect(fingerprint({ ...E5_SMALL_MVP, query_prefix: 'query:' })).not.toBe(fingerprint(E5_SMALL_MVP));
});

const docExample = {
  schema_version: 'ingest.v1', job_id: 'cm2k8x9jb000208l4job00001', document_id: 'cm2k8x1q0000108l4h7r2c9ab', attempt: 1, seq: 7,
  worker_id: 'ai-7f3a91', type: 'SUCCEEDED', stage: 'INDEXING', progress: 1.0, emitted_at: '2026-10-07T21:14:03Z',
  result: { page_count: 3, chunk_count: 2, indexing_version: 'c1', collection: 'knot_chunks_v1',
    embedding_fingerprint: 'sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d',
    pages_artifact_key: 'documents/cm2k8x1q0000108l4h7r2c9ab/pages.c1.json' },
  error: null,
};

test('the document-contract.md IngestionEvent examples parse', () => {
  expect(parseIngestionEvent(docExample).result?.chunk_count).toBe(2);
  const failed = parseIngestionEvent({ ...docExample, seq: 3, type: 'FAILED', stage: 'EXTRACTING', progress: 0.1, result: null,
    error: { code: 'NO_TEXT_LAYER', message: 'No extractable text on 32 of 32 pages.', retryable: false } });
  expect(failed.error).toEqual({ code: 'NO_TEXT_LAYER', message: 'No extractable text on 32 of 32 pages.', retryable: false });
  expect(parseIngestionEvent({ ...docExample, type: 'HEARTBEAT', result: null, extra_future_field: 1 }).type).toBe('HEARTBEAT');
});

test.each([
  ['wrong schema', { schema_version: 'ingest.v2' }],
  ['bad job id', { job_id: '../x' }],
  ['seq 0', { seq: 0 }],
  ['float seq', { seq: 1.5 }],
  ['bad type', { type: 'DONE' }],
  ['bad stage', { stage: 'UPLOADING' }],
  ['progress > 1', { progress: 1.5 }],
  ['bad timestamp', { emitted_at: 'yesterday' }],
  ['SUCCEEDED without result', { result: null }],
  ['negative chunk count', { result: { ...docExample.result, chunk_count: -1 } }],
])('rejects %s', (_n, change) => {
  expect(() => parseIngestionEvent({ ...docExample, ...change })).toThrow(EventValidationError);
});
