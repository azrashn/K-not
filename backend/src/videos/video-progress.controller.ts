import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, Matches, Max, Min, ValidateNested } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import type { AuthUser } from '../common/request-context';
import { IDENTIFIER, IdParam } from '../common/validation';
import { VideoProgressService } from './video-progress.service';

class VideoParam extends IdParam.Course { @Matches(IDENTIFIER) videoId!: string }
class IntervalDto {
  @IsInt() @Min(0) @Max(604800000) start_ms!: number;
  @IsInt() @Min(1) @Max(604800000) end_ms!: number;
}
class ProgressDto {
  @IsInt() @Min(0) @Max(604800000) position_ms!: number;
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => IntervalDto) intervals!: IntervalDto[];
}

@Controller('courses/:courseId/videos/:videoId/progress')
export class VideoProgressController {
  constructor(private readonly progress: VideoProgressService) {}
  @Get() get(@CurrentUser() u: AuthUser, @Param() p: VideoParam) { return this.progress.get(u, p.courseId, p.videoId); }
  @Put() save(@CurrentUser() u: AuthUser, @Param() p: VideoParam, @Body() b: ProgressDto) {
    return this.progress.save(u, p.courseId, p.videoId, b.position_ms, b.intervals);
  }
}
