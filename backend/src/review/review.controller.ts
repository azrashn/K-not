import { Controller, Get, Param } from "@nestjs/common";
import { CurrentUser } from "../auth/auth.decorators";
import type { AuthUser } from "../common/request-context";
import { IdParam } from "../common/validation";
import { ReviewService } from "./review.service";

@Controller("courses")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get(":courseId/review")
  get(@CurrentUser() user: AuthUser, @Param() p: IdParam.Course) {
    return this.review.review(user, p.courseId);
  }
}
