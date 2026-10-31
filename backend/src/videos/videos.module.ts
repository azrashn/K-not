import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadAccessGuard } from '../documents/upload-access.guard';
import { VideosController } from './videos.controller';
import { VIDEO_MAX_BYTES, VideosService } from './videos.service';
import { VideoProgressController } from './video-progress.controller';
import { VideoProgressService } from './video-progress.service';
import { VideoLearningService } from './video-learning.service';
@Module({
  imports: [MulterModule.registerAsync({ useFactory: () => ({
    limits: { fileSize: VIDEO_MAX_BYTES, files: 1, fields: 0 }, defParamCharset: 'utf8',
  }) })],
  controllers: [VideosController, VideoProgressController],
  providers: [VideosService, VideoProgressService, VideoLearningService, UploadAccessGuard],
})
export class VideosModule {}
