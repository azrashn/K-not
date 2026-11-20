/**
 * Strict parser for `IngestionEvent` (`ingest.v1`, document-contract.md §8). Unknown fields
 * are tolerated (additive optional fields are allowed within a version); missing or malformed
 * required fields are rejected with 422.
 */
export const STAGES = ['EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'] as const;
export const EVENT_TYPES = ['STAGE', 'HEARTBEAT', 'SUCCEEDED', 'FAILED'] as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$/;

export type Stage = (typeof STAGES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export interface IngestionEvent {
  schema_version: 'ingest.v1';
  job_id: string;
  document_id: string;
  attempt: number;
  seq: number;
  worker_id: string;
  type: EventType;
  stage: Stage | null;
  progress: number | null;
  emitted_at: string;
  result: {
    page_count: number; chunk_count: number; indexing_version: string; collection: string;
    embedding_fingerprint: string; pages_artifact_key: string; warnings?: string[] | null;
  } | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export class EventValidationError extends Error {}

const fail = (msg: string): never => {
  throw new EventValidationError(msg);
};
const isInt = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
const isStr = (v: unknown, max = 1024) => typeof v === 'string' && v.length > 0 && v.length <= max;

export function parseIngestionEvent(raw: unknown): IngestionEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('body must be an object');
  const e = raw as Record<string, any>;
  if (e.schema_version !== 'ingest.v1') fail('schema_version must be ingest.v1');
  if (!isStr(e.job_id) || !IDENTIFIER.test(e.job_id)) fail('job_id is invalid');
  if (!isStr(e.document_id) || !IDENTIFIER.test(e.document_id)) fail('document_id is invalid');
  if (!isInt(e.attempt, 1)) fail('attempt must be an integer >= 1');
  if (!isInt(e.seq, 1)) fail('seq must be an integer >= 1');
  if (!isStr(e.worker_id, 128)) fail('worker_id is required');
  if (!EVENT_TYPES.includes(e.type)) fail('type is invalid');
  if (e.stage != null && !STAGES.includes(e.stage)) fail('stage is invalid');
  if (e.progress != null && (typeof e.progress !== 'number' || e.progress < 0 || e.progress > 1)) fail('progress must be within [0, 1]');
  if (!isStr(e.emitted_at, 64) || Number.isNaN(Date.parse(e.emitted_at))) fail('emitted_at must be a timestamp');
  if (e.type === 'STAGE' && !e.stage) fail('STAGE requires a stage');

  let result: IngestionEvent['result'] = null;
  if (e.type === 'SUCCEEDED') {
    const r = e.result;
    if (!r || typeof r !== 'object') fail('SUCCEEDED requires a result');
    if (!isInt(r.page_count, 1) || !isInt(r.chunk_count, 0)) fail('result counts are invalid');
    for (const k of ['indexing_version', 'collection', 'embedding_fingerprint', 'pages_artifact_key']) {
      if (!isStr(r[k], 255)) fail(`result.${k} is required`);
    }
    result = r;
  }
  let error: IngestionEvent['error'] = null;
  if (e.type === 'FAILED') {
    const er = e.error;
    if (!er || typeof er !== 'object' || !isStr(er.code, 64) || typeof er.message !== 'string' || typeof er.retryable !== 'boolean') {
      fail('FAILED requires error {code, message, retryable}');
    }
    error = { code: er.code, message: er.message.slice(0, 500), retryable: er.retryable };
  }
  return {
    schema_version: 'ingest.v1', job_id: e.job_id, document_id: e.document_id, attempt: e.attempt, seq: e.seq,
    worker_id: e.worker_id, type: e.type, stage: e.stage ?? null, progress: e.progress ?? null,
    emitted_at: e.emitted_at, result, error,
  };
}
