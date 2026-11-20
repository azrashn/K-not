/**
 * Structured JSON logging. Messages are event names or objects with context fields only:
 * never document text, questions, answers, passwords, tokens or file contents.
 */
import { LoggerService } from '@nestjs/common';

const REDACT = /pass(word)?|token|secret|authorization|cookie|question|text|content/i;

function scrub(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.test(k) && k !== 'content_length' ? '[redacted]' : scrub(v);
  }
  return out;
}

export class JsonLogger implements LoggerService {
  constructor(private readonly minLevel: 'debug' | 'info' | 'warn' | 'error' = 'info') {}

  private static readonly ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;

  private write(level: keyof typeof JsonLogger.ORDER, message: unknown, context?: string): void {
    if (JsonLogger.ORDER[level] < JsonLogger.ORDER[this.minLevel]) return;
    const base = { ts: new Date().toISOString(), level, logger: context ?? 'app' };
    const payload = typeof message === 'object' && message !== null ? scrub(message) as object : { event: String(message) };
    process.stdout.write(JSON.stringify({ ...base, ...payload }) + '\n');
  }

  log(message: unknown, context?: string): void { this.write('info', message, context); }
  error(message: unknown, _trace?: string, context?: string): void { this.write('error', message, context); }
  warn(message: unknown, context?: string): void { this.write('warn', message, context); }
  debug(message: unknown, context?: string): void { this.write('debug', message, context); }
  verbose(message: unknown, context?: string): void { this.write('debug', message, context); }
}

export const _scrubForTest = scrub;
