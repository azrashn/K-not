/**
 * Admin operations as CLI (api-contracts.md §3.5 allows CLI instead of HTTP).
 *
 *   ts-node scripts/admin.ts reconcile [--apply]   orphan-chunk cleanup per non-dropped collection (dry run by default)
 *   ts-node scripts/admin.ts purge-pending         retry purges of deleted documents
 *   ts-node scripts/admin.ts sweep                 fail stalled jobs (STALLED) and apply the retry policy
 *   ts-node scripts/admin.ts index-check           compare ai-service /ready with the ACTIVE IndexVersion
 */
import { NestFactory } from '@nestjs/core';

import { AiServiceClient } from '../src/ai/ai-client';
import { IndexVersionService } from '../src/ai/index-versions';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config/config';
import { JobsService } from '../src/jobs/jobs.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  const config = { ...loadConfig(), schedulerEnabled: false };
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const jobs = app.get(JobsService);
    if (cmd === 'reconcile') {
      const live = (await prisma.document.findMany({ where: { deletedAt: null }, select: { id: true } })).map((d) => d.id);
      const ai = app.get(AiServiceClient);
      for (const iv of await prisma.indexVersion.findMany({ where: { droppedAt: null } })) {
        const r = await ai.call('POST', '/api/v1/ingestion/reconcile', {
          body: { collection: iv.collectionName, live_document_ids: live, dry_run: !args.includes('--apply'), allow_empty: false },
          timeoutMs: config.ingestionTimeoutMs,
        });
        console.log(iv.collectionName, r.kind === 'response' ? JSON.stringify({ status: r.status, ...r.body }) : r.kind);
      }
    } else if (cmd === 'purge-pending') {
      console.log('purged', await jobs.purgePending());
    } else if (cmd === 'sweep') {
      console.log('stalled', await jobs.sweepStalled());
    } else if (cmd === 'index-check') {
      console.log(JSON.stringify(await app.get(IndexVersionService).check()));
    } else {
      console.error('usage: admin.ts reconcile [--apply] | purge-pending | sweep | index-check');
      process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

void main();
