import { Inject, Injectable } from '@nestjs/common';
import { AiServiceClient } from '../ai/ai-client';
import { ApiError } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { RateLimiter } from '../common/rate-limit';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AUDIO_KEY, audioPath, verifyAudio } from './signed-url';

const SYNTH_TIMEOUT_MS = 60_000;
const AUDIO_TIMEOUT_MS = 15_000;

/** Board teacher voice: the browser talks to /api only; synthesis and the cache live in the ai-service. */
@Injectable()
export class TtsService {
  private readonly speakLimiter = new RateLimiter(60);
  private readonly audioLimiter = new RateLimiter(600);

  constructor(private readonly ai: AiServiceClient, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.ttsUrlSecret);
  }

  /**
   * GET /api/tts/status → may the browser use the local voice, and in which languages? Everything that
   * would make POST /api/tts fail (no URL secret, no cache secret, Piper missing, voice file missing)
   * reads as "not available"; the browser then falls back to its own voices.
   */
  async status(): Promise<{ available: boolean; languages: { tr: boolean; en: boolean } }> {
    const none = { available: false, languages: { tr: false, en: false } };
    if (!this.enabled) return none;
    const r = await this.ai.call('GET', '/api/v1/tts/health', { timeoutMs: 4000 });
    const b: any = r.kind === 'response' && r.status === 200 ? r.body : null;
    if (!b || b.configured !== true || b.piper_installed !== true) return none;
    const languages = { tr: b.voice_files_present?.tr === true || b.auto_download === true, en: b.voice_files_present?.en === true || b.auto_download === true };
    return { available: languages.tr || languages.en, languages };
  }

  /** POST /api/tts → { url }: the same text gives the same key (cache), signed for 24 h. */
  async speak(user: AuthUser, text: string, lang: 'tr' | 'en'): Promise<{ url: string }> {
    if (!this.enabled) throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Ses servisi yapılandırılmamış.');
    if (!this.speakLimiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Biraz bekleyip tekrar deneyin.');
    const r = await this.ai.call('POST', '/api/v1/tts', { body: { text, lang }, timeoutMs: SYNTH_TIMEOUT_MS });
    if (r.kind === 'timeout') throw new ApiError('PROVIDER_TIMEOUT', 'Ses zamanında hazırlanamadı.');
    if (r.kind === 'unreachable') throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Ses servisine ulaşılamadı.');
    if (r.status === 413) throw new ApiError('PAYLOAD_TOO_LARGE', 'Okunacak metin çok uzun.');
    if (r.status === 422) throw new ApiError('VALIDATION_ERROR', 'Okunacak metin geçersiz.');
    if (r.status !== 200 || !AUDIO_KEY.test(String(r.body?.key))) {
      throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Ses şu anda hazırlanamıyor.');
    }
    return { url: audioPath(this.config.ttsPublicPrefix, this.config.ttsUrlSecret!, r.body.key, Math.floor(Date.now() / 1000)) };
  }

  /**
   * The audio behind a signed URL, or null (bad, expired or foreign signature, unknown key):
   * every refusal looks the same to the caller.
   */
  async audio(key: string, exp: unknown, sig: unknown, client: string): Promise<globalThis.Response | null> {
    if (!this.enabled || !this.audioLimiter.take(client)) return null;
    if (!verifyAudio(this.config.ttsUrlSecret!, key, exp, sig, Math.floor(Date.now() / 1000))) return null;
    try {
      const upstream = await fetch(`${this.config.aiServiceUrl}/api/v1/tts/audio/${key}.wav`, {
        headers: { Authorization: `Bearer ${this.config.ragInternalApiToken}` },
        redirect: 'error',
        signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS),
      });
      if (!upstream.ok || !upstream.body) return null;
      return upstream;
    } catch {
      return null;
    }
  }
}
