import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { APP_CONFIG, AppConfig } from '../config/config';
import { Prisma, PrismaClient } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaMariaDb(mariaDbUrl(config.databaseUrl)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** The MariaDB driver (used by Prisma's MySQL adapter) expects a mariadb:// URL. */
export function mariaDbUrl(url: string): string {
  return url.replace(/^mysql:\/\//, 'mariadb://');
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
