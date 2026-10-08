/**
 * The only place that decides who may see or manage courses and documents
 * (api-contracts.md §3 roles, §5 visibility). Decisions use MySQL only, per request.
 * Resources the user may not see are reported as 404, never 403, so existence is not revealed.
 */
import { Injectable } from '@nestjs/common';

import { ApiError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import type { Document, MembershipRole } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface DocumentAccess {
  document: Document;
  membership: MembershipRole | null;
  canView: boolean;
  canManage: boolean;
}

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async membership(userId: string, courseId: string): Promise<MembershipRole | null> {
    const m = await this.prisma.courseMembership.findUnique({ where: { userId_courseId: { userId, courseId } } });
    return m?.role ?? null;
  }

  /** Members see a course; admins see every course. Otherwise 404. */
  async requireCourse(user: AuthUser, courseId: string): Promise<MembershipRole | null> {
    const role = await this.membership(user.id, courseId);
    if (role) return role;
    if (user.role === 'ADMIN' && (await this.prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) {
      return null;
    }
    throw notFound('Course');
  }

  /** Membership is required (not just admin) wherever course material is consumed. */
  async requireMember(user: AuthUser, courseId: string): Promise<MembershipRole> {
    const role = await this.membership(user.id, courseId);
    if (!role) throw notFound('Course');
    return role;
  }

  static canView(user: AuthUser, doc: Pick<Document, 'visibility' | 'ownerId' | 'deletedAt'>, membership: MembershipRole | null): boolean {
    if (doc.deletedAt) return false;
    if (doc.visibility === 'COURSE') return membership !== null || user.role === 'ADMIN';
    return doc.ownerId === user.id && membership !== null; // PRIVATE: owner, while still a member
  }

  static canManage(user: AuthUser, doc: Pick<Document, 'visibility' | 'ownerId' | 'deletedAt'>, membership: MembershipRole | null): boolean {
    if (doc.deletedAt) return false;
    if (user.role === 'ADMIN') return true;
    if (doc.ownerId === user.id && membership !== null) return true;
    return doc.visibility === 'COURSE' && membership === 'INSTRUCTOR';
  }

  async document(user: AuthUser, documentId: string): Promise<DocumentAccess> {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.deletedAt) throw notFound('Document');
    const membership = await this.membership(user.id, document.courseId);
    return {
      document,
      membership,
      canView: AccessService.canView(user, document, membership),
      canManage: AccessService.canManage(user, document, membership),
    };
  }

  async requireViewable(user: AuthUser, documentId: string): Promise<DocumentAccess> {
    const a = await this.document(user, documentId);
    if (!a.canView) throw notFound('Document');
    return a;
  }

  async requireManageable(user: AuthUser, documentId: string): Promise<DocumentAccess> {
    const a = await this.document(user, documentId);
    if (a.canManage) return a;
    if (a.canView) throw new ApiError('FORBIDDEN', 'You may not modify this document.');
    throw notFound('Document');
  }
}
