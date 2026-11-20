import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { CurrentUser, Public } from '../auth/auth.decorators';
import { notFound } from '../common/errors';
import type { AuthUser } from '../common/request-context';
import { TtsService } from './tts.service';

class Speak {
  @IsString() @MinLength(1) @MaxLength(4000) @Matches(/\S/) text!: string;
  @IsIn(['tr', 'en']) lang!: 'tr' | 'en';
}

@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get('status')
  status() {
    return this.tts.status();
  }

  @Post() @HttpCode(200)
  speak(@CurrentUser() u: AuthUser, @Body() b: Speak) {
    return this.tts.speak(u, b.text.trim(), b.lang);
  }

  /** Public on purpose: `<audio>` sends no Authorization header; the signed URL is the permission. */
  @Public()
  @Get('audio/:file')
  async audio(@Param('file') file: string, @Query('exp') exp: unknown, @Query('sig') sig: unknown,
    @Req() req: Request, @Res() res: Response) {
    const key = /^([0-9a-f]{64})\.wav$/.exec(file)?.[1] ?? '';
    const upstream = await this.tts.audio(key, exp, sig, req.ip || 'unknown');
    if (!upstream) throw notFound('Ses');
    const remaining = Math.max(0, Number(exp) - Math.floor(Date.now() / 1000));
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', `private, max-age=${remaining}`);
    res.setHeader('Referrer-Policy', 'no-referrer');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    const stream = Readable.fromWeb(upstream.body as any);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
