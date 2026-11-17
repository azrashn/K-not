import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../common/request-context";
import { KnowledgeScope } from "../knowledge/knowledge.controller";
import { PracticeService } from "./practice.service";
import { PRACTICE_MAX, PRACTICE_MIN } from "./practice-plan";

class CreateSet {
  @IsInt() @Min(PRACTICE_MIN) @Max(PRACTICE_MAX) count!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(200, { each: true }) topics?: string[];
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @ValidateNested() @Type(() => KnowledgeScope) scope?: KnowledgeScope;
  @IsOptional() @IsBoolean() watched_only?: boolean;
  @IsOptional() @IsUUID() exam_style_id?: string;
}
class SetAnswer {
  @IsUUID() quiz_id!: string;
  @IsString() @MaxLength(2000) response!: string;
}
class SubmitSet {
  @IsArray() @ArrayMaxSize(PRACTICE_MAX) @ValidateNested({ each: true }) @Type(() => SetAnswer) answers!: SetAnswer[];
}

@Controller()
export class PracticeController {
  constructor(private readonly sets: PracticeService) {}

  @Post("courses/:courseId/quiz-sets") @HttpCode(202) create(
    @CurrentUser() u: AuthUser, @Param("courseId") c: string, @Body() b: CreateSet,
  ) {
    return this.sets.create(u, c, b);
  }
  @Get("courses/:courseId/quiz-sets") list(@CurrentUser() u: AuthUser, @Param("courseId") c: string) {
    return this.sets.list(u, c);
  }
  @Get("courses/:courseId/quiz-sets/:id") get(
    @CurrentUser() u: AuthUser, @Param("courseId") c: string, @Param("id") id: string,
  ) {
    return this.sets.get(u, c, id);
  }
  @Post("courses/:courseId/quiz-sets/:id/submit") @HttpCode(200) submit(
    @CurrentUser() u: AuthUser, @Param("courseId") c: string, @Param("id") id: string, @Body() b: SubmitSet,
  ) {
    return this.sets.submit(u, c, id, b.answers);
  }
  @Delete("courses/:courseId/quiz-sets/:id") remove(
    @CurrentUser() u: AuthUser, @Param("courseId") c: string, @Param("id") id: string,
  ) {
    return this.sets.remove(u, c, id);
  }
}
