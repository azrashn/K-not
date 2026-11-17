import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { ApiError, notFound } from "../common/errors";
import { AccessService } from "../courses/access.service";
import { AiServiceClient } from "../ai/ai-client";
import { LearningService } from "./learning.service";
import { commonReason, examTopics, groundTopics, planExamKinds } from "./exam-plan";
import { KnowledgeService } from "../knowledge/knowledge.service";
import type { ExamProfile } from "./exam-style";

type Item = { quiz_id: string; kind: string; topic: string };
type Failure = { topic: string; kind: string; reason: string };

const FILE_KINDS: Record<string, "PDF" | "DOCX" | "TXT"> = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
  ".md": "TXT",
};
// Model or service trouble stops the whole run; a missing source only skips that topic.
const INFRASTRUCTURE = new Set(["AI_SERVICE_UNAVAILABLE", "PROVIDER_TIMEOUT"]);

/** Past exam files, and new exams written from a saved exam style. Every question is an ordinary
 *  source-bound quiz question: when no source supports a topic the exam says so instead of inventing one. */
@Injectable()
export class ExamsService implements OnModuleInit {
  private readonly log = new Logger(ExamsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly ai: AiServiceClient,
    private readonly learning: LearningService,
    private readonly knowledge: KnowledgeService,
  ) {}

  /** A run lives in this process only; after a restart nothing is still generating. */
  async onModuleInit() {
    await this.prisma.generatedExam.updateMany({
      where: { status: "GENERATING" },
      data: {
        status: "FAILED",
        note: "Sunucu yeniden başladığı için üretim yarıda kaldı.",
        finishedAt: new Date(),
      },
    });
  }

