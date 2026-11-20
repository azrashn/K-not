import { Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { ApiError, notFound } from "../common/errors";
import { AccessService } from "../courses/access.service";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiServiceClient } from "../ai/ai-client";
import { APP_CONFIG, AppConfig, QuizEngine } from "../config/config";
import { validSourceCompletion } from "./quiz-validation";
import { quizHistoryItem, setsByQuiz } from "./quiz-history";
import { buildExamProfile, examStyleHint, ExamProfile } from "./exam-style";
import { matchAnswer, rubricCoverage, rubricTerms } from "./answer-match";
import { findQuizSources } from "./quiz-sources";
import { publicQuiz } from "./quiz-public";
import { QuizGenerator } from "./quiz-generator";
import { QuizBuilder } from "./generation/quiz-builder";
import { loadPool, TRANSCRIPT_WARNING } from "./generation/source-pool";
import { suggestTopics } from "./generation/topic-planner";

/** Model time for one question from POST /quizzes: first call plus one repair (see quiz_engine.py). */
export const SINGLE_QUIZ_BUDGET_SECONDS = 130;
/** Model time for one request of a quiz set (one or two questions of one source part, plus repairs). */
export const SET_REQUEST_BUDGET_SECONDS = 240;

@Injectable()
export class LearningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiServiceClient,
    @Optional() private readonly generator?: QuizGenerator,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  /** v2 needs the generator; a service built without one (older unit tests) runs the legacy engine. */
  get quizEngine(): QuizEngine {
    return this.generator && (this.config?.quizEngine ?? "v2") === "v2" ? "v2" : "legacy";
  }
  async activity(u: AuthUser, c: string, body: any) {
    await this.access.requireMember(u, c);
    if (body.material_id) {
      const m = (await this.knowledge.materials(u, c)).find(
        (m) => m.id === body.material_id,
      );
      if (!m) throw notFound("Material");
    }
    if (body.segment_id)
      await this.knowledge.source(u, c, body.material_id, body.segment_id);
    return this.prisma.learningActivity.upsert({
      where: { userId_courseId: { userId: u.id, courseId: c } },
      create: {
        userId: u.id,
        courseId: c,
        materialId: body.material_id,
        segmentId: body.segment_id,
        events: 1,
      },
      update: {
        materialId: body.material_id,
        segmentId: body.segment_id,
        events: { increment: 1 },
      },
    });
  }
  async overview(u: AuthUser) {
    const scope = {
      userId: u.id,
      course: {
        lifecycle: "ACTIVE",
        memberships: { some: { userId: u.id, archivedAt: null } },
      },
    };
    const [activities, storedAttempts, quizzes, videos] = await Promise.all([
      this.prisma.learningActivity.findMany({
        where: scope,
        include: { course: { select: { id: true, name: true } } },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      this.prisma.learningQuizAttempt.findMany({
        where: {
          userId: u.id,
          quiz: {
            redacted: false,
            course: {
              lifecycle: "ACTIVE",
              memberships: { some: { userId: u.id, archivedAt: null } },
            },
          },
        },
        include: { quiz: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.learningQuiz.count({ where: { ...scope, redacted: false } }),
      this.prisma.videoProgress.findMany({
        where: {
          userId: u.id,
          video: {
            ownerId: u.id,
            course: {
              lifecycle: "ACTIVE",
              memberships: { some: { userId: u.id, archivedAt: null } },
            },
          },
        },
        include: {
          video: { select: { title: true, courseId: true, durationMs: true } },
        },
        take: 100,
      }),
    ]);
    const manifests = new Map(
      await Promise.all(
        [...new Set(storedAttempts.map((a) => a.quiz.courseId))].map(
          async (c) => [c, await this.knowledge.materials(u, c)] as const,
        ),
      ),
    );
    const attempts = storedAttempts.filter((a) =>
      manifests
        .get(a.quiz.courseId)
        ?.some(
          (m) =>
            m.id === a.quiz.materialId &&
            m.version === a.quiz.version &&
            m.status === "READY",
        ),
    );
    const graded = attempts.filter((a) => a.score !== null),
      correct = graded.filter((a) => a.score === 1).length;
    const latest = [
      ...new Map([...attempts].reverse().map((a) => [a.quizId, a])).values(),
    ];
    const review = latest.find((a) => a.outcome === "REVIEW_SOURCE");
    return {
      activities,
      attempts: attempts.map((a) => ({
        id: a.id,
        quiz_id: a.quizId,
        course_id: a.quiz.courseId,
        topic: a.quiz.topic,
        outcome: a.outcome,
        score: a.score,
        created_at: a.createdAt,
        // An older question may hold JSON null as its data: listed without a source, not a 500.
        source: (a.quiz.data as any)?.source ?? null,
      })),
      quiz_count: quizzes,
      graded_count: graded.length,
      correct_count: correct,
      video_progress: videos.map((v) => ({
        video_id: v.videoId,
        title: v.video.title,
        course_id: v.video.courseId,
        position_ms: v.positionMs,
        intervals: v.intervals,
        duration_ms: v.video.durationMs,
        updated_at: v.updatedAt,
      })),
      recommendation: review
        ? {
            course_id: review.quiz.courseId,
            topic: review.quiz.topic,
            source: (review.quiz.data as any)?.source ?? null,
          }
        : null,
      mastery_estimated: false,
    };
  }
  /**
   * POST /quizzes. v2: one question is returned at once (the public quiz); 2-10 questions start a quiz set
   * written in the background, returned as `{ set }` (the controller answers 202). Legacy: one question of one
   * kind, as before.
   */
  async start(u: AuthUser, c: string, b: any): Promise<any> {
    const count = b.count ?? 1;
    if (this.quizEngine === "v2") {
      const styleHint = await this.styleHintFor(u, c, b.exam_style_id);
      const request = { ...b, count, styleHint };
      if (count > 1) {
        await this.access.requireMember(u, c);
        return { set: this.quizSetSummary(await this.quizBuilder().startSet(u, c, request, SET_REQUEST_BUDGET_SECONDS)) };
      }
      return this.quizBuilder().single(u, c, request, SINGLE_QUIZ_BUDGET_SECONDS);
    }
    if (count > 1 || b.kind === "MIXED")
      throw new ApiError("VALIDATION_ERROR", "Birden fazla soru ve “Karışık” tür yalnız yeni soru motoruyla kullanılabilir.");
    return this.startLegacy(u, c, b);
  }

  /** The v2 quiz: source pool, the topic's parts, plan and run (generation/quiz-builder.ts). */
  private quizBuilder(): QuizBuilder {
    return new QuizBuilder(this.prisma, this.knowledge, this.generator!, this.config?.quizTranscriptPolicy ?? "documents_first");
  }

  private quizSetSummary(row: any) {
    // The transcript warning opens the stored note; the screen shows it on its own (as for one question).
    const warning = typeof row.note === "string" && row.note.startsWith(TRANSCRIPT_WARNING) ? TRANSCRIPT_WARNING : null;
    return {
      id: row.id,
      type: "quiz_set",
      topic: row.title,
      status: row.status,
      requested: row.requested,
      produced: (row.items as any[]).length,
      failures: row.failures,
      note: warning ? row.note.slice(warning.length).trim() || null : row.note,
      source_warning: warning,
      created_at: row.createdAt,
      finished_at: row.finishedAt,
    };
  }

  /**
   * GET /quiz-topics: up to five short topics from the course sources (headings, then subject words), by the
   * same document-first rule as the questions. A course with nothing usable gives an empty list, not an error:
   * the form then works without suggestions.
   */
  async quizTopics(u: AuthUser, c: string): Promise<{ topics: string[] }> {
    await this.access.requireMember(u, c);
    try {
      const pool = await loadPool(this.knowledge, u, c, {}, this.config?.quizTranscriptPolicy ?? "documents_first");
      return { topics: suggestTopics(pool) };
    } catch (e: any) {
      if (e?.code === "VALIDATION_ERROR") return { topics: [] };
      throw e;
    }
  }

  /** GET /quiz-sets/:id: the set with its questions as students see them (no answers, no quotes). */
  async quizSet(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const row = await this.prisma.generatedExam.findFirst({ where: { id, courseId: c, userId: u.id, purpose: "PRACTICE" } });
    if (!row) throw notFound("Quiz set");
    const questions = [];
    for (const item of row.items as { quiz_id: string; kind: string; topic: string }[]) {
      try {
        questions.push({ ...(await this.quiz(u, c, item.quiz_id)), available: true });
      } catch {
        // Its source was removed or changed: say so rather than show a stale question.
        questions.push({ id: item.quiz_id, kind: item.kind, topic: item.topic, available: false });
      }
    }
    return { ...this.quizSetSummary(row), questions };
  }

  /** The original engine (ai-service quiz_quality.py) with its original acceptance rules. */
  private async startLegacy(u: AuthUser, c: string, b: any) {
    const candidates = await findQuizSources(this.knowledge, u, c, b);
    let source = candidates[0];
    const styleHint = await this.styleHintFor(u, c, b.exam_style_id);
    const r = await this.ai.call("POST", "/api/v1/knowledge/quiz", {
      body: {
        question: b.topic,
        kind: b.kind,
        evidence: candidates,
        ...(styleHint ? { style_hint: styleHint } : {}),
      },
      timeoutMs: 150000,
    });
    if (r.kind === "timeout")
      throw new ApiError(
        "PROVIDER_TIMEOUT",
        "Soru hazırlama beklenenden uzun sürdü. Lütfen yeniden deneyin.",
      );
    if (r.kind === "unreachable" || (r.kind === "response" && r.status === 503))
      throw new ApiError(
        "AI_SERVICE_UNAVAILABLE",
        "Soru hazırlayan yerel model yanıt veremedi. Lütfen biraz sonra yeniden deneyin.",
      );
    if (r.kind === "response" && r.status === 422)
      throw new ApiError(
        "VALIDATION_ERROR",
        r.body?.detail?.code === "QUIZ_TOPIC_NOT_FOUND"
          ? "Seçili kaynaklarda bu konuyu açıklayan bir bölüm bulunamadı. Konuyu veya kaynak kapsamını değiştirin."
          : "Kaynaklara dayalı, net bir soru hazırlanamadı. Konuyu tek bir kavram veya adıma daraltıp yeniden deneyin.",
      );
    if (r.kind !== "response" || r.status !== 200)
      throw new ApiError(
        "GENERATION_FAILED",
        "Kaynakla doğrulanabilen soru hazırlanamadı. Başka bir bölüm veya soru türü deneyin.",
      );
    const q = r.body;
    if (
      !q.quality?.structural_validation ||
      (!(q.quality?.independent_model_review && q.quality?.option_audit_version === 2) &&
        !validSourceCompletion(q,candidates)) ||
      !Number.isInteger(q.source_index) ||
      q.source_index < 1 ||
      q.source_index > candidates.length
    )
      throw new ApiError(
        "GENERATION_FAILED",
        "Soru kalite kontrolünden geçmedi; yayınlanmadı.",
      );
    source = candidates[q.source_index - 1];
    if (
      q.kind !== b.kind ||
      typeof q.question !== "string" ||
      typeof q.expected !== "string" ||
      typeof q.quote !== "string" ||
      !source.text.includes(q.quote)
    )
      throw new ApiError("INTERNAL_ERROR", "Soru kaynakla eşleşmedi.");
    if (
      !q.quote.trim() ||
      q.question.length > 3000 ||
      !Array.isArray(q.options) ||
      q.options.length > 4 ||
      q.options.some(
        (o: any) => typeof o !== "string" || !o.trim() || o.length > 400,
      ) ||
      (["MULTIPLE_CHOICE", "TRUE_FALSE"].includes(b.kind) &&
        (!/^[0-3]$/.test(q.expected) || Number(q.expected) >= q.options.length))
    )
      throw new ApiError("INTERNAL_ERROR", "Geçersiz soru biçimi.");
    await this.knowledge.source(u, c, source.material_id, source.id);
    const row = await this.prisma.learningQuiz.create({
      data: {
        id: randomUUID(),
        userId: u.id,
        courseId: c,
        topic: b.topic,
        kind: b.kind,
        materialId: source.material_id,
        segmentId: source.id,
        version: source.version,
        // Set only by the legacy exam run (an internal call): the public body has no purpose field.
        purpose: b.purpose === "EXAM" ? "EXAM" : "PRACTICE",
        data: {
          ...q,
          source,
          scope: b.scope || { mode: b.material_id ? "active" : "course" },
          watched_only: Boolean(b.watched_only),
        },
      },
    });
    return this.publicQuiz(row);
  }
  private publicQuiz(row: any) {
    return publicQuiz(row);
  }
  async quiz(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const q = await this.prisma.learningQuiz.findFirst({
      where: { id, userId: u.id, courseId: c, redacted: false },
    });
    if (!q) throw notFound("Quiz");
    await this.knowledge.source(u, c, q.materialId, q.segmentId);
    return this.publicQuiz(q);
  }
  async answer(u: AuthUser, c: string, id: string, response: string) {
    await this.quiz(u, c, id);
    const q = await this.prisma.learningQuiz.findUniqueOrThrow({
      where: { id },
    });
    const data = q.data as any;
    if (
      data.options?.length &&
      (!/^\d$/.test(response) || Number(response) >= data.options.length)
    )
      throw new ApiError(
        "VALIDATION_ERROR",
        "Geçerli bir yanıt seçeneği seçin.",
      );
    const norm = (s: string) =>
      s.trim().toLocaleLowerCase("tr").normalize("NFC");
    const reflection = q.kind === "OPEN";
    // Typed answers (cloze, short answer) accept safe equivalents: another case, Turkish
    // diacritics, the same words reordered, a one-letter slip in a long word. Choices stay exact.
    const typed = ["CLOZE", "SHORT_ANSWER"].includes(q.kind);
    const matchMode = typed ? matchAnswer(data.expected, response) : null;
    const matched = typed
      ? matchMode !== null
      : norm(response) === norm(data.expected);
    const exact = ["MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE"].includes(q.kind);
    // Key-term coverage is shown for short answers that did not match; it never grades.
    const rubric =
      q.kind === "SHORT_ANSWER" && !matched && typeof data.expected === "string"
        ? rubricCoverage(rubricTerms(data.expected), response)
        : null;
    const score = reflection ? null : matched ? 1 : exact ? 0 : null;
    const outcome = reflection
      ? "REFLECTION_SAVED"
      : matched
        ? "CORRECT"
        : exact
          ? "REVIEW_SOURCE"
          : "REVIEW_REQUIRED";
    const feedback = {
      message: reflection
        ? "Yanıtın kaydedildi. Açık uçlu yanıt için otomatik doğruluk puanı verilmedi."
        : matched
          ? "Yanıt, bu sorunun kaynakla eşleştirilen cevap anahtarıyla uyumlu."
          : data.options?.length
            ? "Seçtiğin seçenek cevap anahtarıyla uyuşmuyor. Doğru seçeneği ve kaynak açıklamasını birlikte incele."
            : "Kaynak ifadesini incele; farklı sözcüklerle verilen kısa cevap otomatik yanlış sayılmaz.",
      expected: reflection
        ? null
        : data.options?.length
          ? data.options[Number(data.expected)]
          : data.expected,
      quote: data.quote,
      source: data.source,
      explanation: data.explanation || null,
      objective: data.objective || null,
      feedback_mode: data.quality?.feedback_mode || "MODEL_REVIEWED",
      selected_option_feedback: data.options?.length
        ? data.option_feedback?.[Number(response)] || null
        : null,
      feedback_experimental: Boolean(data.experimental),
      match_mode: matchMode,
      rubric: rubric && rubric.terms.length ? rubric : null,
      mastery_estimated: false,
    };
    const row = await this.prisma.learningQuizAttempt.create({
      data: { quizId: id, userId: u.id, response, outcome, feedback, score },
    });
    return { id: row.id, outcome, score, ...feedback };
  }
  private async styleHintFor(u: AuthUser, c: string, id?: string) {
    if (!id) return null;
    const row = await this.prisma.examStyle.findFirst({
      where: { id, courseId: c, ownerId: u.id },
    });
    if (!row) throw notFound("Exam style");
    return examStyleHint(row.profile as unknown as ExamProfile);
  }
  private publicExamStyle(row: any) {
    return {
      id: row.id,
      name: row.name,
      created_at: row.createdAt,
      profile: row.profile as ExamProfile,
    };
  }
  async examStyles(u: AuthUser, c: string) {
    await this.access.requireMember(u, c);
    const rows = await this.prisma.examStyle.findMany({
      where: { courseId: c, ownerId: u.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return rows.map((r) => this.publicExamStyle(r));
  }
  async createExamStyle(u: AuthUser, c: string, b: { name: string; text: string }) {
    await this.access.requireMember(u, c);
    let profile: ExamProfile;
    try {
      profile = buildExamProfile(b.text);
    } catch {
      throw new ApiError(
        "VALIDATION_ERROR",
        "Sınav soruları numaralandırılmış olmalı (1. … 2. … gibi). Numarasız metinden stil çıkarılamaz.",
      );
    }
    const row = await this.prisma.examStyle.create({
      data: { id: randomUUID(), courseId: c, ownerId: u.id, name: b.name.trim(), profile: profile as any },
    });
    return this.publicExamStyle(row);
  }
  async deleteExamStyle(u: AuthUser, c: string, id: string) {
    await this.access.requireMember(u, c);
    const removed = await this.prisma.examStyle.deleteMany({
      where: { id, courseId: c, ownerId: u.id },
    });
    if (!removed.count) throw notFound("Exam style");
    return { deleted: true };
  }
  /** Quiz history: practice by default; the questions of generated exams only when asked for (EXAM). */
  async quizzes(u: AuthUser, c: string, purpose: "PRACTICE" | "EXAM" = "PRACTICE") {
    await this.access.requireMember(u, c);
    const [rows, sets] = await Promise.all([this.prisma.learningQuiz.findMany({
      where: { userId: u.id, courseId: c, redacted: false, purpose },
      select: {
        id: true,
        kind: true,
        topic: true,
        createdAt: true,
        data: true,
        attempts: {
          select: { outcome: true, score: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: { select: { attempts: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    // Quiz sets (PRACTICE) or generated exams (EXAM): which card each question belongs to.
    this.prisma.generatedExam.findMany({
      where: { userId: u.id, courseId: c, purpose },
      select: { id: true, title: true, items: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })]);
    const bySet = setsByQuiz(sets);
    return rows.map((row) => quizHistoryItem(row, bySet.get(row.id) ?? null));
  }
}
