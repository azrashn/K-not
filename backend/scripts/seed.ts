/**
 * Admin seed (ADR-002: users, courses and memberships are admin-seeded; no self-registration).
 * Idempotent: upserts by e-mail / (code, term) / (user, course). Also creates the first ACTIVE
 * IndexVersion if none exists, defaulting to the ADR-010 pinned e5-small configuration.
 *
 *   DATABASE_URL=... npx ts-node scripts/seed.ts path/to/seed.json [--credentials-out <file>]
 *   npm run db:seed:local -- path/to/seed.json          (loads backend/.env)
 *   npm run db:seed:local -- users.json --rotate-passwords   (new passwords for existing users)
 *
 * Users without a "password" get a random one. Generated passwords are NEVER printed or
 * logged: they are written once to a credentials file OUTSIDE the repository (default: the OS
 * temp directory), readable only by the current user, and the script prints only its path.
 * A path inside the repository is refused. DATABASE_URL is required (no built-in default).
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/auth/auth.service';
import { EmbeddingConfiguration, fingerprint } from '../src/ai/index-versions';
import { PrismaClient } from '../src/generated/prisma/client';
import { mariaDbUrl } from '../src/prisma/prisma.service';

export const E5_SMALL_MVP: EmbeddingConfiguration = {
  backend: 'sentence_transformers',
  model: 'intfloat/multilingual-e5-small',
  revision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
  dimension: 384,
  query_prefix: 'query: ',
  document_prefix: 'passage: ',
  normalize: true,
  distance: 'cosine',
};

export interface SeedFile {
  users: { email: string; display_name: string; password?: string; role?: 'USER' | 'ADMIN' }[];
  courses: { code: string; name: string; term: string; instructor_name?: string; members?: { email: string; role: 'STUDENT' | 'INSTRUCTOR' }[] }[];
  index_version?: { collection: string; chunker_version?: string; embedding?: EmbeddingConfiguration };
}

export interface GeneratedCredential { email: string; password: string }

export interface SeedOptions {
  /** Generate a NEW password for listed users that already exist (and have none in the file). */
  rotatePasswords?: boolean;
}

export async function seed(prisma: PrismaClient, data: SeedFile, print: (s: string) => void = console.log, opts: SeedOptions = {}) {
  const users = new Map<string, string>();
  const generated: GeneratedCredential[] = [];
  for (const u of data.users) {
    const email = u.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    let password = u.password;
    if (!password && (!existing || opts.rotatePasswords)) {
      password = randomBytes(12).toString('base64url');
      generated.push({ email, password });
      print(`generated a password for ${email} (written to the credentials file, not printed)`);
    }
    if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) throw new Error(`password for ${email} is shorter than ${MIN_PASSWORD_LENGTH}`);
    const passwordHash = password ? await hashPassword(password) : undefined;
    const row = await prisma.user.upsert({
      where: { email },
      update: { displayName: u.display_name, role: u.role ?? 'USER', ...(passwordHash ? { passwordHash } : {}) },
      create: { email, displayName: u.display_name, role: u.role ?? 'USER', passwordHash: passwordHash! },
    });
    users.set(email, row.id);
  }
  const courses = new Map<string, string>();
  for (const c of data.courses) {
    const row = await prisma.course.upsert({
      where: { code_term: { code: c.code, term: c.term } },
      update: { name: c.name, instructorName: c.instructor_name ?? null },
      create: { code: c.code, term: c.term, name: c.name, instructorName: c.instructor_name ?? null },
    });
    courses.set(`${c.code}|${c.term}`, row.id);
    for (const m of c.members ?? []) {
      const userId = users.get(m.email.trim().toLowerCase());
      if (!userId) throw new Error(`unknown member ${m.email}`);
      await prisma.courseMembership.upsert({
        where: { userId_courseId: { userId, courseId: row.id } },
        update: { role: m.role },
        create: { userId, courseId: row.id, role: m.role },
      });
    }
  }
  let indexVersionId: string | null = null;
  const active = await prisma.indexVersion.findFirst({ where: { status: 'ACTIVE' } });
  if (active) {
    indexVersionId = active.id;
  } else {
    const iv = data.index_version ?? { collection: 'knot_chunks_v1' };
    const e = iv.embedding ?? E5_SMALL_MVP;
    const row = await prisma.indexVersion.create({
      data: {
        collectionName: iv.collection, embeddingBackend: e.backend, embeddingModel: e.model, embeddingRevision: e.revision,
        embeddingDimension: e.dimension, queryPrefix: e.query_prefix, documentPrefix: e.document_prefix,
        normalize: e.normalize, distance: e.distance, embeddingFingerprint: fingerprint(e),
        chunkerVersion: iv.chunker_version ?? 'c1', status: 'ACTIVE', activatedAt: new Date(),
      },
    });
    indexVersionId = row.id;
    print(`created ACTIVE IndexVersion ${row.id} (${row.collectionName}, ${row.embeddingFingerprint})`);
  }
  return { users, courses, indexVersionId, generated };
}

export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Where generated passwords may be written: never inside the repository. */
export function credentialsPath(requested: string | undefined, now = new Date()): string {
  const target = path.resolve(requested ?? path.join(tmpdir(), `knot-seed-credentials-${now.toISOString().replace(/[:.]/g, '-')}.txt`));
  const rel = path.relative(REPO_ROOT, target);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error('refusing to write credentials inside the repository; choose a path outside it');
  }
  return target;
}

export function writeCredentials(file: string, creds: GeneratedCredential[]): void {
  const body = creds.map((c) => `${c.email}\t${c.password}`).join('\n') + '\n';
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); // never overwrite
}

function parseArgs(argv: string[]): { file?: string; credentialsOut?: string; rotate: boolean } {
  const out: { file?: string; credentialsOut?: string; rotate: boolean } = { rotate: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--credentials-out') out.credentialsOut = argv[++i];
    else if (argv[i] === '--rotate-passwords') out.rotate = true;
    else if (!out.file) out.file = argv[i];
  }
  return out;
}

if (require.main === module) {
  const { file, credentialsOut, rotate } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error('usage: ts-node scripts/seed.ts <seed.json> [--rotate-passwords] [--credentials-out <file outside the repo>]');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Put it in backend/.env and run `npm run db:seed:local -- <seed.json>`.');
    process.exit(2);
  }
  let target: string;
  try {
    target = credentialsPath(credentialsOut); // validated before anything is written to the DB
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(mariaDbUrl(process.env.DATABASE_URL)) });
  seed(prisma, JSON.parse(readFileSync(file, 'utf8')) as SeedFile, console.log, { rotatePasswords: rotate })
    .then(({ generated }) => {
      if (generated.length) {
        writeCredentials(target, generated);
        console.log(`${generated.length} generated password(s) written to ${target} (readable only by you; delete it after use)`);
      }
      console.log('seed complete');
    })
    .catch((e) => { console.error(`seed failed: ${(e as Error).message}`); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
