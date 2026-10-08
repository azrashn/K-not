import { DynamicModule, Global, MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { AiServiceClient } from './ai/ai-client';
import { IndexVersionService } from './ai/index-versions';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ApiExceptionFilter } from './common/errors';
import { RequestContextMiddleware } from './common/request-context';
import { APP_CONFIG, AppConfig } from './config/config';
import { AccessService } from './courses/access.service';
import { CoursesController } from './courses/courses.controller';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health/health.controller';
import { InternalCallbacksController } from './jobs/internal-callbacks.controller';
import { JobsService } from './jobs/jobs.service';
import { SchedulerService } from './jobs/scheduler.service';
import { PrismaService } from './prisma/prisma.service';
import { AnswersController } from './rag/answers.controller';
import { RagService } from './rag/rag.service';
import { LocalStorage, Storage } from './storage/storage';

@Global()
@Module({})
class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    const providers = [
      { provide: APP_CONFIG, useValue: config },
      PrismaService,
      { provide: Storage, useClass: LocalStorage },
      AiServiceClient,
      IndexVersionService,
      AccessService,
      JobsService,
      AuthService,
    ];
    return {
      module: CoreModule,
      imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { algorithm: 'HS256', expiresIn: config.jwtTtlSeconds } })],
      providers,
      exports: [...providers.map((p) => ('provide' in p ? p.provide : p)), JwtModule],
    };
  }
}

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(config), DocumentsModule],
      controllers: [HealthController, AuthController, CoursesController, AnswersController, InternalCallbacksController],
      providers: [
        RagService,
        SchedulerService,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: false }) },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
