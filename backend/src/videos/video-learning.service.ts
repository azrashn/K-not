import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiError, notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { RateLimiter } from '../common/rate-limit';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AccessService } from '../courses/access.service';
import { PrismaService } from '../prisma/prisma.service';
import { classifyLearning, type LearningState } from './learning-state';
import type { EngineCitation } from './videos.service';

export interface LearningQuestion { current_time_ms?: number; explain_now?: boolean; evidence_id?: string }
interface Selection { ownerId: string; courseId: string; videoId: string; engineId: string; question: string;
  expires: number; raw: any }
const GUIDANCE: Record<LearningState, string> = {
  WATCHED: 'İlgili bölüm kayıtlı izleme aralıklarında bulunuyor.',
  PARTIALLY_WATCHED: 'İlgili bölümün yalnızca bir kısmı izleme kaydında var. Bölüme geçebilir veya konuyu şimdi açıklamamı isteyebilirsin.',
  UNWATCHED: 'Bu konu videonun izleme kaydına henüz girmeyen bir bölümünde anlatılıyor. İstersen ilgili bölüme geçebilir veya konuyu şimdi açıklamamı isteyebilirsin.',
  UNKNOWN: 'Bu bölümün izlenme durumunu güvenilir biçimde belirleyemedim. Kaynağa geçebilir veya şimdi açıklama isteyebilirsin.',
};

