import { Injectable } from "@nestjs/common";
import { AccessService } from "../courses/access.service";
import type { AuthUser } from "../common/request-context";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { PrismaService } from "../prisma/prisma.service";
import { buildCoverage, pageOf, type Events } from "./coverage";

const TTL_MS = 30_000;

@Injectable()
export class CoverageService {
  private cache = new Map<string, { at: number; value: any }>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async coverage(user: AuthUser, courseId: string) {
    await this.access.requireMember(user, courseId); // başkasının dersi -> 404
    const key = `${user.id}:${courseId}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    // Üç sorgu, ders başına: materyaller, sohbet yanıtları, alıştırma soruları (N+1 yok).
    const [{ materials }, messages, quizzes] = await Promise.all([
      this.knowledge.list(user, courseId),
      this.prisma.learningMessage.findMany({
        where: { role: "assistant", redacted: false, conversation: { userId: user.id, courseId } },
        select: { payload: true },
      }),
      this.prisma.learningQuiz.findMany({
        where: { userId: user.id, courseId, purpose: "PRACTICE", redacted: false },
        select: { materialId: true, data: true },
      }),
    ]);
    const kindOf = new Map(materials.map((m: any) => [m.id, m.kind as string]));
    const events: Events = { asked: [], practiced: [] };
    for (const msg of messages) {
      const evidence = (msg.payload as any)?.evidence;
      if (!Array.isArray(evidence)) continue;
      for (const e of evidence) {
        const kind = kindOf.get(e?.material_id);
        const page = kind ? pageOf(kind, e.location) : null;
        if (page) events.asked.push({ material_id: e.material_id, page });
      }
    }
    for (const q of quizzes) {
      const kind = kindOf.get(q.materialId);
      const page = kind ? pageOf(kind, (q.data as any)?.source?.location) : null;
      if (page) events.practiced.push({ material_id: q.materialId, page });
    }
    const value = buildCoverage(
      materials.map((m: any) => ({
        id: m.id, source_id: m.source_id, kind: m.kind, title: m.title, page_count: m.page_count,
      })),
      events,
    );
    this.cache.set(key, { at: Date.now(), value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
