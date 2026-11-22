/** Runs a question plan through the quiz generator (ai-service quiz engine v2 + backend checks).
 *
 *  One request per source part: that part is the only evidence, so each question is written from the part the
 *  plan gave it. A question that fails is tried again (up to MAX_TRIES requests), with a spare part of the plan when one
 *  is left, otherwise with its own part. The repeat guard spans the whole set: used sentences are never shown
 *  to the model again and a repeated stem is refused before it is stored. The run stops when the model cannot
 *  be reached, or after TIMEOUT_STREAK_LIMIT requests in a row that only timed out. */
import type { AuthUser } from "../../common/request-context";
import { failure, INFRASTRUCTURE_CODES, TIME_CODES } from "../quiz-failures";
import type { GenerateRequest, GenerateResult } from "../quiz-generator";
import type { PlannedSlot, QuestionPlan } from "./question-plan";
import { RepeatGuard } from "./repeat-guard";
import { partEvidence, type SourcePart } from "./source-pool";

/** Model time for one request (one or two questions plus repairs on a CPU model). */
export const REQUEST_BUDGET_SECONDS = 240;
export const TIMEOUT_STREAK_LIMIT = 2;
/** Requests a question may take: the planned one and four retries. The ai-service reads every true/false and
 *  multiple-choice key back against its sentence, so some drafts are refused; the student asked for a number of
 *  questions and should get them, each retry with another part (the plan's spare parts) while one is left. */
export const MAX_TRIES = 5;
/** From this try on the ai-service lets option length and number cues through (the count asked for comes first). */
export const RELAXED_FROM_TRY = 3;

export type Produced = { slot: number; quiz_id: string; kind: string; topic: string };
/** One failed try of one question, kept for the details list. */
export type TryRecord = {
  slot: number; kind: string; variant?: string | null; topic: string; code: string; reason: string;
  /** This request's number for the question (1 or 2), and the model attempts inside it (ai-service repair). */
  try: number; attempts: number;
};
export type Unresolved = { slot: number; kind: string; topic: string; code: string; tries: number };
export type RunState = {
  produced: Produced[];
  tries: TryRecord[];
  stopped: "MODEL" | "TIMEOUTS" | null;
};
export type RunResult = RunState & { planned: number; unresolved: Unresolved[] };

export type RunOptions = {
  generator: { generate(u: AuthUser, c: string, b: GenerateRequest): Promise<GenerateResult> };
  user: AuthUser;
  course: string;
  scope?: any;
  styleHint?: string | null;
  budgetSeconds?: number;
  guard?: RepeatGuard;
  /** Stored with every question: EXAM for an exam, PRACTICE (default) for a quiz. */
  purpose?: "EXAM" | "PRACTICE";
  /** 1: no retry (a single quiz question the student waits for); default MAX_TRIES. */
  maxTries?: number;
  /** Called after every request, e.g. to save progress. */
  onProgress?: (state: RunState) => Promise<unknown> | unknown;
};

type Ask = { topic: string; part: SourcePart; slots: PlannedSlot[] };

/** Slots grouped by part, in the order the parts first appear. */
function byPart(entries: { slot: PlannedSlot; topic: string; part: SourcePart }[]): Ask[] {
  const asks = new Map<string, Ask>();
  for (const e of entries) {
    const ask = asks.get(e.part.key) ?? { topic: e.topic, part: e.part, slots: [] };
    ask.slots.push(e.slot);
    asks.set(e.part.key, ask);
  }
  return [...asks.values()];
}

