import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { IndexVersionService } from '../ai/index-versions';
import { Public } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly indexVersions: IndexVersionService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable; AI index state reported (not secret). */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'unavailable';
    }
    const ai = (await this.indexVersions.state()).state;
    res.status(db === 'ok' ? 200 : 503).json({ status: db === 'ok' ? 'ready' : 'not_ready', checks: { database: db, ai_index: ai } });
  }
}
