import { Controller, Get, Param } from '@nestjs/common';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { IdParam } from '../common/validation';
import { AccessService } from './access.service';

const PROCESSING = ['UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'] as const;

@Controller('courses')
export class CoursesController {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const memberships = await this.prisma.courseMembership.findMany({
      where: { userId: user.id }, include: { course: true }, orderBy: { course: { code: 'asc' } },
    });
    return Promise.all(memberships.map((m) => this.dto(user, m.course, m.role)));
  }

  @Get(':courseId')
  async get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    const role = await this.access.requireCourse(user, p.courseId);
    const course = await this.prisma.course.findUnique({ where: { id: p.courseId } });
    if (!course) throw notFound('Course');
    return this.dto(user, course, role);
  }

  private async dto(user: AuthUser, course: { id: string; code: string; name: string; instructorName: string | null; term: string }, role: string | null) {
    const docs = await this.prisma.document.groupBy({
      by: ['status'],
      where: { courseId: course.id, deletedAt: null, OR: [{ visibility: 'COURSE' }, { ownerId: user.id }] },
      _count: { _all: true },
    });
    const count = (pred: (s: string) => boolean) => docs.filter((d) => pred(d.status)).reduce((n, d) => n + d._count._all, 0);
    return {
      id: course.id,
      code: course.code,
      name: course.name,
      instructor_name: course.instructorName,
      term: course.term,
      my_role: role,
      documents: {
        total: count(() => true),
        ready: count((s) => s === 'READY'),
        processing: count((s) => (PROCESSING as readonly string[]).includes(s)),
        failed: count((s) => s === 'FAILED'),
      },
    };
  }
}