export async function runPlan(plan: QuestionPlan, o: RunOptions): Promise<RunResult> {
  const guard = o.guard ?? new RepeatGuard();
  const state: RunState = { produced: [], tries: [], stopped: null };
  const last = new Map<number, { code: string; tries: number; topic: string }>();
  let timeoutStreak = 0;

  /** One request; returns the slots that failed and may be tried again. */
  const ask = async ({ topic, part, slots }: Ask, tryNo: number): Promise<PlannedSlot[]> => {
    let result: GenerateResult;
    try {
      result = await o.generator.generate(o.user, o.course, {
        topic,
        scope: o.scope,
        items: slots.map((s) => ({ kind: s.kind, variant: s.variant ?? null })),
        styleHint: o.styleHint ?? null,
        avoidStems: guard.avoidStems(),
        // From the relaxed tries on a sentence may carry a second question (with another stem): the part's own
        // sentences are what is left once the first questions have used them.
        avoidQuotes: tryNo >= RELAXED_FROM_TRY ? [] : guard.avoidQuotes(),
        budgetSeconds: o.budgetSeconds ?? REQUEST_BUDGET_SECONDS,
        sources: [partEvidence(part)],
        guard,
        purpose: o.purpose,
        relaxed: tryNo >= RELAXED_FROM_TRY,
      });
    } catch (e: any) {
      if (e?.code !== "VALIDATION_ERROR") throw e;
      result = { quizzes: [], stems: [], failures: slots.map((s, i) => failure(i, s.kind, "NO_SOURCE", 0, s.variant)) };
    }
    for (const q of result.quizzes) {
      const s = slots[q.slot];
      state.produced.push({ slot: s.slot, quiz_id: q.id, kind: s.kind, topic });
      last.delete(s.slot);
    }
    const failed: PlannedSlot[] = [];
    for (const f of result.failures) {
      const s = slots[f.slot];
      if (!s) continue;
      state.tries.push({ slot: s.slot, kind: s.kind, variant: s.variant ?? null, topic, code: f.code, reason: f.reason, try: tryNo, attempts: f.attempts });
      last.set(s.slot, { code: f.code, tries: tryNo, topic });
      if (!INFRASTRUCTURE_CODES.has(f.code)) failed.push(s);
    }
    const codes = result.failures.map((f) => f.code);
    if (!result.quizzes.length && codes.some((c) => INFRASTRUCTURE_CODES.has(c))) state.stopped = "MODEL";
    else if (!result.quizzes.length && codes.length && codes.every((c) => TIME_CODES.has(c))) {
      if (++timeoutStreak >= TIMEOUT_STREAK_LIMIT) state.stopped = "TIMEOUTS";
    } else timeoutStreak = 0;
    await o.onProgress?.(state);
    return failed;
  };

  // Try 1: every slot with the part the plan gave it.
  const failed: PlannedSlot[] = [];
  for (const a of byPart(plan.slots.map((slot) => ({ slot, topic: slot.topic, part: slot.part })))) {
    if (state.stopped) break;
    failed.push(...(await ask(a, 1)));
  }

  // Tries 2..MAX_TRIES: a spare part while one is left (each spare once), else the question's own part.
  const spare = [...plan.spare];
  let pending = failed;
  for (let tryNo = 2; tryNo <= (o.maxTries ?? MAX_TRIES) && pending.length && !state.stopped; tryNo++) {
    const retry = pending.map((slot) => {
      const s = spare.shift();
      return s ? { slot, topic: s.topic, part: s.part } : { slot, topic: slot.topic, part: slot.part };
    });
    const again: PlannedSlot[] = [];
    for (const a of byPart(retry)) {
      if (state.stopped) break;
      again.push(...(await ask(a, tryNo)));
    }
    pending = again;
  }

  state.produced.sort((a, b) => a.slot - b.slot);
  const made = new Set(state.produced.map((p) => p.slot));
  const unasked = state.stopped === "MODEL" ? "MODEL_UNREACHABLE" : "TIMEOUT";
  const unresolved = plan.slots
    .filter((s) => !made.has(s.slot))
    .map((s) => {
      const l = last.get(s.slot);
      return { slot: s.slot, kind: s.kind, topic: l?.topic ?? s.topic, code: l?.code ?? unasked, tries: l?.tries ?? 0 };
    });
  return { ...state, planned: plan.slots.length, unresolved };
}
