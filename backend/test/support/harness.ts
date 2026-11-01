/** API-suite harness: the real NestJS app on a real MySQL test database, with the FAKE ai-service
 *  (test/support/fake-ai.ts). Schedulers are disabled; tests call dispatch/sweep/purge explicitly. */
import { INestApplication } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import request from 'supertest';

import { EmbeddingConfiguration, fingerprint, IndexVersionService } from '../../src/ai/index-versions';
import { hashPassword } from '../../src/auth/auth.service';
import { createApp } from '../../src/bootstrap';
import { JsonLogger } from '../../src/common/logging';
import { AppConfig, loadConfig } from '../../src/config/config';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { JobsService } from '../../src/jobs/jobs.service';
import { E5_SMALL_MVP } from '../../scripts/seed';
import { prepareDatabase, testDatabaseUrl, truncateAll } from './db';
import { FakeAiService } from './fake-ai';

export const PASSWORD = 'correct-horse-battery';
export const CALLBACK_TOKEN = 'cb-test-token-0123456789';
export const RAG_TOKEN = 'rag-test-token-0123456789';
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

jest.setTimeout(30_000); // API tests do several logins + real MySQL round trips

let passwordHash: Promise<string> | null = null;

/** Wraps an async-built supertest request (boxed, because a Test is thenable) so callers can `await` it or chain `.expect(...)`. */
export function chain(boxed: Promise<{ test: request.Test }>) {
  return {
    expect: async (x: number | ((r: request.Response) => void), body?: unknown) =>
      body === undefined ? (await boxed).test.expect(x as number) : (await boxed).test.expect(x as number, body),
    then: <T>(ok: (r: request.Response) => T, err?: (e: unknown) => T) => boxed.then(({ test }) => test).then(ok, err),
  };
}

export interface World {
  users: { admin: string; instructor: string; ayse: string; mehmet: string; outsider: string };
  courses: { vy: string; os: string };
  ivId: string;
  fingerprint: string;
}

export class Harness {
  app!: INestApplication;
  prisma!: PrismaClient;
  ai = new FakeAiService();
  config!: AppConfig;
  storageRoot = '';
  url = '';
  world!: World;
  private tokens = new Map<string, string>();

  async start(overrides: Partial<AppConfig> = {}, logger: JsonLogger | false = false): Promise<this> {
    await this.ai.start();
    this.prisma = await prepareDatabase();
    this.storageRoot = mkdtempSync(path.join(tmpdir(), 'knot-storage-'));
    this.config = {
      ...loadConfig({
        DATABASE_URL: testDatabaseUrl(), JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123', STORAGE_ROOT: this.storageRoot,
        AI_SERVICE_URL: this.ai.url, RAG_INTERNAL_API_TOKEN: RAG_TOKEN, INGEST_CALLBACK_TOKEN: CALLBACK_TOKEN, SCHEDULER_ENABLED: 'false',
        LOGIN_RATE_LIMIT_PER_MINUTE: '10000', // each test logs in afresh; auth.spec tests the limit itself
      }),
      ...overrides,
    };
    this.app = await createApp(this.config, { logger });
    await this.app.listen(0, '127.0.0.1'); // supertest must not open/close ephemeral servers per request
    this.url = await this.app.getUrl();
    return this;
  }

  async stop(): Promise<void> {
    await this.app?.close();
    await this.prisma?.$disconnect();
    await this.ai.stop();
    rmSync(this.storageRoot, { recursive: true, force: true });
  }

  http() {
    return request(this.app.getHttpServer());
  }

  get jobs(): JobsService {
    return this.app.get(JobsService);
  }

  /** Fresh database + fixture world: 5 users, 2 courses, an ACTIVE IndexVersion (default: the
   *  ADR-010 e5-small configuration). */
  async reset(embedding: EmbeddingConfiguration = E5_SMALL_MVP, collection = 'knot_chunks_v1'): Promise<World> {
    await truncateAll(this.prisma);
    this.ai.reset();
    this.tokens.clear();
    passwordHash ??= hashPassword(PASSWORD);
    const hash = await passwordHash;
    const mk = (email: string, role: 'USER' | 'ADMIN' = 'USER') =>
      this.prisma.user.create({ data: { email, displayName: email.split('@')[0], passwordHash: hash, role } }).then((u) => u.id);
    const users = {
      admin: await mk('admin@knot.test', 'ADMIN'),
      instructor: await mk('aydin@knot.test'),
      ayse: await mk('ayse@knot.test'),
      mehmet: await mk('mehmet@knot.test'),
      outsider: await mk('outsider@knot.test'),
    };
    const vy = (await this.prisma.course.create({ data: { code: 'BIL 211', name: 'Veri Yapıları', term: 'Güz 2026', instructorName: 'Doç. Dr. M. Aydın' } })).id;
    const os = (await this.prisma.course.create({ data: { code: 'BIL 304', name: 'İşletim Sistemleri', term: 'Güz 2026' } })).id;
    await this.prisma.courseMembership.createMany({
      data: [
        { userId: users.instructor, courseId: vy, role: 'INSTRUCTOR' },
        { userId: users.ayse, courseId: vy, role: 'STUDENT' },
        { userId: users.mehmet, courseId: vy, role: 'STUDENT' },
        { userId: users.mehmet, courseId: os, role: 'STUDENT' },
      ],
    });
    const fp = fingerprint(embedding);
    const iv = await this.prisma.indexVersion.create({
      data: {
        collectionName: collection, embeddingBackend: embedding.backend, embeddingModel: embedding.model,
        embeddingRevision: embedding.revision, embeddingDimension: embedding.dimension, queryPrefix: embedding.query_prefix,
        documentPrefix: embedding.document_prefix, normalize: embedding.normalize, distance: embedding.distance,
        embeddingFingerprint: fp, chunkerVersion: 'c1', status: 'ACTIVE', activatedAt: new Date(),
      },
    });
    this.ai.readyIndex = { collection, embedding_fingerprint: fp, index_version_id: iv.id };
    this.world = { users, courses: { vy, os }, ivId: iv.id, fingerprint: fp };
    this.app.get(IndexVersionService).invalidate();
    return this.world;
  }

