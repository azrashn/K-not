import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiError } from '../common/errors';
import type { RequestWithContext } from '../common/request-context';
import { IS_PUBLIC } from './auth.decorators';
import { AuthService } from './auth.service';

/** Global guard: every route requires a user JWT unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) throw new ApiError('UNAUTHENTICATED', 'Missing or invalid access token.');
    req.user = await this.auth.authenticate(match[1]);
    return true;
  }
}
