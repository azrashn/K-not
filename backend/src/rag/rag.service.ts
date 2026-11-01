/**
 * NestJS ↔ WBS-3 RAG integration (api-contracts.md §3.4, §4, §5, §7).
 *
 * - The scope sent to Python is derived ONLY from MySQL, per request. Browser-supplied
 *   `document_ids` can only narrow it (intersection); they never widen it.
 * - `GroundedAnswer` is passed through unchanged (support status, claims, citations): NestJS
 *   never upgrades an answer to "supported" because a citation exists.
 * - `INSUFFICIENT_EVIDENCE` is a normal 200. AI-service failures are distinct error codes.
 * - Defence in depth: any evidence/citation outside the derived scope fails closed (500), so a
 *   Python-side bug cannot leak other users' or courses' content.
 * - Answers are NOT persisted (U6 decision: no stored excerpts of deleted documents).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AiServiceClient, aiErrorCode } from '../ai/ai-client';
import { IndexVersionService } from '../ai/index-versions';
import { ApiError, PublicErrorCode } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import type { AuthUser } from '../common/request-context';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AccessService } from '../courses/access.service';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_SCOPE_DOCUMENTS = 1000; // = WBS-3 MAX_SCOPE_DOCUMENTS

export interface AuthorizedScope {
  user_id: string;
  course_id: string;
  document_ids: string[];
}

/** Python `rag.v1` error code → public code (api-contracts.md §7). */
const PY_TO_PUBLIC: Record<string, PublicErrorCode> = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'INTERNAL_ERROR',
  UNAUTHORIZED_SCOPE: 'INTERNAL_ERROR',
  INDEX_NOT_READY: 'NO_READY_DOCUMENTS',
  RETRIEVAL_UNAVAILABLE: 'AI_SERVICE_UNAVAILABLE',
  GENERATION_FAILED: 'GENERATION_FAILED',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

const PUBLIC_MESSAGE: Partial<Record<PublicErrorCode, string>> = {
  NO_READY_DOCUMENTS: 'None of the selected documents is ready for questions yet.',
  AI_SERVICE_UNAVAILABLE: 'The AI service is temporarily unavailable.',
  GENERATION_FAILED: 'The answer could not be generated.',
  PROVIDER_TIMEOUT: 'The language model did not respond in time.',
  INTERNAL_ERROR: 'Internal error.',
  VALIDATION_ERROR: 'The question is invalid.',
};

