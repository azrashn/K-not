import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

import type { AuthUser, RequestWithContext } from '../common/request-context';

export const IS_PUBLIC = 'knot:isPublic';
/** Routes without a user JWT: login, health, and the internal callback (which has its own guard). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<RequestWithContext>().user as AuthUser;
});
