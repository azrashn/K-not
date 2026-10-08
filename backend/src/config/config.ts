/**
 * Environment configuration, read and validated once at startup. Secrets are never logged.
 * Variable names follow docs/architecture/api-contracts.md §10.
 */

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  corsOrigin: string | null;
  storageRoot: string;
  aiServiceUrl: string;
  ragInternalApiToken: string;
  ingestCallbackToken: string;
  uploadMaxBytes: number;
  ingestStallTimeoutSeconds: number;
  ingestMaxAutoAttempts: number;
  schedulerEnabled: boolean;
  dispatchIntervalMs: number;
  sweepIntervalMs: number;
  purgeRetryMs: number;
  readyCheckIntervalMs: number;
  answerRateLimitPerMinute: number;
  loginRateLimitPerMinute: number;
  answerTimeoutMs: number;
  retrieveTimeoutMs: number;
  ingestionTimeoutMs: number;
}

export class ConfigError extends Error {}

function int(env: Record<string, string | undefined>, name: string, def: number, min = 0): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min) throw new ConfigError(`${name} must be an integer >= ${min}`);
  return v;
}

function bool(env: Record<string, string | undefined>, name: string, def: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function required(env: Record<string, string | undefined>, name: string, minLength = 1): string {
  const v = env[name];
  if (!v || v.length < minLength) throw new ConfigError(`${name} is required${minLength > 1 ? ` (>= ${minLength} characters)` : ''}`);
  return v;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const aiServiceUrl = required(env, 'AI_SERVICE_URL').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(aiServiceUrl)) throw new ConfigError('AI_SERVICE_URL must be an http(s) URL');
  const llmTimeoutSeconds = int(env, 'LLM_TIMEOUT_SECONDS', 30, 1);
  const cfg: AppConfig = {
    port: int(env, 'PORT', 3000, 1),
    databaseUrl: required(env, 'DATABASE_URL'),
    jwtSecret: required(env, 'JWT_SECRET', 32),
    jwtTtlSeconds: int(env, 'JWT_TTL_SECONDS', 3600, 60),
    corsOrigin: env.CORS_ORIGIN || null,
    storageRoot: required(env, 'STORAGE_ROOT'),
    aiServiceUrl,
    ragInternalApiToken: required(env, 'RAG_INTERNAL_API_TOKEN', 16),
    ingestCallbackToken: required(env, 'INGEST_CALLBACK_TOKEN', 16),
    uploadMaxBytes: int(env, 'UPLOAD_MAX_BYTES', 30 * 1024 * 1024, 1),
    ingestStallTimeoutSeconds: int(env, 'INGEST_STALL_TIMEOUT_SECONDS', 300, 1),
    ingestMaxAutoAttempts: int(env, 'INGEST_MAX_AUTO_ATTEMPTS', 3, 1),
    schedulerEnabled: bool(env, 'SCHEDULER_ENABLED', true),
    dispatchIntervalMs: int(env, 'INGEST_DISPATCH_INTERVAL_MS', 10_000, 100),
    sweepIntervalMs: int(env, 'INGEST_SWEEP_INTERVAL_MS', 30_000, 100),
    purgeRetryMs: int(env, 'PURGE_RETRY_INTERVAL_MS', 300_000, 100),
    readyCheckIntervalMs: int(env, 'AI_READY_CHECK_INTERVAL_MS', 60_000, 100),
    answerRateLimitPerMinute: int(env, 'ANSWER_RATE_LIMIT_PER_MINUTE', 20, 1),
    loginRateLimitPerMinute: int(env, 'LOGIN_RATE_LIMIT_PER_MINUTE', 10, 1),
    answerTimeoutMs: (llmTimeoutSeconds + 5) * 1000,
    retrieveTimeoutMs: int(env, 'RAG_RETRIEVE_TIMEOUT_MS', 10_000, 100),
    ingestionTimeoutMs: int(env, 'INGESTION_TIMEOUT_MS', 10_000, 100),
  };
  if (cfg.ingestCallbackToken === cfg.ragInternalApiToken) {
    throw new ConfigError('INGEST_CALLBACK_TOKEN must differ from RAG_INTERNAL_API_TOKEN');
  }
  return cfg;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
