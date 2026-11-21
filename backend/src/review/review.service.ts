import { Injectable } from "@nestjs/common";
import { AccessService } from "../courses/access.service";
import type { AuthUser } from "../common/request-context";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { PrismaService } from "../prisma/prisma.service";
import { buildReview } from "./review-items";

/** Yanlış defteri: yalnızca okur. Yeni tablo yok; mevcut cevap denemelerinden türetilir. */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async review(user: AuthUser, courseId: string) {
    await this.access.requireMember(user, courseId); // başkasının dersi -> 404
    const [{ materials }, attempts] = await Promise.all([
      this.knowledge.list(user, courseId),
      this.prisma.learningQuizAttempt.findMany({
        // Kaynağı kaldırılan sorular (redacted) deftere girmez.
        where: { userId: user.id, quiz: { courseId, userId: user.id, redacted: false } },
        select: {
          quizId: true,
          response: true,
          outcome: true,
          createdAt: true,
          quiz: { select: { id: true, topic: true, kind: true, purpose: true, materialId: true, data: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const titles = new Map<string, string>(materials.map((m: any) => [m.id as string, String(m.title)]));
    return buildReview(attempts, titles);
  }
}
