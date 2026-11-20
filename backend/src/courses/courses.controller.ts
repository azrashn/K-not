import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../common/errors';
import { CourseLifecycleService } from './course-lifecycle.service';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { IdParam } from '../common/validation';
import { AccessService } from './access.service';

const PROCESSING = [
  'UPLOADED',
  'EXTRACTING',
  'CHUNKING',
  'EMBEDDING',
  'INDEXING',
] as const;
class CourseInput {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) category?: string;
}
class ArchiveInput {
  @IsBoolean() archived!: boolean;
}
class DeleteInput {
  @IsString() @MaxLength(200) confirm_name!: string;
}

@Controller('courses')
export class CoursesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly lifecycle: CourseLifecycleService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query('archived') archived?: string,
  ) {
    const memberships = await this.prisma.courseMembership.findMany({
      where: {
        userId: user.id,
        course: { lifecycle: { not: 'DELETED' } },
        ...(archived === '1' ? {} : { archivedAt: null }),
      },
      include: { course: true },
      orderBy: { course: { createdAt: 'desc' } },
    });
    return Promise.all(
      memberships.map(async (m) => ({
        ...(await this.dto(user, m.course, m.role)),
        archived: Boolean(m.archivedAt),
      })),
    );
  }
  @Post() async create(@CurrentUser() u: AuthUser, @Body() b: CourseInput) {
    const c = await this.prisma.course.create({
      data: {
        code: 'P-' + randomUUID().slice(0, 18),
        name: b.name.trim(),
        description: b.description?.trim() || null,
        category: b.category?.trim() || null,
        term: 'Kişisel',
        ownerId: u.id,
        memberships: { create: { userId: u.id, role: 'INSTRUCTOR' } },
      },
    });
    return this.dto(u, c, 'INSTRUCTOR');
  }
  @Patch(':courseId') async update(
    @CurrentUser() u: AuthUser,
    @Param() p: IdParam.Course,
    @Body() b: CourseInput,
  ) {
    const c = await this.prisma.course.findFirst({
      where: { id: p.courseId, ownerId: u.id, lifecycle: 'ACTIVE' },
    });
    if (!c) throw notFound('Course');
    return this.dto(
      u,
      await this.prisma.course.update({
        where: { id: c.id },
        data: {
          name: b.name.trim(),
          description: b.description?.trim() || null,
          category: b.category?.trim() || null,
        },
      }),
      'INSTRUCTOR',
    );
  }
  @Post(':courseId/archive') @HttpCode(200) async archive(
    @CurrentUser() u: AuthUser,
    @Param() p: IdParam.Course,
    @Body() b: ArchiveInput,
  ) {
    const member = await this.prisma.courseMembership.findUnique({
      where: { userId_courseId: { userId: u.id, courseId: p.courseId } },
    });
    if (!member) throw notFound('Course');
    await this.prisma.courseMembership.update({
      where: { userId_courseId: { userId: u.id, courseId: p.courseId } },
      data: { archivedAt: b.archived ? new Date() : null },
    });
    return { archived: b.archived };
  }
  @Delete(':courseId') @HttpCode(200) remove(
    @CurrentUser() u: AuthUser,
    @Param() p: IdParam.Course,
    @Body() b: DeleteInput,
  ) {
    return this.lifecycle.remove(u, p.courseId, b.confirm_name);
  }

  @Get(':courseId')
  async get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    const role = await this.access.requireCourse(user, p.courseId);
    const course = await this.prisma.course.findUnique({
      where: { id: p.courseId },
    });
    if (!course) throw notFound('Course');
    return this.dto(user, course, role);
  }

  private async dto(
    user: AuthUser,
    course: {
      id: string;
      code: string;
      name: string;
      instructorName: string | null;
      term: string;
      ownerId?: string | null;
      description?: string | null;
      category?: string | null;
      lifecycle?: string;
      deletionError?: string | null;
    },
    role: string | null,
  ) {
    const docs = await this.prisma.document.groupBy({
      by: ['status'],
      where: {
        courseId: course.id,
        deletedAt: null,
        OR: [{ visibility: 'COURSE' }, { ownerId: user.id }],
      },
      _count: { _all: true },
    });
    const count = (pred: (s: string) => boolean) =>
      docs.filter((d) => pred(d.status)).reduce((n, d) => n + d._count._all, 0);
    const videos = await this.prisma.video.count({
        where: { courseId: course.id, ownerId: user.id },
      }),
      files = await this.prisma.studyMaterial.count({
        where: { courseId: course.id, ownerId: user.id },
      });
    const activity = await this.prisma.learningActivity.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
    });
    return {
      id: course.id,
      code: course.code,
      name: course.name,
      instructor_name: course.instructorName,
      term: course.term,
      my_role: role,
      can_manage: course.ownerId === user.id,
      description: course.description || null,
      category: course.category || null,
      lifecycle: course.lifecycle || 'ACTIVE',
      deletion_error: course.deletionError || null,
      material_count: count(() => true) + videos + files,
      last_studied_at: activity?.updatedAt || null,
      documents: {
        total: count(() => true),
        ready: count((s) => s === 'READY'),
        processing: count((s) => (PROCESSING as readonly string[]).includes(s)),
        failed: count((s) => s === 'FAILED'),
      },
    };
  }
}
