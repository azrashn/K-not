import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { notFound } from '../common/errors';
import type { RequestWithContext } from '../common/request-context';
import { IDENTIFIER } from '../common/validation';
import { AccessService } from '../courses/access.service';

/** Runs before the multipart body is read, so non-members cannot stream files to the server. */
@Injectable()
export class UploadAccessGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithContext>();
    const courseId = req.params.courseId as string;
    if (!IDENTIFIER.test(courseId ?? '') || !req.user) throw notFound('Course');
    await this.access.requireMember(req.user, courseId);
    return true;
  }
}
