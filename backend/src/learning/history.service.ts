import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { notFound } from "../common/errors";

@Injectable()
export class LearningHistoryService {
  constructor(private readonly prisma: PrismaService) {}
  private safeVisual(m: any) {
    const p = m?.payload;
    if (
      p?.visual_analysis?.status === "IMAGE_PROVIDED" &&
      !p.visual_analysis.quality_gate
    ) {
      const answer =
        "Bu eski görsel test yanıtında bağlantılar ve sonuç sırası kalite kontrolünden geçmedi. Kesin sonuç yerine kaynağı açıp soruyu yeniden netleştirelim.";
      return {
        ...m,
        content: answer,
        payload: {
          ...p,
          answer,
          status: "CLARIFICATION",
          claims: [],
          visual_analysis: {
            ...p.visual_analysis,
            status: "LEGACY_VISUAL_NOT_VALIDATED",
          },
        },
      };
    }
    return m;
  }
  async thread(
    userId: string,
    courseId: string,
    id?: string,
    title = "Yeni konuşma",
  ) {
    if (id) {
      const row = await this.prisma.learningConversation.findFirst({
        where: { id, userId, courseId },
      });
      if (!row) throw notFound("Conversation");
      return row;
    }
    return this.prisma.learningConversation.create({
      data: { id: randomUUID(), userId, courseId, title: title.slice(0, 160) },
    });
  }
  async list(userId: string, courseId: string) {
    return this.prisma.learningConversation.findMany({
      where: { userId, courseId },
      select: { id: true, title: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
  }
  async read(
    userId: string,
    courseId: string,
    id: string,
    allowed?: { id: string; version: string; status: string }[],
  ) {
    await this.thread(userId, courseId, id);
    const messages = await this.prisma.learningMessage.findMany({
      where: { conversationId: id },
      include: { sources: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    if (allowed)
      for (const m of messages) {
        if (
          m.role === "assistant" &&
          !m.redacted &&
          m.sources.some(
            (s) =>
              !allowed.some(
                (a) =>
                  a.id === s.materialId &&
                  a.version === s.version &&
                  a.status === "READY",
              ),
          )
        ) {
          const data = {
            content:
              "Bu mesajın kaynağı kaldırılmış veya değişmiş. Güncel kaynaklarla yeniden sor.",
            payload: {
              status: "SOURCE_REMOVED",
              evidence: [],
              video_learning: [],
              associations: [],
              conflicts: [],
            },
            redacted: true,
          };
          await this.prisma.learningMessage.update({
            where: { id: m.id },
            data,
          });
          Object.assign(m, data);
        }
      }
    return { id, messages: messages.reverse().map((m) => this.safeVisual(m)) };
  }
  async last(userId: string, courseId: string, id: string) {
    await this.thread(userId, courseId, id);
    const row = await this.prisma.learningMessage.findFirst({
      where: { conversationId: id, role: "assistant", redacted: false },
      orderBy: { createdAt: "desc" },
    });
    return this.safeVisual(row);
  }
  async message(
    userId: string,
    courseId: string,
    threadId: string,
    id: string,
  ) {
    await this.thread(userId, courseId, threadId);
    const row = await this.prisma.learningMessage.findFirst({
      where: {
        id,
        conversationId: threadId,
        role: "assistant",
        redacted: false,
      },
    });
    if (!row) throw notFound("Message");
    return this.safeVisual(row);
  }
  async save(
    userId: string,
    courseId: string,
    id: string,
    question: string,
    answer: any,
  ) {
    await this.thread(userId, courseId, id);
    const payload = JSON.parse(JSON.stringify(answer));
    delete payload.conversation_id;
    const refs = [
      ...new Map(
        (answer.evidence || []).map((e: any) => [
          e.material_id,
          { materialId: e.material_id, version: e.version },
        ]),
      ).values(),
    ] as { materialId: string; version: string }[];
    return this.prisma.$transaction(async (tx) => {
      await tx.learningMessage.create({
        data: { conversationId: id, role: "user", content: question },
      });
      const assistant = await tx.learningMessage.create({
        data: {
          conversationId: id,
          role: "assistant",
          content: String(answer.answer || ""),
          payload,
          sources: { create: refs },
        },
      });
      await tx.learningConversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      });
      await tx.learningActivity.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, topic: question.slice(0, 160), events: 1 },
        update: { topic: question.slice(0, 160), events: { increment: 1 } },
      });
      return assistant.id;
    });
  }
  async redact(materialId: string) {
    await this.prisma.learningMessage.updateMany({
      where: { sources: { some: { materialId } } },
      data: {
        content:
          "Bu mesajın kaynağı kaldırıldı. Güncel materyallerle yeniden sor.",
        payload: {
          status: "SOURCE_REMOVED",
          evidence: [],
          video_learning: [],
          associations: [],
          conflicts: [],
          answer: "Kaynak kaldırıldı.",
        },
        redacted: true,
      },
    });
    await this.prisma.learningQuizAttempt.updateMany({
      where: { quiz: { materialId } },
      data: { feedback: { source_removed: true } },
    });
    await this.prisma.learningQuiz.updateMany({
      where: { materialId },
      data: { data: { source_removed: true }, redacted: true },
    });
  }
}
