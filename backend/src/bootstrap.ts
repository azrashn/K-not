import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { JsonLogger } from './common/logging';
import type { AppConfig } from './config/config';

export async function createApp(config: AppConfig, opts: { logger?: JsonLogger | false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: opts.logger === undefined ? new JsonLogger((process.env.LOG_LEVEL as 'info') ?? 'info') : opts.logger,
    bufferLogs: false,
  });
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '256kb' });
  if (config.corsOrigin) app.enableCors({ origin: config.corsOrigin, credentials: false, exposedHeaders: ['X-Request-ID'] });
  app.enableShutdownHooks();
  return app;
}