@Injectable()
export class RagService {
  private readonly log = new Logger('rag');
  private readonly answerLimiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly ai: AiServiceClient,
    private readonly indexVersions: IndexVersionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.answerLimiter = new RateLimiter(config.answerRateLimitPerMinute);
  }

  /** api-contracts.md §5 — the only place access to course material for AI calls is decided. */
  async authorizedScope(userId: string, courseId: string, requested?: string[]): Promise<AuthorizedScope> {
    const member = await this.access.membership(userId, courseId);
    if (!member) throw new ApiError('NOT_FOUND', 'Course not found.');
    const docs = await this.prisma.document.findMany({
      where: {
        courseId,
        status: 'READY',
        deletedAt: null,
        OR: [{ visibility: 'COURSE' }, { ownerId: userId }],
        ...(requested?.length ? { id: { in: requested } } : {}),
      },
      select: { id: true },
      orderBy: { readyAt: 'desc' },
      take: MAX_SCOPE_DOCUMENTS,
    });
    if (docs.length === 0) throw new ApiError('NO_READY_DOCUMENTS', 'No ready documents are available for this question.');
    return { user_id: userId, course_id: courseId, document_ids: docs.map((d) => d.id) };
  }

  private async requireConsistentIndex(): Promise<void> {
    const g = await this.indexVersions.state();
    if (g.state === 'mismatch') throw new ApiError('INDEX_VERSION_MISMATCH', 'The AI index does not match the active index version.', null, true);
    if (g.state === 'unavailable') throw new ApiError('AI_SERVICE_UNAVAILABLE', PUBLIC_MESSAGE.AI_SERVICE_UNAVAILABLE!);
    if (g.state === 'no_active_version') throw new ApiError('AI_SERVICE_UNAVAILABLE', 'No active index version is configured.');
  }

  private mapFailure(r: Awaited<ReturnType<AiServiceClient['call']>>, op: string): ApiError {
    if (r.kind === 'timeout') return new ApiError(op === 'answer' ? 'PROVIDER_TIMEOUT' : 'AI_SERVICE_UNAVAILABLE', op === 'answer' ? PUBLIC_MESSAGE.PROVIDER_TIMEOUT! : PUBLIC_MESSAGE.AI_SERVICE_UNAVAILABLE!);
    if (r.kind === 'unreachable') return new ApiError('AI_SERVICE_UNAVAILABLE', PUBLIC_MESSAGE.AI_SERVICE_UNAVAILABLE!);
    const pyCode = aiErrorCode(r.body);
    const code: PublicErrorCode = (pyCode && PY_TO_PUBLIC[pyCode]) || (r.status >= 500 ? 'AI_SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR');
    if (code === 'INTERNAL_ERROR') this.log.error({ event: 'rag.upstream_contract_error', op, status: r.status, code: pyCode });
    return new ApiError(code, PUBLIC_MESSAGE[code] ?? 'Internal error.');
  }

  /** Fails closed if Python returned anything outside the scope NestJS derived. */
  private assertWithinScope(scope: AuthorizedScope, payload: any, op: string): void {
    const allowed = new Set(scope.document_ids);
    const seen: { document_id?: unknown; course_id?: unknown }[] = [
      ...(Array.isArray(payload?.evidence) ? payload.evidence : []),
      ...(Array.isArray(payload?.claims) ? payload.claims.flatMap((c: any) => (Array.isArray(c?.citations) ? c.citations : [])) : []),
    ];
    for (const item of seen) {
      const outside = typeof item?.document_id !== 'string' || !allowed.has(item.document_id)
        || (item.course_id !== undefined && item.course_id !== scope.course_id);
      if (outside) {
        this.log.error({ event: 'rag.scope_violation_blocked', op, course_id: scope.course_id, user_id: scope.user_id });
        throw new ApiError('INTERNAL_ERROR', 'Internal error.');
      }
    }
  }

  /** Current MySQL values for every document cited or present in evidence (ADR-012). */
  private async documentsMap(payload: any): Promise<Record<string, unknown>> {
    const ids = new Set<string>();
    for (const e of payload?.evidence ?? []) if (typeof e?.document_id === 'string') ids.add(e.document_id);
    for (const c of payload?.claims ?? []) for (const ct of c?.citations ?? []) if (typeof ct?.document_id === 'string') ids.add(ct.document_id);
    if (!ids.size) return {};
    const docs = await this.prisma.document.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, title: true, originalFilename: true, documentType: true, pageCount: true },
    });
    return Object.fromEntries(docs.map((d) => [d.id, {
      title: d.title, original_filename: d.originalFilename, document_type: d.documentType, page_count: d.pageCount,
    }]));
  }

  private requestId(requestId?: string): string {
    return requestId && /^[A-Za-z0-9_.:\-]{1,128}$/.test(requestId) ? requestId : randomUUID();
  }

  async answer(user: AuthUser, courseId: string, question: string, documentIds: string[] | undefined, requestId?: string) {
    if (!this.answerLimiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Too many questions. Try again in a minute.');
    const scope = await this.authorizedScope(user.id, courseId, documentIds);
    await this.requireConsistentIndex();
    const rid = this.requestId(requestId);
    const r = await this.ai.call('POST', '/api/v1/rag/answer', {
      body: { schema_version: 'rag.v1', request_id: rid, question, scope }, timeoutMs: this.config.answerTimeoutMs, requestId: rid,
    });
    if (r.kind !== 'response' || r.status !== 200) throw this.mapFailure(r, 'answer');
    this.assertWithinScope(scope, r.body, 'answer');
    this.log.log({ event: 'rag.answered', request_id: rid, course_id: courseId, user_id: user.id, scope_size: scope.document_ids.length,
      outcome: r.body?.outcome ?? null, support_status: r.body?.support_status ?? null });
    return { ...r.body, documents: await this.documentsMap(r.body) };
  }

  /** Evidence retrieval for WBS-6/7 (a service method, not a browser route in Phase 1). */
  async retrieveEvidence(userId: string, courseId: string, question: string, opts: { documentIds?: string[]; topK?: number; maxEvidence?: number; requestId?: string } = {}) {
    const scope = await this.authorizedScope(userId, courseId, opts.documentIds);
    await this.requireConsistentIndex();
    const rid = this.requestId(opts.requestId);
    const params: Record<string, number> = {};
    if (opts.topK) params.top_k = opts.topK;
    if (opts.maxEvidence) params.max_evidence = opts.maxEvidence;
    const r = await this.ai.call('POST', '/api/v1/rag/retrieve', {
      body: { schema_version: 'rag.v1', request_id: rid, question, scope, ...(Object.keys(params).length ? { params } : {}) },
      timeoutMs: this.config.retrieveTimeoutMs, requestId: rid,
    });
    if (r.kind !== 'response' || r.status !== 200) throw this.mapFailure(r, 'retrieve');
    this.assertWithinScope(scope, r.body, 'retrieve');
    return { ...r.body, documents: await this.documentsMap(r.body) };
  }
}
