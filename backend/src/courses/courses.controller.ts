import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { randomBytes } from 'node:crypto';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { ApiError, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { IdParam } from '../common/validation';
import { AccessService } from './access.service';

const PROCESSING = ['UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'] as const;
const DEFAULT_TERM = 'Kişisel';

export class CreateCourseDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsOptional() @IsString() @MaxLength(200) instructor_name?: string;
  @IsOptional() @IsString() @MaxLength(32) term?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateCourseDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsOptional() @IsString() @MaxLength(200) instructor_name?: string;
  @IsOptional() @IsString() @MaxLength(32) term?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

type CourseRow = {
  id: string; code: string; name: string; instructorName: string | null; term: string;
  description: string | null; createdById: string | null;
};

const clean = (v: string | null | undefined): string | undefined => (v === undefined ? undefined : v === null ? '' : v.trim());
const blankToNull = (v: string | undefined): string | null | undefined => (v === undefined ? undefined : v === '' ? null : v);

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002' || /Unique constraint/i.test((e as Error | null)?.message ?? '');
}

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

  /** A student-created personal course: the creator becomes its (STUDENT) member and owner. */
  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: AuthUser, @Body() body: CreateCourseDto) {
    const name = clean(body.name) ?? '';
    if (!name) throw new ApiError('VALIDATION_ERROR', 'Course name is required.', { field: 'name' });
    const term = clean(body.term) || DEFAULT_TERM;
    const explicitCode = clean(body.code);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = explicitCode || `K-${randomBytes(4).toString('hex').toUpperCase()}`;
      try {
        const course = await this.prisma.$transaction(async (tx) => {
          const c = await tx.course.create({
            data: { code, name, term, instructorName: clean(body.instructor_name) || null, description: clean(body.description) || null, createdById: user.id },
          });
          await tx.courseMembership.create({ data: { userId: user.id, courseId: c.id, role: 'STUDENT' } });
          return c;
        });
        return this.dto(user, course, 'STUDENT');
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (explicitCode) throw new ApiError('DUPLICATE_COURSE', 'A course with this code already exists for this term.', { field: 'code' });
      }
    }
    throw new ApiError('INTERNAL_ERROR', 'Internal error.');
  }

  @Get(':courseId')
  async get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    const role = await this.access.requireCourse(user, p.courseId);
    const course = await this.prisma.course.findUnique({ where: { id: p.courseId } });
    if (!course) throw notFound('Course');
    return this.dto(user, course, role);
  }

  /** Only the creator (or an admin) may edit; other members get 403, non-members 404. */
  @Patch(':courseId')
  async update(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course, @Body() body: UpdateCourseDto) {
    const role = await this.access.requireCourse(user, p.courseId);
    const course = await this.prisma.course.findUnique({ where: { id: p.courseId } });
    if (!course) throw notFound('Course');
    if (!this.canEdit(user, course)) throw new ApiError('FORBIDDEN', 'You may not edit this course.');
    const name = clean(body.name);
    if (name !== undefined && !name) throw new ApiError('VALIDATION_ERROR', 'Course name is required.', { field: 'name' });
    // code and term are required columns: blanking them in the form keeps the current value.
    const code = clean(body.code) || undefined;
    const term = clean(body.term) || undefined;
    try {
      const updated = await this.prisma.course.update({
        where: { id: course.id },
        data: {
          ...(name !== undefined && { name }),
          ...(code !== undefined && { code }),
          ...(term !== undefined && { term }),
          ...(body.instructor_name !== undefined && { instructorName: blankToNull(clean(body.instructor_name)) }),
          ...(body.description !== undefined && { description: blankToNull(clean(body.description)) }),
        },
      });
      return this.dto(user, updated, role);
    } catch (e) {
      if (isUniqueViolation(e)) throw new ApiError('DUPLICATE_COURSE', 'A course with this code already exists for this term.', { field: 'code' });
      throw e;
    }
  }

  private canEdit(user: AuthUser, course: Pick<CourseRow, 'createdById'>): boolean {
    return user.role === 'ADMIN' || (course.createdById !== null && course.createdById === user.id);
  }

  private async dto(user: AuthUser, course: CourseRow, role: string | null) {
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
      description: course.description,
      my_role: role,
      is_owner: course.createdById !== null && course.createdById === user.id,
      can_edit: this.canEdit(user, course),
      documents: {
        total: count(() => true),
        ready: count((s) => s === 'READY'),
        processing: count((s) => (PROCESSING as readonly string[]).includes(s)),
        failed: count((s) => s === 'FAILED'),
      },
    };
  }
}
