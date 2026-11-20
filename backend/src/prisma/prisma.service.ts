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

/**
 * The MariaDB driver (used by Prisma's MySQL adapter) expects a mariadb:// URL.
 *
 * MySQL 8.4 creates accounts with caching_sha2_password. Over a plain (non-TLS) connection the driver
 * can only finish that login by fetching the server's public key; without permission it hangs and
 * surfaces as "pool timeout". On a loopback address (local development, Docker published on
 * 127.0.0.1) that is safe, so it is allowed unless the URL already decides. Remote hosts are left alone.
 */
export function mariaDbUrl(url: string): string {
  const out = url.replace(/^mysql:\/\//, 'mariadb://');
  let parsed: URL;
  try {
    parsed = new URL(out);
  } catch {
    return out;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (!loopback || parsed.searchParams.has('allowPublicKeyRetrieval')) return out;
  parsed.searchParams.set('allowPublicKeyRetrieval', 'true');
  return parsed.toString();
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
