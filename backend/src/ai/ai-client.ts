/**
 * NestJS → Python (ai-service) HTTP client. The internal token is attached here and only
 * here; it never leaves the server. Transport failures are classified, never thrown raw.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '../config/config';

export type AiCallResult =
  | { kind: 'response'; status: number; body: any }
  | { kind: 'timeout' }
  | { kind: 'unreachable' };

@Injectable()
export class AiServiceClient {
  private readonly log = new Logger('ai-client');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async call(method: 'GET' | 'POST' | 'DELETE', path: string, opts: { body?: unknown; timeoutMs: number; requestId?: string }): Promise<AiCallResult> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.ragInternalApiToken}`, Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.requestId) headers['X-Request-ID'] = opts.requestId;
    const started = Date.now();
    try {
      const res = await fetch(`${this.config.aiServiceUrl}${path}`, {
        method, headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      const text = await res.text();
      let body: unknown = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      this.log.log({ event: 'ai.call', method, path: path.split('?')[0], status: res.status, duration_ms: Date.now() - started, request_id: opts.requestId ?? null });
      return { kind: 'response', status: res.status, body };
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      this.log.warn({ event: 'ai.call_failed', method, path: path.split('?')[0], kind: timeout ? 'timeout' : 'unreachable', duration_ms: Date.now() - started });
      return timeout ? { kind: 'timeout' } : { kind: 'unreachable' };
    }
  }
}

export function aiErrorCode(body: any): string | null {
  const code = body?.error?.code;
  return typeof code === 'string' ? code : null;
}
