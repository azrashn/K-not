/**
 * The single error envelope (api-contracts.md §1, §7; document-contract.md §11):
 * {schema_version, error: {code, message, request_id, retryable, details}}.
 * No stack traces, SQL or file paths ever reach the client.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export const PUBLIC_SCHEMA_VERSION = 'api.v1';

export type PublicErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE_DOCUMENT'
  | 'JOB_ALREADY_RUNNING'
  | 'NOT_RETRYABLE'
  | 'NO_READY_DOCUMENTS'
  | 'DOCUMENT_NOT_READY'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'GENERATION_FAILED'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'INDEX_VERSION_MISMATCH'
  | 'PROVIDER_TIMEOUT';

const STATUS: Record<PublicErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  DUPLICATE_DOCUMENT: 409,
  JOB_ALREADY_RUNNING: 409,
  NOT_RETRYABLE: 409,
  NO_READY_DOCUMENTS: 409,
  DOCUMENT_NOT_READY: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  GENERATION_FAILED: 502,
  AI_SERVICE_UNAVAILABLE: 503,
  INDEX_VERSION_MISMATCH: 503,
  PROVIDER_TIMEOUT: 504,
};

const RETRYABLE = new Set<PublicErrorCode>([
  'NO_READY_DOCUMENTS', 'RATE_LIMITED', 'GENERATION_FAILED', 'AI_SERVICE_UNAVAILABLE', 'PROVIDER_TIMEOUT',
]);

export class ApiError extends HttpException {
  constructor(
    public readonly code: PublicErrorCode,
    message: string,
    public readonly details: Record<string, unknown> | null = null,
    retryable?: boolean,
  ) {
    super(message, STATUS[code]);
    this.retryable = retryable ?? RETRYABLE.has(code);
  }
  readonly retryable: boolean;
}

export const notFound = (what = 'Resource') => new ApiError('NOT_FOUND', `${what} not found.`);

export interface ErrorEnvelope {
  schema_version: string;
  error: { code: string; message: string; request_id: string | null; retryable: boolean; details: unknown };
}

export function envelope(
  code: string, message: string, requestId: string | null, retryable = false, details: unknown = null,
  schemaVersion = PUBLIC_SCHEMA_VERSION,
): ErrorEnvelope {
  return { schema_version: schemaVersion, error: { code, message, request_id: requestId, retryable, details } };
}

const FRAMEWORK_CODES: Record<number, PublicErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_ERROR',
  429: 'RATE_LIMITED',
};

/**
 * What a Prisma error says about itself, for the log only: its code (P2022, P2024…), the model and the
 * column, field or index names it names, and the database driver's error kind and code. Never the message,
 * the query or a value: those can hold personal data or request parameters.
 */
export function prismaErrorFields(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error) || !e.constructor.name.startsWith('PrismaClient')) return {};
  const x = e as Error & { code?: unknown; errorCode?: unknown; meta?: Record<string, unknown> };
  const meta = x.meta && typeof x.meta === 'object' ? x.meta : {};
  const cause = ((meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined)?.cause ?? {}) as Record<string, unknown>;
  const name = (v: unknown) =>
    typeof v === 'string' ? v.slice(0, 120)
      : Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 10).map((s) => s.slice(0, 120))
        : undefined;
  const code = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 40) : undefined);
  const out: Record<string, unknown> = {
    prisma_code: code(x.code ?? x.errorCode),
    prisma_model: name(meta.modelName),
    prisma_target: name(meta.target),
    prisma_column: name(meta.column),
    prisma_field: name(meta.field_name),
    db_error_kind: name(cause.kind),
    db_error_code: code(cause.originalCode),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req as Request & { requestId?: string }).requestId ?? null;

    if (exception instanceof ApiError) {
      res.status(exception.getStatus()).json(
        envelope(exception.code, exception.message, requestId, exception.retryable, exception.details),
      );
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = FRAMEWORK_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR');
      const body = exception.getResponse();
      // class-validator messages describe fields, never echo submitted values.
      const details = status === 400 && typeof body === 'object' && body && 'message' in body
        ? { errors: (body as { message: unknown }).message }
        : null;
      const message = code === 'VALIDATION_ERROR' ? 'The request is invalid.' : exception.message;
      res.status(STATUS[code]).json(envelope(code, message, requestId, RETRYABLE.has(code), details));
      return;
    }
    this.log.error({
      event: 'http.unhandled_error', request_id: requestId,
      error_type: exception instanceof Error ? exception.constructor.name : typeof exception,
      ...prismaErrorFields(exception),
    });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(envelope('INTERNAL_ERROR', 'Internal error.', requestId));
  }
}
