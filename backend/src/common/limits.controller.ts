import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { STUDY_FILE_MAX_BYTES, VIDEO_MAX_BYTES } from './limits';

/** What the upload screens may promise: the limits this server actually enforces. */
@Controller()
export class LimitsController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  @Get('limits')
  limits() {
    return {
      document_bytes: this.config.uploadMaxBytes,
      study_file_bytes: STUDY_FILE_MAX_BYTES,
      video_bytes: VIDEO_MAX_BYTES,
    };
  }
}
