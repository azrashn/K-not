import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AiServiceClient } from '../ai/ai-client';
import { CurrentUser } from '../auth/auth.decorators';
import { ApiError } from '../common/errors';
import { RateLimiter } from '../common/rate-limit';
import { AuthUser } from '../common/request-context';

class SpeechText {
  @IsString() @MinLength(1) @MaxLength(1200) @Matches(/\S/) text!: string;
}

/** Local neural voice (Piper, offline). Optional: without the voice file the browser reads with its own voices. */
@Controller('tts')
export class SpeechController {
  // One answer is read sentence by sentence, so the allowance is per user and generous.
  private readonly limiter = new RateLimiter(240);
  constructor(private readonly ai: AiServiceClient) {}

  @Get('status')
  async status() {
    const r = await this.ai.call('GET', '/api/v1/knowledge/tts/status', { timeoutMs: 4000 });
    if (r.kind === 'response' && r.status === 200 && r.body && typeof (r.body as any).available === 'boolean') {
      const b = r.body as { available: boolean; voice?: string | null };
      return { available: b.available, voice: b.voice ?? null };
    }
    return { available: false, voice: null };
  }

  @Post()
  @HttpCode(200)
  async speak(@CurrentUser() user: AuthUser, @Body() body: SpeechText) {
    if (!this.limiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Seslendirme istekleri çok sık. Biraz bekleyin.');
    const r = await this.ai.call('POST', '/api/v1/knowledge/tts', { body: { text: body.text }, timeoutMs: 60000 });
    if (r.kind === 'response' && r.status === 200 && r.body) return r.body;
    if (r.kind === 'response' && r.status === 422) throw new ApiError('VALIDATION_ERROR', 'Bu metin seslendirilemedi.');
    throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Yerel ses şu anda kullanılamıyor.');
  }
}
