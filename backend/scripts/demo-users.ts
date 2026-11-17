/**
 * Local demo accounts in ONE command: creates/updates the example users and courses with a known, easy
 * password and checks that the login actually works. For a developer's own machine only: it refuses to run
 * against a database that is not on this computer.
 *
 *   npm run demo:users                      (from the repo root)
 *   npm run demo:users -- --password abc12345678
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import argon2 from 'argon2';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { MIN_PASSWORD_LENGTH } from '../src/auth/auth.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { mariaDbUrl } from '../src/prisma/prisma.service';
import { SeedFile, seed } from './seed';

export const DEMO_PASSWORD = 'knot123456';

export function isLocalDatabase(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url.replace(/^mysql:/, 'http:')).hostname);
  } catch {
    return false;
  }
}

export function demoSeed(base: SeedFile, password: string): SeedFile {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  return { ...base, users: base.users.map((u) => ({ ...u, password })) };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--password');
  const password = at >= 0 ? args[at + 1] : DEMO_PASSWORD;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (backend/.env). Run `npm run setup` first.');
  if (!isLocalDatabase(url)) throw new Error('refusing to set demo passwords on a database that is not on this computer');
  const base = JSON.parse(readFileSync(path.join(__dirname, 'seed.example.json'), 'utf8')) as SeedFile;
  const data = demoSeed(base, password);
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(url)) });
  try {
    await seed(prisma, data, () => {});
    console.log('\nGiriş bilgileri (yalnızca bu bilgisayardaki demo için):\n');
    for (const u of data.users) {
      const row = await prisma.user.findUnique({ where: { email: u.email } });
      const ok = row ? await argon2.verify(row.passwordHash, password).catch(() => false) : false;
      console.log(`  ${ok ? '✓' : '✗'} ${u.email.padEnd(22)} ${password}   ${u.role === 'ADMIN' ? '(yönetici)' : ''}`);
      if (!ok) process.exitCode = 1;
    }
    console.log(process.exitCode ? '\nBazı hesaplar doğrulanamadı.' : '\nHazır: http://localhost:5173 adresinde bu e-posta ve şifreyle girin.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(`demo kurulumu başarısız: ${(e as Error).message}`); process.exitCode = 1; });
}
