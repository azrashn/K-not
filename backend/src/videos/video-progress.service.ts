import { Inject, Injectable } from '@nestjs/common';
import { ApiError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AccessService } from '../courses/access.service';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service';
import { mergeWatched, progressView, WatchInterval } from './watch-intervals';

@Injectable()
export class VideoProgressService {
  private readonly base: string;
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService,
    @Inject(APP_CONFIG) config: AppConfig) {
    this.base = (config.videoServiceUrl || 'http://127.0.0.1:7862').replace(/\/+$/, '');
  }
  async scope(user: AuthUser, courseId: string, videoId: string) {
    await this.access.requireMember(user, courseId);
    const video = await this.prisma.video.findFirst({ where: { id: videoId, courseId, ownerId: user.id } });
    if (!video || !/^up_[a-f0-9]{10}$/.test(video.engineVideoId)) throw notFound('Video');
    return video;
  }
  private async duration(video: { id: string; engineVideoId: string; durationMs: number | null }) {
    if (video.durationMs != null && video.durationMs > 0) return video.durationMs;
    let metadata: any;
    try {
      const response = await fetch(`${this.base}/api/local/metadata/${video.engineVideoId}`,
        { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      metadata = await response.json();
    } catch { throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video süresi okunamadı. İzleme kaydı için video servisini kontrol edin.'); }
    if (metadata?.video_id !== video.engineVideoId || !Number.isSafeInteger(metadata.duration_ms) ||
        metadata.duration_ms <= 0 || metadata.duration_ms > 604800000) {
      throw new ApiError('INTERNAL_ERROR', 'Video süresi doğrulanamadı.');
    }
    await this.prisma.video.update({ where: { id: video.id }, data: { durationMs: metadata.duration_ms } });
    return metadata.duration_ms as number;
  }
  async get(user: AuthUser, courseId: string, videoId: string) {
    const video = await this.scope(user, courseId, videoId);
    const duration = await this.duration(video);
    const row = await this.prisma.videoProgress.findUnique({ where: { videoId_userId: { videoId, userId: user.id } } });
    return progressView(videoId, duration, row);
  }
  async save(user: AuthUser, courseId: string, videoId: string, position: number, additions: WatchInterval[]) {
    const video = await this.scope(user, courseId, videoId);
    const duration = await this.duration(video);
    if (!Number.isSafeInteger(position) || position < 0 || position > duration) {
      throw new ApiError('VALIDATION_ERROR', 'Oynatma konumu video süresinin içinde olmalıdır.');
    }
    if (additions.length > 60 || additions.some(i => i.end_ms - i.start_ms > 120000)) {
      throw new ApiError('VALIDATION_ERROR', 'İzleme kayıtları kısa aralıklar halinde gönderilmelidir.');
    }
    mergeWatched(additions, duration);
    // Optimistic revision retries preserve the interval union across tabs/processes.
    // Position uses the latest committed request; it never defines watched time.
    for (let attempt = 0; attempt < 5; attempt++) {
      const where = { videoId_userId: { videoId, userId: user.id } };
      const previous = await this.prisma.videoProgress.findUnique({ where });
      const intervals = mergeWatched([...(previous?.intervals || []) as unknown as WatchInterval[], ...additions], duration);
      if (!previous) {
        try {
          const row = await this.prisma.videoProgress.create({ data: { videoId, userId: user.id, positionMs: position,
            intervals: intervals.map(i => ({ start_ms: i.start_ms, end_ms: i.end_ms })), revision: 1 } });
          return progressView(videoId, duration, row);
        } catch (error) { if (!isUniqueViolation(error)) throw error; continue; }
      }
      const changed = await this.prisma.videoProgress.updateMany({
        where: { videoId, userId: user.id, revision: previous.revision },
        data: { positionMs: position, intervals: intervals.map(i => ({ start_ms: i.start_ms, end_ms: i.end_ms })), revision: { increment: 1 } },
      });
      if (changed.count) return progressView(videoId, duration,
        { positionMs: position, intervals, revision: previous.revision + 1 });
    }
    throw new ApiError('JOB_ALREADY_RUNNING', 'İzleme kaydı başka bir oturumda güncelleniyor. Tekrar deneyin.');
  }
}
