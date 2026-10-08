/** Real MySQL 8 test databases: one per Jest worker (`knot_test_w<N>`), migrated with
 *  `prisma migrate deploy`, truncated between tests. Server: TEST_DATABASE_SERVER_URL. */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../../src/generated/prisma/client';
import { mariaDbUrl } from '../../src/prisma/prisma.service';

const SERVER = (process.env.TEST_DATABASE_SERVER_URL ?? 'mysql://knot:knot-dev-password@localhost:3306').replace(/\/+$/, '');
const TABLES = ['DocumentProcessingJob', 'Document', 'CourseMembership', 'Course', 'User', 'IndexVersion'];
const migrated = new Set<string>();

export function testDatabaseUrl(suffix = ''): string {
  return `${SERVER}/knot_test_w${process.env.JEST_WORKER_ID ?? '1'}${suffix}`;
}

export async function prepareDatabase(url = testDatabaseUrl()): Promise<PrismaClient> {
  if (!migrated.has(url)) {
    const dbName = url.split('/').pop()!;
    const admin = new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(`${SERVER}/mysql`)) });
    await admin.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.$disconnect();
    execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    migrated.add(url);
  }
  return new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(url)) });
}

/** Children first, so foreign keys hold on every pooled connection. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  for (const t of TABLES) await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``);
}
