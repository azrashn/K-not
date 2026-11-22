/** Quiz on one topic, 1 to 15 questions of one kind or "Karışık" (QUIZ_ENGINE=v2).
 *
 *  source pool → the topic's parts → plan → questions. One question is written while the student waits and
 *  returned at once (as before). 2-15 questions are a quiz set: saved as GENERATING (GeneratedExam, purpose
 *  PRACTICE) and written in the background like an exam; the screen follows GET /quiz-sets/:id. */
import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/errors";
import type { AuthUser } from "../../common/request-context";
import type { QuizTranscriptPolicy } from "../../config/config";
import type { KnowledgeService } from "../../knowledge/knowledge.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { quizError } from "../quiz-failures";
import type { QuizGenerator } from "../quiz-generator";
import { publicQuiz } from "../quiz-public";
import { runPlan } from "./generation-run";
import { planQuestions, quizItems, type QuestionPlan, type QuizKindChoice } from "./question-plan";
import { RepeatGuard } from "./repeat-guard";
import { runInBackground, startNote } from "./set-runner";
import { loadPool, type SourcePart, type SourcePool } from "./source-pool";
import { examTopics, quizTopic } from "./topic-planner";

/** The pool's parts that are not the topic's own, nearest first: the topic's materials before the others, and
 *  within a material the pages next to the topic's pages first. Used to complete a quiz the topic cannot carry. */
export function outsideParts(pool: SourcePool, own: SourcePart[]): SourcePart[] {
  const keys = new Set(own.map((p) => p.key));
  const materials = new Set(own.map((p) => p.material_id));
  const distance = (p: SourcePart) => Math.min(...own.map((o) => Math.abs(o.order - p.order)));
  return pool.parts
    .filter((p) => !keys.has(p.key))
    .sort((a, b) => Number(!materials.has(a.material_id)) - Number(!materials.has(b.material_id)) || distance(a) - distance(b));
}

export const NOTHING_TO_ASK = "Bu konuda soru hazırlamaya uygun kaynak metni bulunamadı.";
export const NOT_WATCHED =
  "Bu konuda tamamen izlenmiş video bölümü bulunamadı. Son oynatma konumu tek başına izleme kanıtı değildir.";
/** Quiz setinde bir sorunun en fazla deneme sayısı (sınav ve tek soru kendi değerini korur). */
export const SET_MAX_TRIES = 3;
export const SET_RUNNING = "Bu ders için bir alıştırma seti zaten hazırlanıyor. Bitmesini bekleyin.";

/** Shown as the set's title when no topic is given: the whole course is practised. */
export const WHOLE_COURSE = "Tüm ders";
export const WHOLE_COURSE_WATCHED = "İzlenenlerden alıştırma için bir konu yazın.";

export type QuizRequest = {
  /** Empty or missing: questions are spread over the whole pool, one part after another. */
  topic?: string;
  kind: QuizKindChoice;
  count?: number;
  scope?: any;
  watched_only?: boolean;
  material_id?: string;
  styleHint?: string | null;
};

export class QuizBuilder {
  private readonly log = new Logger(QuizBuilder.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly generator: Pick<QuizGenerator, "generate">,
    private readonly policy: QuizTranscriptPolicy = "documents_first",
  ) {}

