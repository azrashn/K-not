import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthUser } from "../common/request-context";
import { KnowledgeService } from "../knowledge/knowledge.service";
import { AiServiceClient } from "../ai/ai-client";
import { findQuizSources, QuizScopeRequest } from "./quiz-sources";
import { publicQuiz } from "./quiz-public";
import { failure, QuizFailure, V2_PIPELINE } from "./quiz-failures";
import { RepeatGuard } from "./generation/repeat-guard";

export type QuizItemRequest = { kind: string; variant?: "CALCULATION" | null };

export type GenerateRequest = QuizScopeRequest & {
  items: QuizItemRequest[];
  styleHint?: string | null;
  avoidStems?: string[];
  /** Model time the ai-service may spend on this request. */
  budgetSeconds: number;
  /** Excerpts chosen beforehand (generation/source-pool): sent as they are, no search. */
  sources?: any[];
  /** Source sentences earlier questions of the same quiz or exam rest on: the ai-service will not number them. */
  avoidQuotes?: string[];
  /** The whole quiz's or exam's repeat guard: a stored question is recorded in it, and a stem or sentence it
   *  already holds is refused (DUPLICATE_STEM / DUPLICATE_QUOTE) before anything is stored. */
  guard?: RepeatGuard;
  /** PRACTICE (default): shown in the quiz history. EXAM: a question of a generated exam. */
  purpose?: "EXAM" | "PRACTICE";
  /** A later try of the same question: the ai-service lets the length and number cues of the options through. */
  relaxed?: boolean;
};

export type GenerateResult = {
  /** Public quizzes in slot order, each with the slot it answers. */
  quizzes: (ReturnType<typeof publicQuiz> & { slot: number })[];
  failures: QuizFailure[];
  /** Plain question stems, for repeat avoidance in later requests. */
  stems: string[];
};

const OPTION_COUNT: Record<string, number> = { MULTIPLE_CHOICE: 4, TRUE_FALSE: 2 };
// The HTTP wait covers the ai-service budget plus retrieval/transport slack.
const HTTP_SLACK_MS = 20_000;

// A letter label before an option: "a) javac", "A) javac", "a. javac", "A - javac", "(a) javac" (the same rule
// as ai-service quiz_checks.strip_option_labels). A "A -" label needs spaces, so "C-dili" stays.
const OPTION_LABEL = /^\s*(?:\(\s*[a-e]\s*\)|[a-e]\s*[).]|[a-e]\s+[-–—:]\s)\s*/i;

/** Options without letter labels, removed only when every option carries one (the ai-service already does
 *  this; an older or other ai-service must not store "a) …, c) …, b) …" after its shuffle). The correct
 *  answer is an index, so it keeps pointing at the same option. */
export function stripOptionLabels(options: unknown[]): unknown[] {
  if (!options.length || !options.every((o) => typeof o === "string" && OPTION_LABEL.test(o) && o.replace(OPTION_LABEL, "").trim()))
    return options;
  return (options as string[]).map((o) => o.replace(OPTION_LABEL, "").trim());
}

/** Server-side recheck of an ai-service v2 question: the ai-service flags are not trusted alone. */
export function validV2Question(q: any, item: QuizItemRequest, sources: any[]): boolean {
  if (!q || typeof q !== "object") return false;
  if (q.quality?.pipeline_version !== V2_PIPELINE || q.quality?.deterministic_validation !== true) return false;
  // A calculation whose sources hold no number is asked as a plain short answer by the ai-service.
  const downgraded = item.variant === "CALCULATION" && q.downgraded_from === "CALCULATION" && (q.variant ?? null) === null;
  if (q.kind !== item.kind || (!downgraded && (q.variant ?? null) !== (item.variant ?? null))) return false;
  if (!Number.isInteger(q.source_index) || q.source_index < 1 || q.source_index > sources.length) return false;
  if (typeof q.quote !== "string" || !q.quote.trim() || !String(sources[q.source_index - 1].text ?? "").includes(q.quote))
    return false;
  if (typeof q.question !== "string" || !q.question.trim() || q.question.length > 3000) return false;
  if (typeof q.expected !== "string" || !Array.isArray(q.options)) return false;
  if (q.options.some((o: any) => typeof o !== "string" || !o.trim() || o.length > 400)) return false;
  const n = OPTION_COUNT[q.kind];
  if (n) {
    if (q.options.length !== n) return false;
    if (new Set(q.options.map((o: string) => o.trim().toLocaleLowerCase("tr"))).size !== n) return false;
    if (!/^\d$/.test(q.expected) || Number(q.expected) >= n) return false;
  } else {
    if (q.options.length) return false;
    if (q.kind === "OPEN" ? q.expected !== "" : !q.expected.trim()) return false;
  }
  if (q.kind === "CLOZE" && q.question.split("_____").length !== 2) return false;
  return true;
}

/** Quiz engine v2 on the backend side: sources → one ai-service request → checked, stored questions.
 *  Used by POST /quizzes (one item) and by generated exams (several items per topic). */
@Injectable()
export class QuizGenerator {
  private readonly log = new Logger(QuizGenerator.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly ai: AiServiceClient,
  ) {}

