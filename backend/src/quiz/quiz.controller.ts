import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsInt, IsOptional, Matches, Min, ValidateNested } from 'class-validator';

import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser, RequestWithContext } from '../common/request-context';
import { IDENTIFIER, IdParam } from '../common/validation';
import { DIFFICULTIES, QUESTION_COUNTS, QUESTION_TYPES, QuizService } from './quiz.service';

export class CreateQuizDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @Matches(IDENTIFIER, { each: true }) document_ids!: string[];
  @IsInt() @IsIn(QUESTION_COUNTS as unknown as number[]) question_count!: number;
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsIn(QUESTION_TYPES as unknown as string[], { each: true }) question_types!: string[];
  @IsIn(DIFFICULTIES as unknown as string[]) difficulty!: string;
}

export class AnswerItemDto {
  @Matches(IDENTIFIER) question_id!: string;
  @IsOptional() @IsInt() @Min(0) selected_index!: number | null;
}

export class AnswersDto {
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => AnswerItemDto) answers?: AnswerItemDto[];
}

export class QuizIdParam { @Matches(IDENTIFIER) quizId!: string }
export class AttemptIdParam { @Matches(IDENTIFIER) attemptId!: string }
export class CourseFilter { @IsOptional() @Matches(IDENTIFIER) course_id?: string }

const norm = (a?: AnswerItemDto[]) => a?.map((x) => ({ question_id: x.question_id, selected_index: x.selected_index ?? null }));

@Controller()
export class QuizController {
  constructor(private readonly quizzes: QuizService) {}

  @Post('courses/:courseId/quizzes')
  @HttpCode(201)
  create(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course, @Body() body: CreateQuizDto, @Req() req: RequestWithContext) {
    return this.quizzes.create(user, p.courseId, body, req.requestId);
  }

  @Get('quizzes')
  list(@CurrentUser() user: AuthUser, @Query() q: CourseFilter) {
    return this.quizzes.list(user, q.course_id);
  }

  @Get('quizzes/:quizId')
  get(@CurrentUser() user: AuthUser, @Param() p: QuizIdParam) {
    return this.quizzes.get(user, p.quizId);
  }

  @Post('quizzes/:quizId/attempts')
  @HttpCode(201)
  start(@CurrentUser() user: AuthUser, @Param() p: QuizIdParam) {
    return this.quizzes.startAttempt(user, p.quizId);
  }

  @Get('quiz-attempts')
  attempts(@CurrentUser() user: AuthUser, @Query() q: CourseFilter) {
    return this.quizzes.listAttempts(user, q.course_id);
  }

  @Get('quiz-attempts/:attemptId')
  attempt(@CurrentUser() user: AuthUser, @Param() p: AttemptIdParam) {
    return this.quizzes.getAttempt(user, p.attemptId);
  }

  @Put('quiz-attempts/:attemptId/answers')
  save(@CurrentUser() user: AuthUser, @Param() p: AttemptIdParam, @Body() body: AnswersDto) {
    return this.quizzes.saveAnswers(user, p.attemptId, norm(body.answers) ?? []);
  }

  @Post('quiz-attempts/:attemptId/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param() p: AttemptIdParam, @Body() body: AnswersDto) {
    return this.quizzes.submit(user, p.attemptId, norm(body.answers));
  }

  @Get('analytics/quiz-summary')
  summary(@CurrentUser() user: AuthUser, @Query() q: CourseFilter) {
    return this.quizzes.summary(user, q.course_id);
  }
}
