/** Authenticated, course-scoped bridge. Engine IDs/URLs never define authorization. */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiError, notFound } from '../common/errors';
import { newId } from '../common/ids';
import type { AuthUser } from '../common/request-context';
import { RateLimiter } from '../common/rate-limit';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AccessService } from '../courses/access.service';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service';
import { canonicalVideoLink } from './video-link';

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const ENGINE_ID = /^up_[a-f0-9]{10}$/;
export interface EngineVideo { id: string; status: string; frame_count?: number; progress?: number; error?: string; transcript_note?: string }
export interface EngineCitation { video_id: string; n: number; idx?: number | null; ms: number; t_start: number; t_end: number; transcript?: string; timestamp?: string; [key: string]: unknown }

export function validateVideo(file?: Express.Multer.File): Express.Multer.File {
  if (!file?.buffer?.length) throw new ApiError('VALIDATION_ERROR', 'Bir video dosyası seçin.');
  if (file.size > VIDEO_MAX_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'Video en fazla 100 MB olabilir.');
  const mp4 = file.buffer.length >= 12 && file.buffer.toString('ascii', 4, 8) === 'ftyp';
  const webm = file.buffer.length >= 4 && file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if ((!mp4 && !webm) || !/\.(mp4|webm)$/i.test(file.originalname)) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'MP4 veya WebM video yükleyin.');
  }
  return file;
}