  // ── past exam file → saved style ─────────────────────────────────────────────
  async uploadStyleFile(
    u: AuthUser,
    c: string,
    file: { originalname: string; buffer: Buffer } | undefined,
    name?: string,
  ) {
    await this.access.requireMember(u, c);
    if (!file?.buffer?.length)
      throw new ApiError("VALIDATION_ERROR", "Bir sınav dosyası seçin (PDF, DOCX veya TXT).");
    const ext = /\.[A-Za-z0-9]+$/.exec(file.originalname || "")?.[0]?.toLowerCase() ?? "";
    const kind = FILE_KINDS[ext];
    if (!kind)
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Yalnızca PDF, DOCX veya TXT dosyası yüklenebilir.");
    const head = file.buffer.subarray(0, 5).toString("latin1");
    if ((kind === "PDF" && head !== "%PDF-") || (kind === "DOCX" && !head.startsWith("PK")))
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "Dosya içeriği uzantısıyla uyuşmuyor.");
    const r = await this.ai.call("POST", "/api/v1/knowledge/exam-text", {
      body: { kind, content: file.buffer.toString("base64") },
      timeoutMs: 60000,
    });
    if (r.kind === "timeout")
      throw new ApiError("PROVIDER_TIMEOUT", "Dosya okuma beklenenden uzun sürdü. Yeniden deneyin.");
    if (r.kind === "unreachable" || (r.kind === "response" && r.status >= 500))
      throw new ApiError("AI_SERVICE_UNAVAILABLE", "Sınav dosyası şu anda okunamadı. Biraz sonra yeniden deneyin.");
    if (r.kind !== "response" || r.status !== 200 || typeof r.body?.text !== "string")
      throw new ApiError(
        "VALIDATION_ERROR",
        "Dosyadan metin okunamadı (taranmış ya da şifreli PDF olabilir). Metni yapıştırarak ekleyin.",
      );
    const base = (name || file.originalname || "Sınav").replace(/\.[A-Za-z0-9]+$/, "").trim();
    return this.learning.createExamStyle(u, c, { name: base.slice(0, 120) || "Sınav", text: r.body.text });
  }

  // ── generate ─────────────────────────────────────────────────────────────────
  async create(
    u: AuthUser,
    c: string,
    b: { exam_style_id: string; count: number; topics?: string[]; title?: string; scope?: any },
  ) {
    await this.access.requireMember(u, c);
    const style = await this.prisma.examStyle.findFirst({
      where: { id: b.exam_style_id, courseId: c, ownerId: u.id },
    });
    if (!style) throw notFound("Exam style");
    const profile = style.profile as unknown as ExamProfile;
    const userTopics = Boolean(b.topics?.some((t) => String(t).trim()));
    let topics = examTopics(b.topics, profile);
    // Terms from the past exam are only useful when the course sources talk about them.
    if (!userTopics) topics = groundTopics(topics, await this.sourceTexts(u, c, b.scope), b.count).topics;
    if (!topics.length)
      throw new ApiError(
        "VALIDATION_ERROR",
        "Sınav için en az bir konu gerekli. Konuları yazın; sınav stilinde yeterli terim bulunamadı.",
      );
    const running = await this.prisma.generatedExam.count({
      where: { courseId: c, userId: u.id, status: "GENERATING" },
    });
    if (running)
      throw new ApiError("JOB_ALREADY_RUNNING", "Bu ders için bir sınav zaten hazırlanıyor. Bitmesini bekleyin.");
    const kinds = planExamKinds(profile, b.count);
    const row = await this.prisma.generatedExam.create({
      data: {
        id: randomUUID(),
        courseId: c,
        userId: u.id,
        styleId: style.id,
        title: (b.title?.trim() || `${style.name} — yeni sınav`).slice(0, 160),
        status: "GENERATING",
        requested: kinds.length,
        topics,
        items: [],
        failures: [],
      },
    });
    // Runs in this process. The caller polls GET /exams/:id.
    void this.run(u, c, row.id, style.id, kinds, topics, b.scope).catch((e) => {
      this.log.error(`exam ${row.id} failed: ${e?.message ?? e}`);
    });
    return this.summary(row);
  }

  /** Text of the ready materials in scope (bounded), used only to pick answerable topics. */
  private async sourceTexts(u: AuthUser, c: string, scope: any): Promise<{ title: string; text: string }[]> {
    const materials = (await this.knowledge.materials(u, c)).filter((m: any) => m.status === "READY");
    const ids = scope?.mode === "selected" && Array.isArray(scope.material_ids) ? new Set<string>(scope.material_ids) : null;
    const out: { title: string; text: string }[] = [];
    for (const m of materials.filter((m: any) => !ids || ids.has(m.id)).slice(0, 8)) {
      try {
        const p = await this.knowledge.preview(u, c, m.id);
        for (const seg of (p.segments || []).slice(0, 400)) if (seg.text?.trim()) out.push({ title: m.title, text: String(seg.text).slice(0, 2000) });
      } catch {
        /* an unreadable material only gives no topics */
      }
    }
    return out;
  }

  private async run(
    u: AuthUser,
    c: string,
    id: string,
    styleId: string,
    kinds: string[],
    topics: string[],
    scope: any,
  ) {
    const items: Item[] = [];
    const failures: Failure[] = [];
    let note: string | null = null;
    let cursor = 0;
    let attempts = 0;
    const maxAttempts = kinds.length * 3;
    const save = (status: string, finished = false) =>
      this.prisma.generatedExam.update({
        where: { id },
        data: { status, items: items as any, failures: failures as any, note, ...(finished ? { finishedAt: new Date() } : {}) },
      });
    try {
      for (const kind of kinds) {
        let produced = false;
        for (let tried = 0; tried < topics.length && attempts < maxAttempts && !produced; tried++) {
          const topic = topics[cursor % topics.length];
          cursor++;
          attempts++;
          try {
            const quiz = await this.learning.start(u, c, { topic, kind, scope, exam_style_id: styleId });
            items.push({ quiz_id: quiz.id, kind, topic });
            produced = true;
            await save("GENERATING");
          } catch (e: any) {
            const code = e?.code as string | undefined;
            failures.push({ topic, kind, reason: String(e?.message ?? "Soru hazırlanamadı.").slice(0, 300) });
            if (code && INFRASTRUCTURE.has(code)) {
              note = "Soru hazırlayan model yanıt vermediği için üretim durduruldu.";
              await save(items.length ? "PARTIAL" : "FAILED", true);
              return;
            }
          }
        }
      }
      if (!items.length) {
        const top = commonReason(failures);
        note = "Seçilen konular için kaynaklara dayalı soru hazırlanamadı." + (top ? ` En sık neden (${top.count}/${failures.length} deneme): ${top.reason}` : "");
      }
      else if (items.length < kinds.length) note = `${kinds.length} sorudan ${items.length}'i hazırlanabildi; kalanı için yeterli kaynak bulunamadı.`;
      await save(items.length === kinds.length ? "READY" : items.length ? "PARTIAL" : "FAILED", true);
    } catch (e: any) {
      note = "Beklenmeyen bir hata oluştu.";
      await save(items.length ? "PARTIAL" : "FAILED", true).catch(() => undefined);
      throw e;
    }
  }

  private summary(row: any) {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      requested: row.requested,
      produced: (row.items as Item[]).length,
      topics: row.topics,
      failures: row.failures,
      note: row.note,
      style_id: row.styleId,
      created_at: row.createdAt,
      finished_at: row.finishedAt,
    };
  }

  async list(u: AuthUser, c: string) {
    await this.access.requireMember(u, c);
    const rows = await this.prisma.generatedExam.findMany({
      where: { courseId: c, userId: u.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => this.summary(r));
  }

  private async own(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const row = await this.prisma.generatedExam.findFirst({ where: { id, courseId: c, userId: u.id } });
    if (!row) throw notFound("Exam");
    return row;
  }

  /** Questions as students see them: no answers, no quotes. */
  async get(u: AuthUser, c: string, id: string) {
    const row = await this.own(u, c, id);
    const questions = [];
    for (const item of row.items as Item[]) {
      try {
        questions.push({ ...(await this.learning.quiz(u, c, item.quiz_id)), available: true });
      } catch {
        // Its source was removed or changed: say so rather than show a stale question.
        questions.push({ id: item.quiz_id, kind: item.kind, topic: item.topic, available: false });
      }
    }
    return { ...this.summary(row), questions };
  }

  /** Answer key for printing: correct answer, explanation and the source passage of each question. */
  async key(u: AuthUser, c: string, id: string) {
    const row = await this.own(u, c, id);
    const ids = (row.items as Item[]).map((i) => i.quiz_id);
    const quizzes = await this.prisma.learningQuiz.findMany({
      where: { id: { in: ids }, userId: u.id, courseId: c, redacted: false },
    });
    const byId = new Map(quizzes.map((q) => [q.id, q]));
    return {
      id: row.id,
      title: row.title,
      key: ids.map((qid, index) => {
        const q = byId.get(qid);
        const d = q?.data as any;
        if (!q || !d) return { index: index + 1, quiz_id: qid, available: false };
        const expected = d.options?.length ? d.options[Number(d.expected)] : d.expected;
        return {
          index: index + 1,
          quiz_id: qid,
          available: true,
          kind: q.kind,
          expected: q.kind === "OPEN" ? null : expected ?? null,
          explanation: d.explanation ?? null,
          quote: d.quote ?? null,
          source: d.source ? { title: d.source.title, location: d.source.location } : null,
        };
      }),
    };
  }

  async remove(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const removed = await this.prisma.generatedExam.deleteMany({ where: { id, courseId: c, userId: u.id } });
    if (!removed.count) throw notFound("Exam");
    return { deleted: true };
  }
}
