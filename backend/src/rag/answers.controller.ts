import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser, RequestWithContext } from '../common/request-context';
import { IDENTIFIER, IdParam } from '../common/validation';
import { MAX_SCOPE_DOCUMENTS, RagService } from './rag.service';

export class AnswerDto {
  @IsString() @MinLength(1) @MaxLength(2000) question!: string;

  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SCOPE_DOCUMENTS) @Matches(IDENTIFIER, { each: true })
  document_ids?: string[];
}

@Controller('courses/:courseId/answers')
export class AnswersController {
  constructor(private readonly rag: RagService) {}

  @Post()
  @HttpCode(200)
  answer(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course, @Body() body: AnswerDto, @Req() req: RequestWithContext) {
    return this.rag.answer(user, p.courseId, body.question, body.document_ids, req.requestId);
  }
}
