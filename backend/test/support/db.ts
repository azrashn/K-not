/** Real MySQL 8 test databases: one per Jest worker (`knot_test_w<N>`), migrated with
 *  `prisma migrate deploy`, truncated between tests. Server: TEST_DATABASE_SERVER_URL. */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { PrismaClient } from '../../src/generated/prisma/client';
import { mariaDbUrl } from '../../src/prisma/prisma.service';

const SERVER = (process.env.TEST_DATABASE_SERVER_URL ?? 'mysql://knot:knot-dev-password@localhost:3306').replace(/\/+$/, '');
const TABLES = ['StudyMaterial', 'VideoProgress', 'Video', 'DocumentProcessingJob', 'Document', 'CourseMembership', 'Course', 'User', 'IndexVersion'];
const migrated = new Set<string>();
const testClients = new WeakSet<PrismaClient>();

export function requireTestDatabase(url: string): string {
  const name = new URL(url).pathname.slice(1);
  if (!/^knot_test_w\d+(?:_[A-Za-z0-9_]+)?$/.test(name)) throw new Error('Refusing to modify a database outside knot_test_w<N>.');
  return name;
}

export function testDatabaseUrl(suffix = ''): string {
  const run = process.env.TEST_DATABASE_RUN_ID;
  if (run && !/^[A-Za-z0-9_]+$/.test(run)) throw new Error('Invalid test database run ID.');
  return `${SERVER}/knot_test_w${process.env.JEST_WORKER_ID ?? '1'}${run ? '_' + run : ''}${suffix}`;
}

export async function prepareDatabase(url = testDatabaseUrl()): Promise<PrismaClient> {
  const dbName = requireTestDatabase(url);
  if (!migrated.has(url)) {
    if (process.env.TEST_DATABASE_PRECREATED !== 'true') {
      const admin = new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(`${SERVER}/mysql`)) });
      try { await admin.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`); }
      finally { await admin.$disconnect(); }
    }
    execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '../..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
    migrated.add(url);
  }
  const client = new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(url)) });
  testClients.add(client);
  return client;
}

/** Children first, so foreign keys hold on every pooled connection. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  if (!testClients.has(prisma)) throw new Error('Refusing cleanup for a non-test Prisma client.');
  for (const t of TABLES) await prisma.$executeRawUnsafe(`DELETE FROM \`${t}\``);
}
