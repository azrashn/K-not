import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';

import { Harness, PASSWORD } from '../support/harness';

const h = new Harness();
beforeAll(() => h.start({ loginRateLimitPerMinute: 5 }));
afterAll(() => h.stop());
beforeEach(() => h.reset());

test('login returns a short-lived HS256 bearer token; /auth/me works with it', async () => {
  const res = await h.http().post('/auth/login').send({ email: 'Ayse@Knot.Test', password: PASSWORD }).expect(200);
  expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, user: { id: h.world.users.ayse, role: 'USER' } });
  expect(res.body.user.passwordHash).toBeUndefined();
  const [header] = res.body.access_token.split('.');
  expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toMatchObject({ alg: 'HS256' });
  const me = await h.http().get('/auth/me').set('Authorization', `Bearer ${res.body.access_token}`).expect(200);
  expect(me.body).toEqual({ id: h.world.users.ayse, email: 'ayse@knot.test', display_name: 'ayse', role: 'USER' });
});

test('wrong password and unknown user get the same 401 message', async () => {
  const a = await h.http().post('/auth/login').send({ email: 'ayse@knot.test', password: 'wrong-password' }).expect(401);
  const b = await h.http().post('/auth/login').send({ email: 'nobody@knot.test', password: 'wrong-password' }).expect(401);
  expect(a.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Invalid e-mail or password.' });
  expect(b.body.error.message).toBe(a.body.error.message);
});

test('passwords are stored as Argon2id hashes', async () => {
  const u = await h.prisma.user.findUniqueOrThrow({ where: { id: h.world.users.ayse } });
  expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
  expect(await argon2.verify(u.passwordHash, PASSWORD)).toBe(true);
});

test('login is rate limited', async () => {
  for (let i = 0; i < 5; i++) await h.http().post('/auth/login').send({ email: 'mehmet@knot.test', password: 'nope-nope' }).expect(401);
  const r = await h.http().post('/auth/login').send({ email: 'mehmet@knot.test', password: PASSWORD }).expect(429);
  expect(r.body.error.code).toBe('RATE_LIMITED');
});

test('every non-public route requires a valid token', async () => {
  for (const [m, p] of [['get', '/courses'], ['get', '/auth/me'], ['get', `/documents/x1`], ['post', `/courses/c1/answers`]] as const) {
    const r = await h.http()[m](p).expect(401);
    expect(r.body).toMatchObject({ schema_version: 'api.v1', error: { code: 'UNAUTHENTICATED' } });
  }
  await h.http().get('/courses').set('Authorization', 'Bearer not.a.jwt').expect(401);
  await h.http().get('/health').expect(200);
});

test('tampered, expired, wrong-algorithm and orphaned tokens are rejected', async () => {
  const token = await h.token('ayse');
  const [hd, payload, sig] = token.split('.');
  const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
  forged.role = 'ADMIN';
  await h.http().get('/courses').set('Authorization', `Bearer ${hd}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`).expect(401);
  const jwt = new JwtService({ secret: h.config.jwtSecret });
  const expired = await jwt.signAsync({ sub: h.world.users.ayse, role: 'USER' }, { expiresIn: -10 });
  await h.http().get('/courses').set('Authorization', `Bearer ${expired}`).expect(401);
  const otherSecret = await new JwtService({ secret: 'another-secret-another-secret-0123' }).signAsync({ sub: h.world.users.ayse, role: 'USER' });
  await h.http().get('/courses').set('Authorization', `Bearer ${otherSecret}`).expect(401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;
  await h.http().get('/courses').set('Authorization', `Bearer ${none}`).expect(401);
  await h.prisma.courseMembership.deleteMany({ where: { userId: h.world.users.ayse } });
  await h.prisma.user.delete({ where: { id: h.world.users.ayse } });
  await h.http().get('/courses').set('Authorization', `Bearer ${token}`).expect(401);
});

test('there is no self-registration route (accounts are admin-seeded)', async () => {
  await h.http().post('/auth/register').send({ email: 'x@y.z', password: 'whatever-123' }).expect(404);
  await h.http().post('/auth/register').set(await h.as('ayse')).send({}).expect(404);
  expect(await h.prisma.user.count({ where: { email: 'x@y.z' } })).toBe(0);
});

test('login validates the payload without echoing it', async () => {
  const r = await h.http().post('/auth/login').send({ email: 'not-an-email', password: 'secret-value-123', extra: 1 }).expect(422);
  expect(r.body.error.code).toBe('VALIDATION_ERROR');
  expect(JSON.stringify(r.body)).not.toContain('secret-value-123');
});
