import { Module } from '@nestjs/common';
import { UploadAccessGuard } from '../documents/upload-access.guard';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
@Module({ controllers: [VideosController], providers: [VideosService, UploadAccessGuard] })
export class VideosModule {}
