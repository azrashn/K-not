/** Safer seed workflow: generated passwords are never printed and never written into the repo. */
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { credentialsPath, REPO_ROOT, seed, writeCredentials } from '../../scripts/seed';

function fakePrisma() {
  const rows = new Map<string, { id: string }>();
  let n = 0;
  const id = () => `id${++n}`;
  return {
    user: {
      findUnique: async ({ where }: any) => rows.get(`u:${where.email}`) ?? null,
      upsert: async ({ where }: any) => {
        const key = `u:${where.email}`;
        if (!rows.has(key)) rows.set(key, { id: id() });
        return rows.get(key);
      },
    },
    course: { upsert: async () => ({ id: id() }) },
    courseMembership: { upsert: async () => ({}) },
    indexVersion: { findFirst: async () => ({ id: 'iv1' }), create: async () => ({ id: 'iv1' }) },
  } as any;
}

describe('seed', () => {
  it('never prints a generated password, but returns it once for the credentials file', async () => {
    const out: string[] = [];
    const r = await seed(fakePrisma(), {
      users: [
        { email: 'Ayse@knot.local', display_name: 'Ayşe' },
        { email: 'given@knot.local', display_name: 'Given', password: 'a-supplied-password-123' },
      ],
      courses: [],
    }, (s) => out.push(s));
    expect(r.generated).toHaveLength(1);
    expect(r.generated[0].email).toBe('ayse@knot.local');
    expect(r.generated[0].password.length).toBeGreaterThanOrEqual(16);
    const printed = out.join('\n');
    expect(printed).not.toContain(r.generated[0].password);
    expect(printed).not.toContain('a-supplied-password-123');
    expect(printed).toContain('ayse@knot.local');
  });

  it('--rotate-passwords gives existing users a new password; without it they keep theirs', async () => {
    const prisma = fakePrisma();
    const users = [{ email: 'ayse@knot.local', display_name: 'Ayşe' }];
    const first = await seed(prisma, { users, courses: [] }, () => {});
    const again = await seed(prisma, { users, courses: [] }, () => {});
    expect(again.generated).toEqual([]);
    const out: string[] = [];
    const rotated = await seed(prisma, { users, courses: [] }, (s) => out.push(s), { rotatePasswords: true });
    expect(rotated.generated).toHaveLength(1);
    expect(rotated.generated[0].password).not.toBe(first.generated[0].password);
    expect(out.join('\n')).not.toContain(rotated.generated[0].password);
  });

  it('refuses a credentials path inside the repository', () => {
    for (const p of [path.join(REPO_ROOT, 'backend', 'seed_output.txt'), path.join(REPO_ROOT, 'creds.txt'), REPO_ROOT]) {
      expect(() => credentialsPath(p)).toThrow(/inside the repository/);
    }
  });

  it('defaults to a timestamped file in the OS temp directory', () => {
    const p = credentialsPath(undefined, new Date('2026-10-10T12:00:00Z'));
    expect(path.dirname(p)).toBe(path.resolve(tmpdir()));
    expect(path.basename(p)).toMatch(/^knot-seed-credentials-2026-10-10T12-00-00-000Z\.txt$/);
  });

  it('writes the credentials file readable only by the owner and never overwrites one', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'knot-seed-test-')), 'creds.txt');
    writeCredentials(file, [{ email: 'a@knot.local', password: 'x'.repeat(16) }]);
    expect(readFileSync(file, 'utf8')).toBe(`a@knot.local\t${'x'.repeat(16)}\n`);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => writeCredentials(file, [])).toThrow();
  });
});