@Injectable()
export class VideoLearningService {
  private readonly base: string;
  private readonly limiter = new RateLimiter(12);
  private readonly selections = new Map<string, Selection>();
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService,
    @Inject(APP_CONFIG) config: AppConfig) { this.base = (config.videoServiceUrl || 'http://127.0.0.1:7862').replace(/\/+$/, ''); }

  private async call(path: string, body: unknown, timeout: number): Promise<any> {
    let response: Response;
    try { response = await fetch(this.base + path, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
    catch { throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video kaynak servisine ulaşılamadı. Yeniden deneyin.'); }
    if (response.status === 409) throw new ApiError('NOT_RETRYABLE', 'Kaynak seçimi güncelliğini yitirdi. Soruyu yeniden gönderin.');
    if (!response.ok) throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Video kaynağı veya açıklama alınamadı. Yeniden deneyin.');
    return response.json();
  }
  private citations(raw: any, engineId: string, duration: number): EngineCitation[] {
    const list = raw?.citations;
    if (!Array.isArray(list) || list.length > 10 || list.some(c => c.video_id !== engineId ||
      !Number.isInteger(c.n) || c.n < 1 || c.n > 10 || !Number.isFinite(c.ms) || c.ms < 0 || c.ms > duration ||
      !Number.isFinite(c.t_start) || !Number.isFinite(c.t_end) || c.t_start < 0 || c.t_end <= c.t_start || c.t_end * 1000 > duration + 1000 ||
      typeof c.transcript !== 'string' || c.transcript.length > 20000 ||
      (c.idx != null && (!Number.isInteger(c.idx) || c.idx < 0 || c.idx > 10000)))) {
      throw new ApiError('INTERNAL_ERROR', 'Video kaynağı yetkili kapsam veya gerçek zaman aralığı dışında.');
    }
    if (new Set(list.map(c => c.n)).size !== list.length) throw new ApiError('INTERNAL_ERROR', 'Kaynak numaraları doğrulanamadı.');
    return list;
  }
  private background(raw: any) {
    const allowed = new Set([
      'https://github.com/kevin-wayne/algs4/blob/master/src/main/java/edu/princeton/cs/algs4/PrimMST.java',
      'https://github.com/kevin-wayne/algs4/blob/master/src/main/java/edu/princeton/cs/algs4/DijkstraSP.java',
    ]);
    return (Array.isArray(raw.background_references) ? raw.background_references : []).filter((r: any) =>
      r.kind === 'VERIFIED_BACKGROUND' && r.is_video_evidence === false && allowed.has(r.url))
      .map((r: any) => ({ kind: 'VERIFIED_BACKGROUND', is_video_evidence: false, concept: String(r.concept),
        statement: String(r.statement), source: String(r.source), url: r.url }));
  }
  async ask(user: AuthUser, courseId: string, videoId: string, question: string, options: LearningQuestion = {}) {
    await this.access.requireMember(user, courseId);
    const video = await this.prisma.video.findFirst({ where: { id: videoId, courseId, ownerId: user.id } });
    if (!video || !/^up_[a-f0-9]{10}$/.test(video.engineVideoId)) throw notFound('Video');
    if (!this.limiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Biraz bekleyip tekrar deneyin.');
    const now = Date.now();
    for (const [key, value] of this.selections) if (value.expires < now) this.selections.delete(key);
    let id: string, selection: Selection;
    if (options.explain_now) {
      const previous = options.evidence_id ? this.selections.get(options.evidence_id) : undefined;
      if (!previous || previous.ownerId !== user.id || previous.courseId !== courseId || previous.videoId !== videoId ||
          previous.question !== question || previous.engineId !== video.engineVideoId) {
        throw new ApiError('NOT_RETRYABLE', 'Geçerli bir kaynak seçimi bulunamadı. Soruyu yeniden gönderin.');
      }
      id = options.evidence_id!; selection = previous;
    } else {
      const raw = await this.call('/api/local/video-evidence', { question, video_id: video.engineVideoId,
        ...(options.current_time_ms === undefined ? {} : { current_time_ms: options.current_time_ms }) }, 30000);
      if (raw.video_id !== video.engineVideoId || !Number.isSafeInteger(raw.duration_ms) || raw.duration_ms <= 0 || raw.duration_ms > 604800000) {
        throw new ApiError('INTERNAL_ERROR', 'Video kaynak metadata bilgisi doğrulanamadı.');
      }
      this.citations(raw, video.engineVideoId, raw.duration_ms);
      id = randomUUID(); selection = { ownerId: user.id, courseId, videoId, engineId: video.engineVideoId,
        question, expires: now + 600000, raw };
      if (raw.citations.length) {
        if (typeof raw.selection_id !== 'string' || !/^[a-f0-9]{32}$/.test(raw.selection_id)) throw new ApiError('INTERNAL_ERROR', 'Kaynak seçimi doğrulanamadı.');
        while (this.selections.size >= 128) this.selections.delete(this.selections.keys().next().value!);
        this.selections.set(id, selection);
      }
    }
    const raw = selection.raw;
    const citations = this.citations(raw, video.engineVideoId, raw.duration_ms);
    const first = citations[0];
    const span = first ? { start_ms: Math.round(first.t_start * 1000), end_ms: Math.min(raw.duration_ms, Math.round(first.t_end * 1000)) } : null;
    // Reread trusted data for EVERY request, including Explain now. Never accept
    // watched intervals, a global percent or user identity from the browser.
    const progress = await this.prisma.videoProgress.findUnique({ where: { videoId_userId: { videoId, userId: user.id } } });
    const learning = classifyLearning(span, progress?.intervals);
    const common = { question, learning_state: learning.state, observed_coverage: learning.coverage,
      learning_basis: 'PRIMARY_RETRIEVED_TRANSCRIPT_SPAN', progress_revision: progress?.revision ?? null,
      evidence_id: first ? id : null, relevant_segment: span ? { ...span, video_id: videoId, title: video.title } : null,
      citations: citations.map(c => ({ n: c.n, video_id: videoId, timestamp_ms: c.ms,
        start_seconds: c.t_start, end_seconds: c.t_end, frame_index: c.idx ?? null, transcript: c.transcript })),
      source_warnings: (Array.isArray(raw.source_warnings) ? raw.source_warnings : []).map((w: any) => ({ code: String(w.code), message: String(w.message) })),
      background_references: this.background(raw), context_resolution: String(raw.reason || 'UNKNOWN'),
      support_confirmed: false, experimental: true,
      note: 'Deneysel video açıklaması. Kaynak otomatik transkript olabilir; kaynak göstermek doğruluk kanıtı değildir.' };
    if (!first) return { ...common, status: 'NO_RELIABLE_EVIDENCE', answer: 'Bu soru için güvenilir bir video zaman aralığı bulamadım. Konuyu veya oynatma konumunu netleştir.', llm_used: false };
    if (!options.explain_now && learning.state !== 'WATCHED') {
      return { ...common, status: 'GUIDANCE', answer: GUIDANCE[learning.state], llm_used: false };
    }
    const explanation = await this.call('/api/local/video-explanation', { video_id: video.engineVideoId,
      selection_id: raw.selection_id, learning_state: learning.state }, 190000);
    const confirmed = this.citations(explanation, video.engineVideoId, raw.duration_ms);
    if (JSON.stringify(confirmed) !== JSON.stringify(citations)) throw new ApiError('INTERNAL_ERROR', 'Açıklama seçilen kaynaklarla eşleşmiyor.');
    return { ...common, status: 'EXPLANATION', answer: String(explanation.answer || ''), llm_used: Boolean(explanation.llm_used),
      generation_status: String(explanation.generation_status || 'UNVERIFIED') };
  }
}