  async generate(u: AuthUser, c: string, b: GenerateRequest): Promise<GenerateResult> {
    const sources = b.sources?.length ? b.sources : await findQuizSources(this.knowledge, u, c, b);
    const all = (code: string, attempts = 0): GenerateResult => ({
      quizzes: [],
      stems: [],
      failures: b.items.map((it, slot) => failure(slot, it.kind, code, attempts, it.variant)),
    });
    const r = await this.ai.call("POST", "/api/v1/knowledge/quiz", {
      body: {
        topic: b.topic,
        evidence: sources,
        items: b.items.map((it) => (it.variant ? { kind: it.kind, variant: it.variant } : { kind: it.kind })),
        language: "tr",
        budget_seconds: b.budgetSeconds,
        ...(b.relaxed ? { relaxed: true } : {}),
        ...(b.styleHint ? { style_hint: b.styleHint } : {}),
        ...(b.avoidStems?.length ? { avoid_stems: b.avoidStems.slice(-10) } : {}),
        ...(b.avoidQuotes?.length ? { avoid_quotes: b.avoidQuotes.slice(-60) } : {}),
      },
      timeoutMs: b.budgetSeconds * 1000 + HTTP_SLACK_MS,
    });
    let result: GenerateResult;
    if (r.kind === "timeout") result = all("TIMEOUT");
    else if (r.kind === "unreachable") result = all("MODEL_UNREACHABLE");
    else if (r.status === 503) result = all("MODEL_UNREACHABLE");
    else if (r.status === 409 && r.body?.detail?.code === "QUIZ_ENGINE_DISABLED") result = all("ENGINE_DISABLED");
    else if (r.status === 422 && r.body?.detail?.code === "QUIZ_NO_SOURCE") result = all("NO_SOURCE");
    else if (r.status !== 200 || !Array.isArray(r.body?.questions) || !Array.isArray(r.body?.failures))
      result = all("AI_ERROR");
    else result = await this.accept(u, c, b, sources, r.body);
    for (const f of result.failures)
      this.log.warn({ event: "quiz.item_failed", slot: f.slot, kind: f.kind, variant: f.variant, code: f.code, attempts: f.attempts });
    this.log.log({ event: "quiz.generated", requested: b.items.length, produced: result.quizzes.length, failed: result.failures.length });
    return result;
  }

  private async accept(u: AuthUser, c: string, b: GenerateRequest, sources: any[], body: any): Promise<GenerateResult> {
    const quizzes: GenerateResult["quizzes"] = [];
    const stems: string[] = [];
    // Without the set's guard, one for this request: its avoid lists and the questions it stores.
    const guard = b.guard ?? new RepeatGuard({ stems: b.avoidStems, quotes: b.avoidQuotes });
    const failures: QuizFailure[] = [];
    const answered = new Set<number>();
    for (const f of body.failures) {
      const slot = Number(f?.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= b.items.length || answered.has(slot)) continue;
      answered.add(slot);
      const item = b.items[slot];
      failures.push(failure(slot, item.kind, String(f.code ?? "AI_ERROR"), Number(f.attempts) || 0, item.variant));
    }
    for (const raw of body.questions) {
      const slot = Number(raw?.slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= b.items.length || answered.has(slot)) continue;
      answered.add(slot);
      const item = b.items[slot];
      const q = raw?.kind === "MULTIPLE_CHOICE" && Array.isArray(raw.options) ? { ...raw, options: stripOptionLabels(raw.options) } : raw;
      if (!validV2Question(q, item, sources)) {
        failures.push(failure(slot, item.kind, "INVALID_SHAPE", q?.quality?.attempts ?? 0, item.variant));
        continue;
      }
      // Checked before storing, so a repeated question never reaches the student's history.
      // A question the ai-service built from a true statement (constructed_choice) has a template stem on purpose:
      // its content is in the options, so a repeated stem is not a repeated question.
      const repeat = !q.constructed_choice && guard.isRepeat(q.question)
        ? "DUPLICATE_STEM"
        : !b.relaxed && guard.isUsedQuote(q.quote)
          ? "DUPLICATE_QUOTE"
          : null;
      if (repeat) {
        failures.push(failure(slot, item.kind, repeat, q?.quality?.attempts ?? 0, item.variant));
        continue;
      }
      // Recorded before any await: a check that runs meanwhile (another request with the same guard) sees it.
      guard.accept(q.question, q.quote);
      const source = sources[q.source_index - 1];
      await this.knowledge.source(u, c, source.material_id, source.id);
      const { slot: _slot, ...data } = q;
      const row = await this.prisma.learningQuiz.create({
        data: {
          id: randomUUID(),
          userId: u.id,
          courseId: c,
          topic: b.topic,
          kind: item.kind,
          materialId: source.material_id,
          segmentId: source.id,
          version: source.version,
          purpose: b.purpose ?? "PRACTICE",
          data: {
            ...data,
            source,
            scope: b.scope || { mode: b.material_id ? "active" : "course" },
            watched_only: Boolean(b.watched_only),
          },
        },
      });
      quizzes.push({ ...publicQuiz(row), slot });
      stems.push(q.question);
    }
    b.items.forEach((it, slot) => {
      if (!answered.has(slot)) failures.push(failure(slot, it.kind, "MISSING", 0, it.variant));
    });
    quizzes.sort((x, y) => x.slot - y.slot);
    failures.sort((x, y) => x.slot - y.slot);
    return { quizzes, failures, stems };
  }
}
