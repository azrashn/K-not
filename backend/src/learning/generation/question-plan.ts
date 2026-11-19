/** Question plan: which kind each question is and which source part it is written from.
 *
 *  Questions go to topics in turn. Every part is used once before any part is used a second time, and a part
 *  never carries more questions than its capacity, so two questions of one set do not compete for the same
 *  sentences. When the topics' parts cannot carry the requested number, the plan is smaller and says so. */
import { ApiError } from "../../common/errors";
import { planExamItems, type QuestionKind } from "../exam-plan";
import type { ExamProfile } from "../exam-style";
import type { SourcePart } from "./source-pool";
import type { PlannedTopic } from "./topic-planner";

export type PlanItem = { kind: QuestionKind | "CLOZE"; variant?: "CALCULATION" };
export type PlannedSlot = { slot: number; kind: PlanItem["kind"]; variant?: "CALCULATION"; topic: string; part: SourcePart };
export type QuestionPlan = {
  slots: PlannedSlot[];
  requested: number;
  /** Set when fewer questions are planned than requested. */
  note: string | null;
  /** Topic/part pairs with capacity left after the plan, in the order a retry should use them. */
  spare: { topic: string; part: SourcePart }[];
};

export const QUIZ_COUNT_MIN = 1;
export const QUIZ_COUNT_MAX = 10;
export const QUIZ_KINDS = ["MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE", "SHORT_ANSWER", "OPEN"] as const;
export type QuizKindChoice = (typeof QUIZ_KINDS)[number] | "MIXED";
/** "Karışık": the kinds in turn, starting with the quickest to answer. */
export const MIXED_ORDER: PlanItem["kind"][] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER", "OPEN", "CLOZE"];

/** The quiz's questions: one kind, or the kinds in turn for "MIXED". */
export function quizItems(kind: QuizKindChoice, count: number): PlanItem[] {
  if (!Number.isInteger(count) || count < QUIZ_COUNT_MIN || count > QUIZ_COUNT_MAX)
    throw new ApiError("VALIDATION_ERROR", `Soru sayısı ${QUIZ_COUNT_MIN} ile ${QUIZ_COUNT_MAX} arasında olmalı.`);
  if (kind !== "MIXED" && !QUIZ_KINDS.includes(kind)) throw new ApiError("VALIDATION_ERROR", "Bilinmeyen soru türü.");
  return Array.from({ length: count }, (_, i) => ({ kind: kind === "MIXED" ? MIXED_ORDER[i % MIXED_ORDER.length] : kind }));
}

/** The exam's questions: the selected past exams' mix of kinds (a calculation stays a calculation). */
export function examItems(profile: ExamProfile, count: number): PlanItem[] {
  return planExamItems(profile, count);
}

// A lone year (1995) is a date, not data to compute with: the ai-service rule (quiz_engine._YEAR).
const YEAR = /(?<![\d.,])(?:19|20)\d{2}(?![\d.,])/g;
const hasNumbers = (text: string) => /\d/.test(text.replace(YEAR, " "));

/** "Kaynaklar yaklaşık N soruya yetiyor; M soru istendi." (for a quiz topic: "Bu konu için …"). */
export function capacityNote(planned: number, requested: number, forTopic = false): string | null {
  if (planned >= requested) return null;
  return `${forTopic ? "Bu konu için kaynaklar" : "Kaynaklar"} yaklaşık ${planned} soruya yetiyor; ${requested} soru istendi.`;
}

/**
 * Assigns each item a topic and a part. Round 1 uses only parts not used yet, round 2 a part's second
 * question (capacity 2); within a round topics are tried in turn after the last one used. A calculation
 * prefers a part with a number (the ai-service turns it into a short answer otherwise).
 */
export function planQuestions(items: PlanItem[], topics: PlannedTopic[], forTopic = false): QuestionPlan {
  const used = new Map<string, number>();
  const free = (p: SourcePart, round: number) => (used.get(p.key) ?? 0) < Math.min(round, p.capacity);
  const slots: PlannedSlot[] = [];
  let cursor = 0;

  const pick = (item: PlanItem): { t: number; part: SourcePart } | null => {
    const tries = item.variant === "CALCULATION" ? [(p: SourcePart) => hasNumbers(p.text), () => true] : [() => true];
    for (const fits of tries)
      for (const round of [1, 2])
        for (let i = 0; i < topics.length; i++) {
          const t = (cursor + i) % topics.length;
          const part = topics[t].parts.find((p) => free(p, round) && fits(p));
          if (part) return { t, part };
        }
    return null;
  };

  for (const item of items) {
    const found = pick(item);
    if (!found) break; // nothing left: every later item would fail the same way
    used.set(found.part.key, (used.get(found.part.key) ?? 0) + 1);
    cursor = found.t + 1;
    slots.push({ slot: slots.length, kind: item.kind, ...(item.variant ? { variant: item.variant } : {}), topic: topics[found.t].label, part: found.part });
  }

  const spare: QuestionPlan["spare"] = [];
  const seen = new Set<string>();
  for (const round of [1, 2])
    for (const topic of topics)
      for (const part of topic.parts)
        if (!seen.has(part.key) && free(part, round)) {
          seen.add(part.key);
          spare.push({ topic: topic.label, part });
        }
  return { slots, requested: items.length, note: capacityNote(slots.length, items.length, forTopic), spare };
}
