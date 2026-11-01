import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '../common/ids';

import { IndexVersionService } from '../ai/index-versions';
import { ApiError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AccessService } from '../courses/access.service';
import { JobConflict, JobsService } from '../jobs/jobs.service';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { originalKey, pagesKey, Storage } from '../storage/storage';
import { DOCUMENT_TYPES, documentDto } from './document-dto';
import type { StoredUpload } from './upload-storage';

const INDEXING_VERSION = /^[A-Za-z0-9._\-]{1,64}$/;

export interface UploadFields {
  document_type?: unknown;
  title?: unknown;
  visibility?: unknown;
}

/** Keeps only the file name, without control characters, within the column length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'document.pdf').slice(0, 255);
}

@Injectable()
export class DocumentsService {
  private readonly log = new Logger('documents');

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly jobs: JobsService,
    private readonly indexVersions: IndexVersionService,
    private readonly storage: Storage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: AuthUser, courseId: string) {
    const membership = await this.access.requireCourse(user, courseId);
    const docs = await this.prisma.document.findMany({
      where: { courseId, deletedAt: null, OR: [{ visibility: 'COURSE' }, ...(membership ? [{ ownerId: user.id }] : [])] },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => documentDto(d, { canDelete: AccessService.canManage(user, d, membership) }));
  }

  async get(user: AuthUser, documentId: string) {
    const a = await this.access.requireViewable(user, documentId);
    return documentDto(a.document, { canDelete: a.canManage });
  }

  /** data-model.md §4 upload sequence. The temp file is always removed on any failure. */
  async upload(user: AuthUser, courseId: string, file: StoredUpload | undefined, fields: UploadFields) {
    try {
      const membership = await this.access.requireMember(user, courseId);
      if (!file) throw new ApiError('VALIDATION_ERROR', 'A PDF file is required in the "file" field.');
      if (!file.magicOk) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Only PDF files are accepted.');
      if (file.size === 0) throw new ApiError('VALIDATION_ERROR', 'The file is empty.');
      const documentType = fields.document_type;
      if (typeof documentType !== 'string' || !(DOCUMENT_TYPES as readonly string[]).includes(documentType)) {
        throw new ApiError('VALIDATION_ERROR', 'document_type is invalid.', { allowed: DOCUMENT_TYPES });
      }
      const visibility = fields.visibility ?? 'PRIVATE';
      if (visibility !== 'PRIVATE' && visibility !== 'COURSE') throw new ApiError('VALIDATION_ERROR', 'visibility must be PRIVATE or COURSE.');
      if (visibility === 'COURSE' && membership !== 'INSTRUCTOR') {
        throw new ApiError('FORBIDDEN', 'Only instructors can upload course-wide documents.');
      }
      const originalFilename = sanitizeFilename(file.originalname);
      let title = typeof fields.title === 'string' ? fields.title.trim() : '';
      if (fields.title !== undefined && typeof fields.title !== 'string') throw new ApiError('VALIDATION_ERROR', 'title must be a string.');
      if (!title) title = originalFilename.replace(/\.pdf$/i, '') || 'Belge';
      if (title.length > 300) throw new ApiError('VALIDATION_ERROR', 'title must be at most 300 characters.');

      const iv = await this.indexVersions.active();
      if (!iv) throw new ApiError('AI_SERVICE_UNAVAILABLE', 'No active index version is configured.');

      const id = newId();
      const storageKey = originalKey(id);
      try {
        await this.prisma.document.create({
          data: {
            id, courseId, ownerId: user.id, visibility, documentType, title, originalFilename,
            mimeType: 'application/pdf', sizeBytes: file.size, contentSha256: file.sha256, activeContentHash: file.sha256,
            storageKey, status: 'UPLOADED',
          },
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const existing = await this.prisma.document.findFirst({
          where: { courseId, ownerId: user.id, activeContentHash: file.sha256 }, select: { id: true },
        });
        throw new ApiError('DUPLICATE_DOCUMENT', 'You already uploaded this file to this course.', { existing_document_id: existing?.id ?? null });
      }
      try {
        await this.storage.move(file.tempKey, storageKey);
      } catch (e) {
        await this.prisma.document.delete({ where: { id } }); // compensate: no job/chunks/artifacts exist yet
        throw e;
      }
      const job = await this.prisma.$transaction((tx) => this.jobs.createJobTx(tx, id, 'INITIAL', 1, iv));
      const notices: string[] = [];
      if (visibility === 'PRIVATE') {
        const same = await this.prisma.document.findFirst({
          where: { courseId, contentSha256: file.sha256, visibility: 'COURSE', deletedAt: null, ownerId: { not: user.id } },
          select: { id: true },
        });
        if (same) notices.push('SAME_AS_COURSE_DOCUMENT');
      }
      this.log.log({ event: 'document.uploaded', document_id: id, course_id: courseId, size_bytes: file.size, visibility });
      this.kickDispatch(job.id);
      const doc = await this.prisma.document.findUniqueOrThrow({ where: { id } });
      return documentDto(doc, { canDelete: true, notices });
    } finally {
      if (file) await this.storage.delete(file.tempKey).catch(() => undefined); // no-op after a successful move
    }
  }

  async retry(user: AuthUser, documentId: string) {
    const { document } = await this.access.requireManageable(user, documentId);
    if (document.activeJobId) throw new ApiError('JOB_ALREADY_RUNNING', 'The document is already being processed.');
    if (document.status !== 'FAILED' || !document.errorRetryable) {
      throw new ApiError('NOT_RETRYABLE', 'Only documents that failed with a retryable error can be retried; upload a new file instead.');
    }
    const iv = await this.indexVersions.active();
    if (!iv) throw new ApiError('AI_SERVICE_UNAVAILABLE', 'No active index version is configured.');
    let jobId: string;
    try {
      jobId = (await this.prisma.$transaction((tx) => this.jobs.createJobTx(tx, documentId, 'RETRY', 1, iv))).id;
    } catch (e) {
      if (e instanceof JobConflict) throw new ApiError('JOB_ALREADY_RUNNING', 'The document is already being processed.');
      throw e;
    }
    this.kickDispatch(jobId);
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    return documentDto(doc, { canDelete: true });
  }

  async remove(user: AuthUser, documentId: string) {
    await this.access.requireManageable(user, documentId);
    await this.jobs.softDelete(documentId);
    if (this.config.schedulerEnabled) void this.jobs.purge(documentId).catch(() => undefined); // retried by the sweeper
    return { id: documentId, state: 'DELETING' };
  }

  async page(user: AuthUser, documentId: string, page: number, indexingVersion?: string) {
    const { document } = await this.access.requireViewable(user, documentId);
    if (!Number.isInteger(page) || page < 1) throw notFound('Page');
    if (indexingVersion !== undefined && !INDEXING_VERSION.test(indexingVersion)) {
      throw new ApiError('VALIDATION_ERROR', 'indexing_version is invalid.');
    }
    const version = indexingVersion ?? document.indexingVersion;
    if (!version) throw new ApiError('DOCUMENT_NOT_READY', 'The document has no extracted pages yet.');
    const raw = await this.storage.readText(pagesKey(documentId, version));
    if (raw === null) {
      if (indexingVersion === undefined) throw new ApiError('DOCUMENT_NOT_READY', 'The document has no extracted pages yet.');
      throw notFound('Page artifact');
    }
    const artifact = JSON.parse(raw) as { indexing_version: string; page_count: number; pages: { page: number; char_start: number; char_end: number; text: string }[] };
    const p = artifact.pages[page - 1];
    if (!p || p.page !== page) throw notFound('Page');
    return {
      document_id: documentId, indexing_version: artifact.indexing_version, page: p.page, page_count: artifact.page_count,
      char_start: p.char_start, char_end: p.char_end, text: p.text,
    };
  }

  async file(user: AuthUser, documentId: string) {
    const { document } = await this.access.requireViewable(user, documentId);
    if (!(await this.storage.exists(document.storageKey))) throw notFound('File');
    return { stream: await this.storage.openRead(document.storageKey), filename: document.originalFilename, size: document.sizeBytes };
  }

  private kickDispatch(jobId: string): void {
    if (!this.config.schedulerEnabled) return; // tests and tools dispatch explicitly
    setImmediate(() => void this.jobs.dispatchOne(jobId).catch((e) => this.log.warn({ event: 'job.dispatch_error', job_id: jobId, error_type: (e as Error).constructor.name })));
  }
}
