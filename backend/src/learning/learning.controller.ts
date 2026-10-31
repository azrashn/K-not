import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthUser } from '../common/request-context';
import { LearningService } from './learning.service';
class Start {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) topic!: string;
  @IsIn(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'CLOZE', 'SHORT_ANSWER', 'OPEN'])
  kind!: string;
  @IsOptional()
  @Matches(/^(pdf|file|video)_[A-Za-z0-9_-]{1,80}$/)
  material_id?: string;
}
class Answer {
  @IsString() @MaxLength(2000) @Matches(/\S/) response!: string;
}
class Activity {
  @IsOptional()
  @Matches(/^(pdf|file|video)_[A-Za-z0-9_-]{1,80}$/)
  material_id?: string;
  @IsOptional() @Matches(/^[a-f0-9]{64}$/) segment_id?: string;
}
@Controller()
export class LearningController {
  constructor(private readonly learning: LearningService) {}
  @Get('learning/overview') overview(@CurrentUser() u: AuthUser) {
    return this.learning.overview(u);
  }
  @Post('courses/:courseId/activity') @HttpCode(200) activity(
    @CurrentUser() u: AuthUser,
    @Param('courseId') c: string,
    @Body() b: Activity,
  ) {
    return this.learning.activity(u, c, b);
  }
  @Get('courses/:courseId/quizzes') quizzes(
    @CurrentUser() u: AuthUser,
    @Param('courseId') c: string,
  ) {
    return this.learning.quizzes(u, c);
  }
  @Post('courses/:courseId/quizzes') start(
    @CurrentUser() u: AuthUser,
    @Param('courseId') c: string,
    @Body() b: Start,
  ) {
    return this.learning.start(u, c, b);
  }
  @Get('courses/:courseId/quizzes/:id') quiz(
    @CurrentUser() u: AuthUser,
    @Param('courseId') c: string,
    @Param('id') id: string,
  ) {
    return this.learning.quiz(u, c, id);
  }
  @Post('courses/:courseId/quizzes/:id/answers') @HttpCode(200) answer(
    @CurrentUser() u: AuthUser,
    @Param('courseId') c: string,
    @Param('id') id: string,
    @Body() b: Answer,
  ) {
    return this.learning.answer(u, c, id, b.response);
  }
}
