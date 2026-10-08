import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

import { APP_CONFIG, AppConfig } from '../config/config';
import { Storage } from '../storage/storage';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { HashingTempStorage } from './upload-storage';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [Storage, APP_CONFIG],
      useFactory: (storage: Storage, config: AppConfig) => ({
        storage: new HashingTempStorage(storage),
        limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 10, fieldSize: 4096, parts: 20 },
        defParamCharset: 'utf8', // Turkish file names arrive intact
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
