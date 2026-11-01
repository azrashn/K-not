/**
 * Python → NestJS status callbacks (api-contracts.md §9). Authenticated with
 * INGEST_CALLBACK_TOKEN (a separate secret, compared in constant time), never with a user JWT.
 * Deployment must keep `/internal/*` off the public reverse proxy (WBS-9).
 */
import { Body, CanActivate, Controller, ExecutionContext, HttpCode, Inject, Injectable, Param, Post, Res, UseGuards } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

import { Public } from '../auth/auth.decorators';
import { ApiError } from '../common/errors';
import { IDENTIFIER } from '../common/validation';
import { APP_CONFIG, AppConfig } from '../config/config';
import { JobsService } from './jobs.service';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

@Injectable()
export class CallbackTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().header('authorization') ?? '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    // Hash both sides so the comparison is constant-time regardless of length.
    if (!m || !timingSafeEqual(digest(m[1]), digest(this.config.ingestCallbackToken))) {
      throw new ApiError('UNAUTHENTICATED', 'Invalid callback credentials.');
    }
    return true;
  }
}

@Public()
@UseGuards(CallbackTokenGuard)
@Controller('internal/v1/ingestion-jobs')
export class InternalCallbacksController {
  constructor(private readonly jobs: JobsService) {}

  @Post(':jobId/events')
  @HttpCode(200)
  async event(@Param('jobId') jobId: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    if (!IDENTIFIER.test(jobId)) {
      res.status(404).json({ schema_version: 'ingest.v1', error: { code: 'NOT_FOUND', message: 'Unknown job.', retryable: false } });
      return;
    }
    const r = await this.jobs.applyEvent(jobId, body);
    res.status(r.status).json(r.body);
  }
}
