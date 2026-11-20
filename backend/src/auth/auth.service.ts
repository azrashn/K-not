import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { ApiError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import type { AuthUser } from '../common/request-context';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../prisma/prisma.service';

/** OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). */
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => argon2.hash(plain, ARGON2_OPTIONS);

export const MIN_PASSWORD_LENGTH = 10;

export interface TokenClaims {
  sub: string;
  role: 'USER' | 'ADMIN';
}

@Injectable()
export class AuthService {
  private readonly log = new Logger('auth');
  private readonly loginLimiter: RateLimiter;
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.loginLimiter = new RateLimiter(config.loginRateLimitPerMinute);
  }

  async login(email: string, password: string, clientKey: string) {
    const normalized = email.trim().toLowerCase();
    if (!this.loginLimiter.take(`${clientKey}|${normalized}`)) {
      throw new ApiError('RATE_LIMITED', 'Too many login attempts. Try again in a minute.');
    }
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    // Verify against a dummy hash when the user does not exist, so timing does not reveal accounts.
    this.dummyHash ??= hashPassword('dummy-password-for-timing');
    const ok = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), password).catch(() => false);
    if (!user || !ok) {
      this.log.warn({ event: 'auth.login_failed', user_known: Boolean(user) });
      throw new ApiError('UNAUTHENTICATED', 'Invalid e-mail or password.');
    }
    const claims: TokenClaims = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(claims);
    this.log.log({ event: 'auth.login', user_id: user.id });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.config.jwtTtlSeconds,
      user: { id: user.id, email: user.email, display_name: user.displayName, role: user.role },
    };
  }

  /** Verifies a bearer token and that the user still exists (deleted users lose access at once). */
  async authenticate(token: string): Promise<AuthUser> {
    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError('UNAUTHENTICATED', 'Missing or invalid access token.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, role: true } });
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Missing or invalid access token.');
    return { id: user.id, role: user.role };
  }
}
