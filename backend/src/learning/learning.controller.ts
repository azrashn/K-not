import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  IsIn,
  IsInt,
  Max,
  Min,
  IsUUID,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsBoolean,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { KnowledgeScope } from "../knowledge/knowledge.controller";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../common/request-context";
import { LearningService } from "./learning.service";
class Start {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) topic!: string;
  /** MIXED ("Karışık"): the kinds in turn (v2 only). */
  @IsIn(["MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE", "SHORT_ANSWER", "OPEN", "MIXED"])
  kind!: string;
  /** 1 (default): the question is returned at once. 2-10: a quiz set, answered 202 (v2 only). */
  @IsOptional() @IsInt() @Min(1) @Max(10) count?: number;
  @IsOptional()
  @Matches(/^(pdf|file|video)_[A-Za-z0-9_-]{1,80}$/)
  material_id?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => KnowledgeScope)
  scope?: KnowledgeScope;
  @IsOptional() @IsBoolean() watched_only?: boolean;
  @IsOptional() @IsUUID() exam_style_id?: string;
}
class ExamStyleBody {
  @IsString() @MinLength(1) @MaxLength(120) @Matches(/\S/) name!: string;
  @IsString() @MinLength(20) @MaxLength(20000) @Matches(/\S/) text!: string;
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
  @Get("learning/overview") overview(@CurrentUser() u: AuthUser) {
    return this.learning.overview(u);
  }
  @Post("courses/:courseId/activity") @HttpCode(200) activity(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Body() b: Activity,
  ) {
    return this.learning.activity(u, c, b);
  }
  @Get("courses/:courseId/quizzes") quizzes(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
  ) {
    return this.learning.quizzes(u, c);
  }
  @Post("courses/:courseId/quizzes") async start(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Body() b: Start,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.learning.start(u, c, b);
    if (r?.set) {
      // A quiz set is written in the background: follow it with GET /quiz-sets/:id.
      res.status(202);
      return r.set;
    }
    return r;
  }
  @Get("courses/:courseId/quiz-sets/:id") quizSet(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.learning.quizSet(u, c, id);
  }
  @Get("courses/:courseId/exam-styles") examStyles(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
  ) {
    return this.learning.examStyles(u, c);
  }
  @Post("courses/:courseId/exam-styles") createExamStyle(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Body() b: ExamStyleBody,
  ) {
    return this.learning.createExamStyle(u, c, b);
  }
  @Delete("courses/:courseId/exam-styles/:id") deleteExamStyle(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.learning.deleteExamStyle(u, c, id);
  }
  @Get("courses/:courseId/quizzes/:id") quiz(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.learning.quiz(u, c, id);
  }
  @Post("courses/:courseId/quizzes/:id/answers") @HttpCode(200) answer(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
    @Body() b: Answer,
  ) {
    return this.learning.answer(u, c, id, b.response);
  }
}
