import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthUser } from "../common/request-context";
import { IdParam } from "../common/validation";
import { CoverageService } from "./coverage.service";

@Controller("courses")
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Get(":courseId/coverage")
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    return this.coverage.coverage(user, p.courseId);
  }
}