  async token(who: keyof World['users']): Promise<string> {
    if (!this.tokens.has(who)) {
      const email = { admin: 'admin', instructor: 'aydin', ayse: 'ayse', mehmet: 'mehmet', outsider: 'outsider' }[who] + '@knot.test';
      const res = await this.http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
      this.tokens.set(who, res.body.access_token);
    }
    return this.tokens.get(who)!;
  }

  async as(who: keyof World['users']) {
    return { Authorization: `Bearer ${await this.token(who)}` };
  }

  /** Multipart upload; the result can be awaited (→ Response) or chained with `.expect(...)`. */
  upload(who: keyof World['users'], courseId: string, opts: { file?: Buffer; name?: string; type?: string; visibility?: string; title?: string } = {}) {
    return chain((async () => {
      const req = this.http().post(`/courses/${courseId}/documents`).set(await this.as(who))
        .field('document_type', opts.type ?? 'slide');
      if (opts.visibility) req.field('visibility', opts.visibility);
      if (opts.title) req.field('title', opts.title);
      return { test: req.attach('file', opts.file ?? PDF, { filename: opts.name ?? 'hafta4.pdf', contentType: 'application/pdf' }) };
    })());
  }

  /** Uploads and asserts 201; returns the DocumentDto. */
  async uploadOk(who: keyof World['users'], courseId: string, opts: Parameters<Harness['upload']>[2] = {}) {
    const r = await this.upload(who, courseId, opts);
    if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  /** Sends a callback event as the Python worker would. */
  event(jobId: string, ev: Record<string, unknown>, token = CALLBACK_TOKEN) {
    return this.http().post(`/internal/v1/ingestion-jobs/${jobId}/events`).set('Authorization', `Bearer ${token}`).send(ev);
  }

  async activeJob(documentId: string) {
    const d = await this.prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    return d.activeJobId ? this.prisma.documentProcessingJob.findUniqueOrThrow({ where: { id: d.activeJobId } }) : null;
  }

  /** Drives a document to READY through the real callback path (fake Python accepts dispatch). */
  async makeReady(documentId: string, pageTexts: string[] = ['Sayfa bir', 'Sayfa iki']): Promise<void> {
    this.ai.on('POST', '/api/v1/ingestion/jobs', () => ({ status: 202, body: { accepted: true, duplicate: false, worker_id: 'ai-fake01', queue_position: 0 } }));
    const job = (await this.activeJob(documentId))!;
    await this.jobs.dispatchOne(job.id);
    const base = { schema_version: 'ingest.v1', job_id: job.id, document_id: documentId, attempt: job.attempt, worker_id: 'ai-fake01', emitted_at: new Date().toISOString() };
    let seq = 0;
    for (const stage of ['EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING']) {
      await this.event(job.id, { ...base, seq: ++seq, type: 'STAGE', stage, progress: 0.5 }).expect(200);
    }
    await this.writeArtifact(documentId, 'c1', pageTexts);
    await this.event(job.id, {
      ...base, seq: ++seq, type: 'SUCCEEDED', stage: 'INDEXING', progress: 1,
      result: { page_count: pageTexts.length, chunk_count: pageTexts.length, indexing_version: 'c1', collection: 'knot_chunks_v1',
        embedding_fingerprint: this.world.fingerprint, pages_artifact_key: `documents/${documentId}/pages.c1.json` },
    }).expect(200);
  }

  async writeArtifact(documentId: string, iv: string, pageTexts: string[]): Promise<void> {
    const { promises: fs } = await import('node:fs');
    let pos = 0;
    const pages = pageTexts.map((text, i) => {
      const p = { page: i + 1, char_start: pos, char_end: pos + [...text].length, text };
      pos = p.char_end + 2;
      return p;
    });
    const dir = path.join(this.storageRoot, 'documents', documentId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `pages.${iv}.json`), JSON.stringify({
      schema_version: 'pages.v1', document_id: documentId, indexing_version: iv, page_count: pages.length, separator: '\n\n', pages,
    }));
  }
}