  /**
   * The pool, the topic bound to its parts and the plan. A search ranks the parts too (a topic written in
   * other words can still be found); for watched-only practice it also decides which video parts count.
   */
  private async prepare(u: AuthUser, c: string, b: QuizRequest): Promise<{ pool: SourcePool; plan: QuestionPlan }> {
    const items = quizItems(b.kind, b.count ?? 1); // refuses a bad count or kind before any work
    const general = !String(b.topic ?? "").trim();
    if (general && b.watched_only) throw new ApiError("VALIDATION_ERROR", WHOLE_COURSE_WATCHED);
    let retrieved: string[] = [];
    let eligible: Set<string> | undefined;
    try {
      if (general) throw new Error("no topic to search");
      const found = await this.knowledge.ask(u, c, {
        question: b.topic,
        retrieve_only: true,
        scope: b.scope,
        watched_only: Boolean(b.watched_only),
        ...(b.material_id ? { strategy: "single", active_material_id: b.material_id } : {}),
      });
      retrieved = (found.evidence as any[])
        .filter((e) => !b.watched_only || found.video_learning.some((l: any) => l.source_id === e.id && l.state === "WATCHED"))
        .map((e) => e.id);
      if (b.watched_only) eligible = new Set(retrieved);
    } catch (e) {
      if (b.watched_only) throw e; // without the search nothing is known to be watched
    }
    if (b.watched_only && !eligible?.size) throw new ApiError("VALIDATION_ERROR", NOT_WATCHED);
    const pool = await loadPool(
      this.knowledge, u, c, { scope: b.scope, material_id: b.material_id, watched_only: b.watched_only }, this.policy, eligible,
    );
    // No topic: every part of the pool is a topic of its own, taken in turn across the materials.
    const plan = general
      ? planQuestions(items, examTopics([], pool))
      : (() => {
          const topic = quizTopic(String(b.topic), pool, retrieved);
          return planQuestions(items, [topic], true, outsideParts(pool, topic.parts));
        })();
    if (!plan.slots.length) throw new ApiError("VALIDATION_ERROR", NOTHING_TO_ASK);
    return { pool, plan };
  }

  /** One question, written while the student waits (no second try: the ai-service already repairs once). */
  async single(u: AuthUser, c: string, b: QuizRequest, budgetSeconds: number) {
    const { pool, plan } = await this.prepare(u, c, { ...b, count: 1 });
    const result = await runPlan(plan, {
      generator: this.generator, user: u, course: c, scope: b.scope, styleHint: b.styleHint ?? null,
      budgetSeconds, guard: new RepeatGuard(), maxTries: 1, purpose: "PRACTICE",
    });
    const made = result.produced[0];
    if (!made) {
      throw quizError(result.tries.map((t) => ({
        slot: t.slot, kind: t.kind, variant: t.variant, code: t.code, reason: t.reason, attempts: t.attempts,
      })));
    }
    const row = await this.prisma.learningQuiz.findFirst({ where: { id: made.quiz_id, userId: u.id, courseId: c } });
    if (!row) throw new ApiError("GENERATION_FAILED", "Soru kaydedilemedi. Yeniden deneyin.");
    return { ...publicQuiz(row), ...(pool.warning ? { source_warning: pool.warning } : {}) };
  }

  /** 2-15 questions: saved as GENERATING and written in the background. One set per course at a time. */
  async startSet(u: AuthUser, c: string, b: QuizRequest, budgetSeconds: number) {
    const running = await this.prisma.generatedExam.count({
      where: { courseId: c, userId: u.id, status: "GENERATING", purpose: "PRACTICE" },
    });
    if (running) throw new ApiError("JOB_ALREADY_RUNNING", SET_RUNNING);
    const { pool, plan } = await this.prepare(u, c, b);
    const topic = String(b.topic ?? "").trim().slice(0, 160) || WHOLE_COURSE;
    const row = await this.prisma.generatedExam.create({
      data: {
        id: randomUUID(),
        courseId: c,
        userId: u.id,
        purpose: "PRACTICE",
        title: topic,
        status: "GENERATING",
        requested: plan.slots.length,
        topics: [topic],
        items: [],
        failures: [],
        note: startNote(plan, pool),
      },
    });
    runInBackground(this.log, row.id, {
      prisma: this.prisma, id: row.id, plan, pool,
      run: {
        generator: this.generator, user: u, course: c, scope: b.scope, styleHint: b.styleHint ?? null,
        budgetSeconds, guard: new RepeatGuard(), purpose: "PRACTICE",
        // Kısa yanıt / boşluk doldurmada kaynakta temellenmeyen sorular reddedilir; eksik kalan soru için
        // yedek parçalarla ikinci kez daha denenir (tek soruda bekleme süresi yüzünden 1 deneme kalır).
        maxTries: SET_MAX_TRIES,
      },
    });
    return row;
  }
}
