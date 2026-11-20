import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID = /^[A-Za-z0-9_.:\-]{1,128}$/; // = WBS-3 rule, so the id is forwarded unchanged

export type RequestWithContext = Request & { requestId: string; user?: AuthUser };

export interface AuthUser {
  id: string;
  role: 'USER' | 'ADMIN';
}

/** Accepts/echoes `X-Request-ID` and logs one line per request (no bodies, no queries). */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly log = new Logger('http');

  use(req: Request, res: Response, next: NextFunction): void {
    const header = req.header('x-request-id') ?? '';
    const id = REQUEST_ID.test(header) ? header : randomUUID();
    (req as RequestWithContext).requestId = id;
    res.setHeader('X-Request-ID', id);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      this.log.log({
        event: 'http.request',
        request_id: id,
        method: req.method,
        route: (req.route?.path as string | undefined) ?? req.baseUrl ?? 'unmatched',
        status: res.statusCode,
        duration_ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        user_id: (req as RequestWithContext).user?.id ?? null,
      });
    });
    next();
  }
}