@Injectable()
export class VideosService {
  private readonly limiter = new RateLimiter(12);
  private readonly base: string;
  private readonly importing = new Set<string>();
  // This local profile runs one Nest process. Upload and deletion of identical
  // bytes must not race the engine's physical file cleanup.
  private readonly contentWrites = new Map<string, Promise<void>>();
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService,
    @Inject(APP_CONFIG) config: AppConfig) {
    this.base = (config.videoServiceUrl || 'http://127.0.0.1:7862').replace(/\/+$/, '');
  }

  private async upstream(path: string, init: RequestInit = {}, timeout = 20000, allowMissing = false): Promise<Response> {
    try {
      const r = await fetch(this.base + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout) });
      if (!r.ok && !(allowMissing && r.status === 404)) throw new Error(`video service HTTP ${r.status}`);
      return r;
    } catch {
      throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video servisine ulaşılamadı. MomentSearch durumunu kontrol edin.', null, true);
    }
  }
  private async json(path: string, body?: unknown, timeout?: number): Promise<any> {
    const r = await this.upstream(path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, timeout);
    return r.json();
  }
  private async owned(user: AuthUser, courseId: string, id: string) {
    await this.access.requireMember(user, courseId);
    const row = await this.prisma.video.findFirst({ where: { id, courseId, ownerId: user.id } });
    if (!row || !ENGINE_ID.test(row.engineVideoId)) throw notFound('Video');
    return row;
  }
  private async describe(row: { id: string; title: string; createdAt: Date; engineVideoId: string }) {
    const response = await this.upstream(`/api/videos/${row.engineVideoId}`, {}, 20000, true);
    // An interruption after engine cleanup must leave the local row removable
    // in the UI instead of making the entire course list fail.
    if (response.status === 404) return { id: row.id, title: row.title, created_at: row.createdAt,
      status: 'failed', frame_count: 0, progress: null, transcript_note: null,
      error: 'Video verisi bulunamadı. Kaydı kaldırıp videoyu yeniden ekleyebilirsiniz.' };
    const v = await response.json() as EngineVideo;
    if (v.id !== row.engineVideoId) throw new ApiError('INTERNAL_ERROR', 'Video servisi geçersiz kayıt döndürdü.');
    return { id: row.id, title: row.title, created_at: row.createdAt, status: v.status,
      frame_count: v.frame_count ?? 0, progress: v.progress ?? null,
      transcript_note: v.transcript_note ? 'Transkript hazırlanamadı; kareler üzerinden arama kullanılabilir.' : null,
      error: v.status === 'failed' ? 'Video işlenemedi. Yeniden deneyebilirsiniz.' : null };
  }
  async list(user: AuthUser, courseId: string) {
    await this.access.requireMember(user, courseId);
    const rows = await this.prisma.video.findMany({ where: { courseId, ownerId: user.id }, orderBy: { createdAt: 'desc' } });
    return { videos: await Promise.all(rows.map(r => this.describe(r))), visibility: 'PRIVATE' };
  }
  async upload(user: AuthUser, courseId: string, input?: Express.Multer.File) {
    await this.access.requireMember(user, courseId);
    const file = validateVideo(input);
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    return this.withContentLock(hash, () => this.store(user, courseId, file, hash));
  }
  private async withContentLock<T>(hash: string, action: () => Promise<T>): Promise<T> {
    const previous = this.contentWrites.get(hash) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.contentWrites.set(hash, current);
    await previous;
    try { return await action(); }
    finally { release(); if (this.contentWrites.get(hash) === current) this.contentWrites.delete(hash); }
  }
  private async store(user: AuthUser, courseId: string, file: Express.Multer.File, hash: string) {
    const existing = await this.prisma.video.findUnique({ where: { courseId_ownerId_contentSha256: {
      courseId, ownerId: user.id, contentSha256: hash,
    } } });
    if (existing) return this.describe(existing);
    // Reuse a pending asset too: the engine deduplicates only indexed files.
    // Identical bytes never grant access to someone else's Knot record.
    const reference = await this.prisma.video.findFirst({ where: { contentSha256: hash } });
    const p = reference ? { mode: 'exists', video_id: reference.engineVideoId } :
      await this.json('/api/videos/presign', { filename: file.originalname,
        content_type: /\.webm$/i.test(file.originalname) ? 'video/webm' : 'video/mp4', size: file.size, sha256: hash });
    if (!ENGINE_ID.test(p.video_id) || !['exists', 'direct'].includes(p.mode)) {
      throw new ApiError('INTERNAL_ERROR', 'Video servisi yerel yükleme sözleşmesini karşılamıyor.');
    }
    if (p.mode === 'direct') {
      // Reconstruct a constrained path. Never follow a URL supplied by upstream.
      const key = String(p.key || '');
      if (!/^local\/up_[a-f0-9]{10}\/source\.(mp4|webm)$/.test(key) || !key.includes(`/${p.video_id}/`)) {
        throw new ApiError('INTERNAL_ERROR', 'Geçersiz video depolama anahtarı.');
      }
      await this.upstream(`/api/videos/${p.video_id}/content?key=${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(file.buffer),
      }, 120000);
      const registered = await this.json('/api/videos', { video_id: p.video_id, key, title: file.originalname.slice(0, 300) });
      if (registered.video_id !== p.video_id) throw new ApiError('INTERNAL_ERROR', 'Video kayıt kimliği uyuşmuyor.');
    }
    let row;
    try {
      row = await this.prisma.video.create({ data: { id: newId(), courseId, ownerId: user.id,
        title: file.originalname.slice(0, 300), originalFilename: file.originalname.slice(0, 255),
        contentSha256: hash, engineVideoId: p.video_id } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      row = await this.prisma.video.findUniqueOrThrow({ where: { courseId_ownerId_contentSha256: { courseId, ownerId: user.id, contentSha256: hash } } });
    }
    return this.describe(row);
  }
  async remove(user: AuthUser, courseId: string, id: string) {
    const initial = await this.owned(user, courseId, id);
    return this.withContentLock(initial.contentSha256, async () => {
      const row = await this.owned(user, courseId, id);
      const references = await this.prisma.video.count({ where: { engineVideoId: row.engineVideoId } });
      let retained = references > 1;
      if (!retained) {
        let response: Response;
        try {
          response = await fetch(`${this.base}/api/videos/${row.engineVideoId}?preserve_sessions=true`, {
            method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(60000),
          });
        } catch { throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video silinemedi. Video servisini kontrol edip yeniden deneyin.'); }
        if (response.status === 409) throw new ApiError('JOB_ALREADY_RUNNING', 'Video şu anda işleniyor. İşlem tamamlandığında tekrar kaldırabilirsiniz.');
        if (!response.ok && response.status !== 404) {
          throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video tamamen silinemedi. Kayıt korundu; yeniden deneyin.');
        }
        // 404 supports retry after an interrupted deletion between the two stores.
        if (response.ok) {
          const result = await response.json();
          if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true ||
            !('video_id' in result) || result.video_id !== row.engineVideoId) throw new ApiError('INTERNAL_ERROR', 'Video silme sonucu doğrulanamadı.');
          retained = 'retained' in result && result.retained === true;
        }
      }
      await this.prisma.video.delete({ where: { id: row.id } });
      return { deleted: true, shared_asset_retained: retained };
    });
  }
  async importLink(user: AuthUser, courseId: string, input: string) {
    await this.access.requireMember(user, courseId);
    const url = canonicalVideoLink(input);
    if (this.importing.has(user.id)) throw new ApiError('JOB_ALREADY_RUNNING', 'Bağlantıdan bir video zaten alınıyor. Tamamlanmasını bekleyin.');
    if (!this.limiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Biraz bekleyip tekrar deneyin.');
    this.importing.add(user.id);
    try {
      let response: Response;
      try {
        response = await fetch(this.base + '/api/local/import-file', {
          method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }), signal: AbortSignal.timeout(195000),
        });
      } catch { throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video bağlantısı alınamadı. Video servisinin açık olduğunu kontrol edin.'); }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 413) throw new ApiError('PAYLOAD_TOO_LARGE', 'Bağlantıdaki video 100 MB sınırını aşıyor. Daha kısa bir video seçin.');
        if (response.status === 429) throw new ApiError('RATE_LIMITED', 'Başka bir video bağlantısı alınıyor. Biraz sonra tekrar deneyin.');
        if (response.status === 504) throw new ApiError('PROVIDER_TIMEOUT', 'Video indirmesi üç dakikada tamamlanamadı. Tekrar deneyin veya dosya yükleyin.');
        throw new ApiError('VALIDATION_ERROR', 'Video indirilemedi. YouTube videosu herkese açık olmalı; Drive için “Bağlantıya sahip herkes” erişimini açın. Giriş isteyen, canlı veya kısıtlı videolar alınamaz. Dosyayı indirip yüklemeyi de deneyebilirsiniz.');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError('INTERNAL_ERROR', 'Video servisi boş dosya döndürdü.');
      const buffers: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > VIDEO_MAX_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 'Video en fazla 100 MB olabilir.');
          buffers.push(value);
        }
      } finally { await reader.cancel(); }
      let title = 'Video';
      try { title = decodeURIComponent(response.headers.get('x-video-title') || 'Video'); } catch { /* Safe fallback. */ }
      title = title.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, ' ').trim().replace(/\.(mp4|webm)$/i, '').slice(0, 200) || 'Video';
      const ext = response.headers.get('x-video-extension') === '.webm' ? '.webm' : '.mp4';
      return await this.upload(user, courseId, { originalname: title + ext, size, buffer: Buffer.concat(buffers) } as Express.Multer.File);
    } finally { this.importing.delete(user.id); }
  }
  async retry(user: AuthUser, courseId: string, id: string) {
    const row = await this.owned(user, courseId, id);
    const v: EngineVideo = await this.json(`/api/videos/${row.engineVideoId}`);
    if (v.status !== 'failed') throw new ApiError('NOT_RETRYABLE', 'Yalnızca başarısız videolar yeniden işlenebilir.');
    await this.json(`/api/videos/${row.engineVideoId}/retry`, {});
    return this.describe(row);
  }
  async transcript(user: AuthUser, courseId: string, id: string) {
    const row = await this.owned(user, courseId, id);
    const t = await this.json(`/api/transcript/${row.engineVideoId}`);
    if (t.video_id !== row.engineVideoId || !Array.isArray(t.chunks)) throw new ApiError('INTERNAL_ERROR', 'Geçersiz transkript.');
    return { video_id: id, chunks: t.chunks.map((c: any) => ({ text: String(c.text || ''),
      start_seconds: Number(c.t_start), end_seconds: Number(c.t_end) })) };
  }
  async frames(user: AuthUser, courseId: string, id: string) {
    const row = await this.owned(user, courseId, id);
    // Dedicated read-only bridge endpoint; frame idx is not a timestamp.
    const data = await this.json(`/api/local/frames/${row.engineVideoId}`);
    if (data.video_id !== row.engineVideoId || !Array.isArray(data.frames)) throw new ApiError('INTERNAL_ERROR', 'Geçersiz kare listesi.');
    if (data.frames.some((f: any) => !Number.isInteger(f.idx) || f.idx < 0 || f.idx > 10000 || !Number.isFinite(f.ms) || f.ms < 0)) {
      throw new ApiError('INTERNAL_ERROR', 'Geçersiz kare zamanı.');
    }
    return { frames: data.frames.map((f: any) => ({ index: f.idx, timestamp_ms: f.ms }))
      .sort((a: { timestamp_ms: number }, b: { timestamp_ms: number }) => a.timestamp_ms - b.timestamp_ms) };
  }
  async media(user: AuthUser, courseId: string, id: string, index?: number) {
    const row = await this.owned(user, courseId, id);
    if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > 10000)) throw notFound('Frame');
    return this.upstream(index === undefined ? `/api/video/${row.engineVideoId}?u=local` :
      `/api/frame/${row.engineVideoId}/${String(index).padStart(6, '0')}.jpg?u=local`, {}, 120000);
  }
}
