/**
 * IndexVersion helpers and the NestJS ↔ Python consistency guard (api-contracts.md §6, C-1):
 * `/ready` must report the ACTIVE IndexVersion's collection and fingerprint. On mismatch,
 * answers return 503 INDEX_VERSION_MISMATCH and ingestion dispatch pauses. There is no fallback
 * to another model or collection.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { APP_CONFIG, AppConfig } from '../config/config';
import type { IndexVersion } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from './ai-client';

export interface EmbeddingConfiguration {
  backend: string;
  model: string;
  revision: string | null;
  dimension: number;
  query_prefix: string;
  document_prefix: string;
  normalize: boolean;
  distance: string;
}

export function embeddingConfiguration(iv: IndexVersion): EmbeddingConfiguration {
  return {
    backend: iv.embeddingBackend,
    model: iv.embeddingModel,
    revision: iv.embeddingRevision,
    dimension: iv.embeddingDimension,
    query_prefix: iv.queryPrefix,
    document_prefix: iv.documentPrefix,
    normalize: iv.normalize,
    distance: iv.distance,
  };
}

/** Same algorithm as Python `EmbeddingConfiguration.fingerprint()` (document-contract.md §4). */
export function fingerprint(c: EmbeddingConfiguration): string {
  const sorted = Object.keys(c).sort().reduce<Record<string, unknown>>((o, k) => {
    o[k] = (c as unknown as Record<string, unknown>)[k];
    return o;
  }, {});
  return 'sha256:' + createHash('sha256').update(JSON.stringify(sorted), 'utf8').digest('hex');
}

export type GuardState =
  | { state: 'ok'; checkedAt: number }
  | { state: 'mismatch'; checkedAt: number; reason: string }
  | { state: 'unavailable'; checkedAt: number }
  | { state: 'no_active_version'; checkedAt: number };

@Injectable()
export class IndexVersionService {
  private readonly log = new Logger('index-version');
  private guard: GuardState | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  active(): Promise<IndexVersion | null> {
    return this.prisma.indexVersion.findFirst({ where: { status: 'ACTIVE' } });
  }

  /** Compares `/ready` with the ACTIVE IndexVersion. `/ready` may be 503 only because nothing
   *  is indexed yet; the identity fields are still reported and are what is compared. */
  async check(): Promise<GuardState> {
    const now = Date.now();
    const iv = await this.active();
    if (!iv) return (this.guard = { state: 'no_active_version', checkedAt: now });
    const r = await this.ai.call('GET', '/ready', { timeoutMs: 5_000 });
    if (r.kind !== 'response' || !r.body || typeof r.body !== 'object') return (this.guard = { state: 'unavailable', checkedAt: now });
    const idx = r.body.index;
    let reason: string | null = null;
    if (!idx) reason = 'ai-service /ready has no index identity (pre-C-1 service)';
    else if (idx.collection !== iv.collectionName) reason = 'collection differs from the ACTIVE IndexVersion';
    else if (idx.embedding_fingerprint !== iv.embeddingFingerprint) reason = 'embedding fingerprint differs from the ACTIVE IndexVersion';
    else if (idx.index_version_id && idx.index_version_id !== iv.id) reason = 'collection is stamped with another index version';
    const prev = this.guard?.state;
    this.guard = reason ? { state: 'mismatch', checkedAt: now, reason } : { state: 'ok', checkedAt: now };
    if (reason && prev !== 'mismatch') {
      this.log.error({ event: 'index.version_mismatch', reason, collection: iv.collectionName, expected_fingerprint: iv.embeddingFingerprint,
        reported_fingerprint: idx?.embedding_fingerprint ?? null });
    }
    return this.guard;
  }

  /** Cached guard state, refreshed when older than the check interval. */
  async state(): Promise<GuardState> {
    if (!this.guard || Date.now() - this.guard.checkedAt > this.config.readyCheckIntervalMs || this.guard.state !== 'ok') {
      return this.check();
    }
    return this.guard;
  }
}
