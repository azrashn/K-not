import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthUser } from '../common/request-context';
import { IdParam } from '../common/validation';
import { UploadAccessGuard } from '../documents/upload-access.guard';
import { KnowledgeService } from './knowledge.service';

class Question {
  @IsString() @MinLength(1) @MaxLength(2000) @Matches(/\S/) question!: string;
  @IsOptional() @Matches(/^(pdf|video|file)_[A-Za-z0-9_-]{1,80}$/) active_material_id?: string;
  @IsOptional() @IsInt() @Min(0) @Max(604800000) current_time_ms?: number;
  @IsOptional() @IsUUID() conversation_id?: string;
  @IsOptional() @IsBoolean() explain_now?: boolean;
  @IsOptional() @IsIn(['single', 'unified', 'aligned']) strategy?: string;
}
class Practice { @IsUUID() conversation_id!: string }
class PracticeAnswer { @IsString() @MaxLength(300) answer!: string }
@Controller('courses/:courseId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}
  @Get('materials') list(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course) { return this.knowledge.list(u, p.courseId); }
  @Post('materials') @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 }, defParamCharset: 'utf8' }))
  upload(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @UploadedFile() f?: Express.Multer.File) { return this.knowledge.upload(u, p.courseId, f); }
  @Delete('materials/:materialId') remove(@CurrentUser() u: AuthUser, @Param('courseId') c: string, @Param('materialId') id: string) { return this.knowledge.remove(u, c, id); }
  @Get('materials/:materialId') preview(@CurrentUser() u: AuthUser, @Param('courseId') c: string, @Param('materialId') id: string) { return this.knowledge.preview(u, c, id); }
  @Get('materials/:materialId/file')
  async file(@CurrentUser() u: AuthUser, @Param('courseId') c: string, @Param('materialId') id: string, @Res() res: Response) {
    const f = await this.knowledge.file(u, c, id);
    res.setHeader('Content-Type', f.mime); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.on('close', () => f.stream.destroy()); f.stream.on('error', () => res.destroy()); f.stream.pipe(res);
  }
  @Get('materials/:materialId/sources/:segmentId')
  source(@CurrentUser() u: AuthUser, @Param('courseId') c: string, @Param('materialId') m: string, @Param('segmentId') s: string) { return this.knowledge.source(u, c, m, s); }
  @Post('answers') @HttpCode(200)
  ask(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @Body() body: Question) { return this.knowledge.ask(u, p.courseId, body); }
  @Post('search') @HttpCode(200)
  search(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @Body() body: Question) { return this.knowledge.ask(u, p.courseId, { ...body, retrieve_only: true }); }
  @Post('practice') @HttpCode(200)
  practice(@CurrentUser() u: AuthUser, @Param() p: IdParam.Course, @Body() b: Practice) { return this.knowledge.practice(u, p.courseId, b.conversation_id); }
  @Post('practice/:id/answers') @HttpCode(200)
  grade(@CurrentUser() u: AuthUser, @Param('courseId') c: string, @Param('id') id: string, @Body() b: PracticeAnswer) { return this.knowledge.gradePractice(u, c, id, b.answer); }
}
