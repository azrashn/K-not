import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/request-context';
import { ApiError, notFound } from '../common/errors';
import { JobsService } from '../jobs/jobs.service';
import { VideosService } from '../videos/videos.service';
import { AiServiceClient } from '../ai/ai-client';
import { Storage } from '../storage/storage';
import { LearningHistoryService } from '../learning/history.service';

@Injectable()
export class CourseLifecycleService {
  private active = new Set<string>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly videos: VideosService,
    private readonly ai: AiServiceClient,
    private readonly storage: Storage,
    private readonly history: LearningHistoryService,
  ) {}
  async remove(user: AuthUser, id: string, confirmName: string) {
    const c = await this.prisma.course.findFirst({
      where: { id, ownerId: user.id, lifecycle: { not: 'DELETED' } },
    });
    if (!c) throw notFound('Course');
    if (c.name !== confirmName)
      throw new ApiError(
        'VALIDATION_ERROR',
        'Onay için dersin adını aynı şekilde yazın.',
      );
    const others = await this.prisma.courseMembership.count({
      where: { courseId: id, userId: { not: user.id } },
    });
    const foreign =
      (await this.prisma.document.count({
        where: { courseId: id, ownerId: { not: user.id }, deletedAt: null },
      })) +
      (await this.prisma.video.count({
        where: { courseId: id, ownerId: { not: user.id } },
      })) +
      (await this.prisma.studyMaterial.count({
        where: { courseId: id, ownerId: { not: user.id } },
      }));
    if (others || foreign)
      throw new ApiError(
        'FORBIDDEN',
        'Paylaşılan dersin diğer kullanıcı verileri silinemez. Dersi yalnız kendi listenizden arşivleyebilirsiniz.',
      );
    if (this.active.has(id))
      throw new ApiError('JOB_ALREADY_RUNNING', 'Ders silme işlemi sürüyor.');
    this.active.add(id);
    try {
      await this.prisma.course.update({
        where: { id },
        data: { lifecycle: 'DELETING', deletionError: null },
      });
      for (const v of await this.prisma.video.findMany({
        where: { courseId: id, ownerId: user.id },
      }))
        await this.videos.remove(user, id, v.id, true);
      for (const f of await this.prisma.studyMaterial.findMany({
        where: { courseId: id, ownerId: user.id },
      })) {
        const r = await this.ai.call(
          'DELETE',
          `/api/v1/knowledge/${id}/file_${f.id}`,
          { timeoutMs: 120000 },
        );
        if (r.kind !== 'response' || r.status !== 200)
          throw new Error('index cleanup');
        if (f.storageKey) await this.storage.delete(f.storageKey);
        await this.history.redact('file_' + f.id);
        await this.prisma.studyMaterial.delete({ where: { id: f.id } });
      }
      for (const d of await this.prisma.document.findMany({
        where: { courseId: id, ownerId: user.id, purgedAt: null },
      })) {
        await this.jobs.softDelete(d.id);
        if (!(await this.jobs.purge(d.id))) throw new Error('document cleanup');
      }
      await this.prisma.$transaction([
        this.prisma.document.updateMany({
          where: { courseId: id, ownerId: user.id, purgedAt: { not: null } },
          data: {
            title: 'Kaldırılan materyal',
            originalFilename: 'removed.pdf',
            errorMessage: null,
          },
        }),
        this.prisma.learningConversation.deleteMany({
          where: { courseId: id, userId: user.id },
        }),
        this.prisma.learningQuiz.deleteMany({
          where: { courseId: id, userId: user.id },
        }),
        this.prisma.learningActivity.deleteMany({
          where: { courseId: id, userId: user.id },
        }),
        this.prisma.course.update({
          where: { id },
          data: {
            lifecycle: 'DELETED',
            deletionError: null,
            name: 'Kaldırılan ders',
            description: null,
            category: null,
            instructorName: null,
          },
        }),
      ]);
      return { deleted: true };
    } catch {
      await this.prisma.course.update({
        where: { id },
        data: {
          deletionError:
            'Temizleme tamamlanamadı. Silme işlemini yeniden başlatabilirsiniz.',
        },
      });
      throw new ApiError(
        'AI_SERVICE_UNAVAILABLE',
        'Ders temizliği tamamlanamadı. Kayıt korundu; silmeyi yeniden deneyin.',
      );
    } finally {
      this.active.delete(id);
    }
  }
}
