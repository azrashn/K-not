import { Inject, Injectable, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { ApiError, notFound } from "../common/errors";
import { AccessService } from "../courses/access.service";
import { AiServiceClient } from "../ai/ai-client";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { APP_CONFIG, AppConfig, QuizEngine } from "../config/config";
import { LearningService } from "./learning.service";
import {
  commonReason, EXAM_MAX_QUESTIONS, ExamItem, examTopics, groundTopics, planExamItems, planExamKinds,
} from "./exam-plan";
import { EXAM_STYLES_MAX, examStyleHint, ExamProfile, mergeExamProfiles } from "./exam-style";
import { GenerateResult, QuizGenerator } from "./quiz-generator";
import { describeFailure, failure, INFRASTRUCTURE_CODES, TIME_CODES } from "./quiz-failures";
import { loadSourceTexts } from "./source-texts";

type Item = { quiz_id: string; kind: string; topic: string };
/** `code` is set by the v2 engine (quiz-failures.ts); legacy failures carry the message only. */
type Failure = { topic: string; kind: string; reason: string; code?: string };
type Slot = { slot: number; kind: string; variant?: "CALCULATION" };

/** v2: questions of one topic asked together, at most this many per ai-service request. */
export const EXAM_BATCH_SIZE = 3;
/** v2: model time for one exam request (up to three questions plus repairs on a CPU model). */
export const EXAM_BATCH_BUDGET_SECONDS = 240;
/** v2: whole requests in a row that only timed out before the run stops. */
export const EXAM_TIMEOUT_STREAK_LIMIT = 2;

const FILE_KINDS: Record<string, "PDF" | "DOCX" | "TXT"> = {
  ".pdf": "PDF",
  ".docx": "DOCX",
  ".txt": "TXT",
  ".md": "TXT",
};
// Model or service trouble stops the whole run; a missing source only skips that topic.
const INFRASTRUCTURE = new Set(["AI_SERVICE_UNAVAILABLE", "PROVIDER_TIMEOUT"]);

/** The selected past exams: exactly one of `exam_style_id` (older clients) and `exam_style_ids`. */
export function examStyleIds(b: { exam_style_id?: string; exam_style_ids?: string[] }): string[] {
  const single = typeof b.exam_style_id === "string" && b.exam_style_id !== "";
  const many = Array.isArray(b.exam_style_ids);
  if (single === many)
    throw new ApiError(
      "VALIDATION_ERROR",
      single
        ? "exam_style_id ve exam_style_ids birlikte gönderilemez; yalnız birini kullanın."
        : "En az bir geçmiş sınav seçin.",
    );
  const ids = single ? [b.exam_style_id!] : b.exam_style_ids!;
  if (!ids.length || ids.length > EXAM_STYLES_MAX)
    throw new ApiError("VALIDATION_ERROR", `1 ile ${EXAM_STYLES_MAX} arasında geçmiş sınav seçin.`);
  if (new Set(ids).size !== ids.length)
    throw new ApiError("VALIDATION_ERROR", "Aynı geçmiş sınav birden fazla kez seçilemez.");
  return ids;
}

/** No count from the client: the average question count of the selected exams, within 1..20. */
export function defaultExamCount(profiles: ExamProfile[]): number {
  const total = profiles.reduce((sum, p) => sum + (p.question_count ?? 0), 0);
  return Math.max(1, Math.min(EXAM_MAX_QUESTIONS, Math.round(total / Math.max(1, profiles.length))));
}

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
    @Optional() private readonly knowledge?: KnowledgeService,
    @Optional() private readonly generator?: QuizGenerator,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  /** v2 needs the generator; a service built without one (older unit tests) runs the legacy engine. */
  get quizEngine(): QuizEngine {
    return this.generator && (this.config?.quizEngine ?? "v2") === "v2" ? "v2" : "legacy";
  }

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
    b: {
      exam_style_id?: string;
      exam_style_ids?: string[];
      count?: number;
      topics?: string[];
      title?: string;
      scope?: any;
    },
  ) {
    await this.access.requireMember(u, c);
    const ids = examStyleIds(b);
    const v2 = this.quizEngine === "v2";
    if (!v2 && ids.length > 1)
      throw new ApiError(
        "VALIDATION_ERROR",
        "Birden fazla geçmiş sınav yalnız yeni soru motoruyla birlikte kullanılabilir. Tek bir sınav seçin.",
      );
    const rows = await this.prisma.examStyle.findMany({
      where: { id: { in: ids }, courseId: c, ownerId: u.id },
    });
    // Any missing or foreign style is "not found", as for a single style: nothing about others' styles leaks.
    if (rows.length !== ids.length) throw notFound("Exam style");
    const byId = new Map(rows.map((r) => [r.id, r]));
    const styles = ids.map((id) => byId.get(id)!);
    const style = styles[0];
    const profile = mergeExamProfiles(styles.map((s) => s.profile as unknown as ExamProfile));
    const count = b.count ?? defaultExamCount(styles.map((s) => s.profile as unknown as ExamProfile));
    let topics = examTopics(b.topics, profile);
    // Terms from the past exams are only useful when the course sources talk about them (both engines);
    // terms shared by more of the selected exams come first. Topics the student wrote are never filtered.
    if (this.knowledge && !b.topics?.some((t) => String(t).trim()))
      topics = groundTopics(topics, await loadSourceTexts(this.knowledge, u, c, b.scope), count, profile.term_exams).topics;
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
    const plan = v2 ? planExamItems(profile, count) : null;
    const kinds = plan ? plan.map((i) => i.kind) : planExamKinds(profile, count);
    const fallbackTitle = styles.length > 1 ? `${styles.length} geçmiş sınavdan yeni sınav` : `${style.name} — yeni sınav`;
    const row = await this.prisma.generatedExam.create({
      data: {
        id: randomUUID(),
        courseId: c,
        userId: u.id,
        styleId: style.id,
        styleIds: ids,
        title: (b.title?.trim() || fallbackTitle).slice(0, 160),
        status: "GENERATING",
        requested: kinds.length,
        topics,
        items: [],
        failures: [],
      },
    });
    // Runs in this process. The caller polls GET /exams/:id.
    const generation = plan
      ? this.runV2(u, c, row.id, plan, topics, b.scope, examStyleHint(profile))
      : this.run(u, c, row.id, style.id, kinds, topics, b.scope);
    void generation.catch((e) => {
      this.log.error(`exam ${row.id} failed: ${e?.message ?? e}`);
    });
    return this.summary(row);
  }

  /**
   * v2 run. Slots go to topics in turn; the slots of one topic are asked together (≤ EXAM_BATCH_SIZE).
   * A bad or timed-out question only loses itself: its reason is recorded with a code and the slot is
   * tried once more with the next topic. The run stops early only when the model is unreachable or
   * EXAM_TIMEOUT_STREAK_LIMIT requests in a row produced nothing but timeouts.
   */
  private async runV2(
    u: AuthUser,
    c: string,
    id: string,
    plan: ExamItem[],
    topics: string[],
    scope: any,
    styleHint: string | null,
  ) {
    const produced: (Item & { slot: number })[] = [];
    const failures: Failure[] = [];
    const stems: string[] = [];
    let note: string | null = null;
    let timeoutStreak = 0;
    // Set inside ask(); the assertion keeps TypeScript from narrowing it to null after the calls.
    let stopped = null as "MODEL" | "TIMEOUTS" | null;
    const save = (status: string, finished = false) =>
      this.prisma.generatedExam.update({
        where: { id },
        data: {
          status,
          items: [...produced].sort((a, b) => a.slot - b.slot).map(({ quiz_id, kind, topic }) => ({ quiz_id, kind, topic })) as any,
          failures: failures as any,
          note,
          ...(finished ? { finishedAt: new Date() } : {}),
        },
      });

    /** One ai-service request; returns the slots that failed and may be retried. */
    const ask = async (topic: string, slots: Slot[]): Promise<Slot[]> => {
      let result: GenerateResult;
      try {
        result = await this.generator!.generate(u, c, {
          topic,
          scope,
          items: slots.map((s) => ({ kind: s.kind, variant: s.variant ?? null })),
          styleHint,
          avoidStems: stems,
          budgetSeconds: EXAM_BATCH_BUDGET_SECONDS,
        });
      } catch (e: any) {
        if (e?.code !== "VALIDATION_ERROR") throw e;
        // No source for this topic: every slot of the request fails for that reason, no model call.
        result = { quizzes: [], stems: [], failures: slots.map((s, i) => failure(i, s.kind, "NO_SOURCE", 0, s.variant)) };
      }
      for (const q of result.quizzes) produced.push({ slot: slots[q.slot].slot, quiz_id: q.id, kind: slots[q.slot].kind, topic });
      stems.push(...result.stems);
      for (const f of result.failures) failures.push({ topic, kind: f.kind, reason: describeFailure(f), code: f.code });
      const codes = result.failures.map((f) => f.code);
      if (!result.quizzes.length && codes.some((code) => INFRASTRUCTURE_CODES.has(code))) stopped = "MODEL";
      else if (!result.quizzes.length && codes.length && codes.every((code) => TIME_CODES.has(code))) {
        if (++timeoutStreak >= EXAM_TIMEOUT_STREAK_LIMIT) stopped = "TIMEOUTS";
      } else timeoutStreak = 0;
      await save("GENERATING");
      return result.failures.filter((f) => !INFRASTRUCTURE_CODES.has(f.code)).map((f) => slots[f.slot]);
    };

    /** Asks every slot with its topic, grouped per topic in batches; returns the failed slots. */
    const pass = async (slots: Slot[], topicOf: (s: Slot) => string): Promise<Slot[]> => {
      const byTopic = new Map<string, Slot[]>();
      for (const s of slots) byTopic.set(topicOf(s), [...(byTopic.get(topicOf(s)) ?? []), s]);
      const failed: Slot[] = [];
      for (const [topic, list] of byTopic)
        for (let i = 0; i < list.length; i += EXAM_BATCH_SIZE) {
          if (stopped) return failed;
          failed.push(...(await ask(topic, list.slice(i, i + EXAM_BATCH_SIZE))));
        }
      return failed;
    };

    try {
      const slots: Slot[] = plan.map((p, slot) => ({ slot, kind: p.kind, ...(p.variant ? { variant: p.variant } : {}) }));
      const failed = await pass(slots, (s) => topics[s.slot % topics.length]);
      // One more try for each failed slot, with the next topic. A single topic has nothing else to offer.
      if (!stopped && failed.length && topics.length > 1)
        await pass(failed, (s) => topics[(s.slot + 1) % topics.length]);
      const top = commonReason(failures);
      const why = top ? ` En sık neden (${top.count}/${failures.length} deneme): ${top.reason}` : "";
      if (stopped === "MODEL") note = "Soru hazırlayan modele ulaşılamadığı için üretim durduruldu.";
      else if (stopped === "TIMEOUTS") note = "Model arka arkaya iki kez ayrılan sürede yanıt vermediği için üretim durduruldu.";
      else if (!produced.length) note = "Seçilen konular için kaynaklara dayalı soru hazırlanamadı." + why;
      else if (produced.length < plan.length) note = `${plan.length} sorudan ${produced.length}'i hazırlanabildi.` + why;
      await save(produced.length === plan.length ? "READY" : produced.length ? "PARTIAL" : "FAILED", true);
    } catch (e: any) {
      note = "Beklenmeyen bir hata oluştu.";
      await save(produced.length ? "PARTIAL" : "FAILED", true).catch(() => undefined);
      throw e;
    }
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
      // Exams made before several styles could be combined only have styleId.
      style_ids: Array.isArray(row.styleIds) ? row.styleIds : row.styleId ? [row.styleId] : [],
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
