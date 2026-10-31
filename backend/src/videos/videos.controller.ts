import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { IDENTIFIER, IdParam } from '../common/validation';
import { UploadAccessGuard } from '../documents/upload-access.guard';
import { VIDEO_MAX_BYTES, VideosService } from './videos.service';
import { VideoLearningService } from './video-learning.service';

class VideoParam extends IdParam.Course { @Matches(IDENTIFIER) videoId!: string }
class FrameParam extends VideoParam { @Matches(/^\d{1,5}$/) index!: string }
class Question {
  @IsString() @MinLength(1) @MaxLength(2000) @Matches(/\S/) question!: string;
  @IsOptional() @IsInt() @Min(0) @Max(604800000) current_time_ms?: number;
  @IsOptional() @IsBoolean() explain_now?: boolean;
  @IsOptional() @IsUUID() evidence_id?: string;
}
class VideoLink { @IsString() @MinLength(1) @MaxLength(2048) url!: string }

@Controller('courses/:courseId/videos')
export class VideosController {
  constructor(private readonly videos: VideosService, private readonly learning: VideoLearningService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course) { return this.videos.list(u, p.courseId); }
  @Delete(':videoId')
  remove(@CurrentUser() u: AuthUser, @Param() p: VideoParam) { return this.videos.remove(u, p.courseId, p.videoId); }
  @Post('import-link') @UseGuards(UploadAccessGuard)
  importLink(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @Body() b: VideoLink) {
    return this.videos.importLink(u, p.courseId, b.url);
  }
  @Post() @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VIDEO_MAX_BYTES, files: 1, fields: 0 } }))
  upload(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @UploadedFile() f?: Express.Multer.File) { return this.videos.upload(u, p.courseId, f); }
  @Post(':videoId/retry') @HttpCode(202)
  retry(@CurrentUser() u: AuthUser, @Param() p: VideoParam) { return this.videos.retry(u, p.courseId, p.videoId); }
  @Get(':videoId/transcript') transcript(@CurrentUser() u: AuthUser, @Param() p: VideoParam) { return this.videos.transcript(u, p.courseId, p.videoId); }
  @Get(':videoId/frames') frames(@CurrentUser() u: AuthUser, @Param() p: VideoParam) { return this.videos.frames(u, p.courseId, p.videoId); }
  @Post(':videoId/answers') @HttpCode(200)
  ask(@CurrentUser() u: AuthUser, @Param() p: VideoParam, @Body() b: Question) { return this.learning.ask(u, p.courseId, p.videoId, b.question.trim(), b); }
  @Get(':videoId/file')
  async file(@CurrentUser() u: AuthUser, @Param() p: VideoParam, @Res() res: Response) {
    return this.stream(await this.videos.media(u, p.courseId, p.videoId), res);
  }
  @Get(':videoId/frames/:index')
  async frame(@CurrentUser() u: AuthUser, @Param() p: FrameParam,
    @Param('index', new ParseIntPipe()) i: number, @Res() res: Response) {
    return this.stream(await this.videos.media(u, p.courseId, p.videoId, i), res);
  }
  private stream(upstream: globalThis.Response, res: Response) {
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    if (!upstream.body) { res.end(); return; }
    const stream = Readable.fromWeb(upstream.body as any);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }
}
