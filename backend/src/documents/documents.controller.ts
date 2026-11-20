import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { notFound } from '../common/errors';
import { IDENTIFIER, IdParam } from '../common/validation';
import { DocumentsService, UploadFields } from './documents.service';
import type { StoredUpload } from './upload-storage';
import { UploadAccessGuard } from './upload-access.guard';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('courses/:courseId/documents')
  list(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    return this.documents.list(user, p.courseId);
  }

  @Post('courses/:courseId/documents')
  @UseGuards(UploadAccessGuard)
  @UseInterceptors(FileInterceptor('file')) // options (storage engine, limits): DocumentsModule
  upload(
    @CurrentUser() user: AuthUser,
    @Param() p: IdParam.Course,
    @UploadedFile() file: StoredUpload | undefined,
    @Body() fields: UploadFields,
  ) {
    return this.documents.upload(user, p.courseId, file, fields ?? {});
  }

  @Get('documents/:documentId')
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Document) {
    return this.documents.get(user, p.documentId);
  }

  @Post('documents/:documentId/retry')
  @HttpCode(202)
  retry(@CurrentUser() user: AuthUser, @Param() p: IdParam.Document) {
    return this.documents.retry(user, p.documentId);
  }

  @Delete('documents/:documentId')
  @HttpCode(202)
  remove(@CurrentUser() user: AuthUser, @Param() p: IdParam.Document) {
    return this.documents.remove(user, p.documentId);
  }

  @Get('documents/:documentId/pages/:page')
  page(
    @CurrentUser() user: AuthUser,
    @Param('documentId') documentId: string,
    @Param('page', new ParseIntPipe({ errorHttpStatusCode: 404 })) page: number,
    @Query('indexing_version') indexingVersion?: string,
  ) {
    if (!IDENTIFIER.test(documentId)) throw notFound('Document');
    return this.documents.page(user, documentId, page, indexingVersion);
  }

  @Get('documents/:documentId/file')
  async file(@CurrentUser() user: AuthUser, @Param() p: IdParam.Document, @Res() res: Response): Promise<void> {
    const f = await this.documents.file(user, p.documentId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    f.stream.pipe(res);
  }
}
