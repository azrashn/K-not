import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, UploadedFile, UseGuards, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Type } from "class-transformer";
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from "class-validator";
import { CurrentUser } from "../auth/auth.decorators";
import { AuthUser } from "../common/request-context";
import { UploadAccessGuard } from "../documents/upload-access.guard";
import { KnowledgeScope } from "../knowledge/knowledge.controller";
import { ExamsService } from "./exams.service";

class ExamFileBody {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}
class CreateExam {
  @IsUUID() exam_style_id!: string;
  @IsInt() @Min(1) @Max(20) count!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(200, { each: true }) topics?: string[];
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @ValidateNested() @Type(() => KnowledgeScope) scope?: KnowledgeScope;
}

@Controller()
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Post("courses/:courseId/exam-styles/file")
  @UseGuards(UploadAccessGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 },
      defParamCharset: "utf8",
    }),
  )
  uploadStyle(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Body() b: ExamFileBody,
    @UploadedFile() f?: Express.Multer.File,
  ) {
    return this.exams.uploadStyleFile(u, c, f, b?.name);
  }

  @Post("courses/:courseId/exams") @HttpCode(202) create(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Body() b: CreateExam,
  ) {
    return this.exams.create(u, c, b);
  }
  @Get("courses/:courseId/exams") list(@CurrentUser() u: AuthUser, @Param("courseId") c: string) {
    return this.exams.list(u, c);
  }
  @Get("courses/:courseId/exams/:id") get(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.exams.get(u, c, id);
  }
  @Get("courses/:courseId/exams/:id/key") key(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.exams.key(u, c, id);
  }
  @Delete("courses/:courseId/exams/:id") remove(
    @CurrentUser() u: AuthUser,
    @Param("courseId") c: string,
    @Param("id") id: string,
  ) {
    return this.exams.remove(u, c, id);
  }
}
