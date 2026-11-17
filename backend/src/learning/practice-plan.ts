/** Pure planning and grading for practice sets (5–25 questions answered together).
 *  No I/O here: the service supplies sources and stores results; these functions decide the shape. */

export const PRACTICE_MIN = 5;
export const PRACTICE_MAX = 25;
export const PRACTICE_DEFAULT = 10;

export type Difficulty = "easy" | "medium" | "hard";
export type Focus = "definition" | "relation" | "difference" | "application" | "scenario" | "code_output";
export type PracticeKind = "MULTIPLE_CHOICE" | "TRUE_FALSE";
export type Slot = { index: number; topic: string; kind: PracticeKind; difficulty: Difficulty; focus: Focus };

// Easy/medium/hard in a 3:4:3 mix, spread through the set so difficulty never comes in one block.
const DIFFICULTY_CYCLE: Difficulty[] = ["easy", "medium", "hard", "medium", "easy", "hard", "medium", "hard", "easy", "medium"];
const FOCUS_BY_DIFFICULTY: Record<Difficulty, Focus[]> = {
  easy: ["definition"],
  medium: ["relation", "difference"],
  hard: ["application", "scenario"],
};

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return PRACTICE_DEFAULT;
  return Math.min(PRACTICE_MAX, Math.max(PRACTICE_MIN, Math.floor(count)));
}

/** One slot per question. Topics rotate, so every topic gets questions of each difficulty; within a
 *  topic the focus rotates too, so one topic is measured from several angles, not re-asked. */
export function planPractice(count: number, topics: string[], hasCode: boolean): Slot[] {
  if (!topics.length) throw new Error("planPractice needs at least one topic");
  const n = clampCount(count);
  const seen = new Map<string, number>();
  const slots: Slot[] = [];
  for (let i = 0; i < n; i++) {
    const topic = topics[i % topics.length];
    const difficulty = DIFFICULTY_CYCLE[i % DIFFICULTY_CYCLE.length];
    const focuses: Focus[] = difficulty === "hard" && hasCode
      ? [...FOCUS_BY_DIFFICULTY.hard, "code_output"]
      : FOCUS_BY_DIFFICULTY[difficulty];
    const key = `${topic}\u0000${difficulty}`;
    const turn = seen.get(key) ?? 0;
    seen.set(key, turn + 1);
    const focus = focuses[turn % focuses.length];
    // True/false only for plain definitions: a statement about a term is the one place it reads naturally.
    const kind: PracticeKind = difficulty === "easy" && focus === "definition" && i % 2 === 0 ? "TRUE_FALSE" : "MULTIPLE_CHOICE";
    slots.push({ index: i + 1, topic, kind, difficulty, focus });
  }
  return slots;
}

const CODE_LINE = /(\bclass\b|\bpublic\b|\bvoid\b|\breturn\b|\bfor\s*\(|\bif\s*\(|\{|\}|;\s*$|==|=>)/gm;
/** Same conservative rule as the AI service: at least three code markers in the sources. */
export function hasCodeMarkers(text: string): boolean {
  return (text.match(CODE_LINE) ?? []).length >= 3;
}

const STOP = new Set(["ve", "ile", "bir", "bu", "için", "olan", "olarak", "gibi", "the", "and", "of", "is", "are", "a", "an", "to", "in", "ne", "nedir", "hangi"]);
function words(text: string): Set<string> {
  const cleaned = text.toLocaleLowerCase("tr").normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new Set(cleaned.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** A question repeats an earlier one when most of its content words are shared (order and
 *  punctuation do not matter). Used to refuse near-copies inside one set. */
export function isDuplicateStem(stem: string, existing: string[]): boolean {
  const mine = words(stem);
  if (!mine.size) return false;
  return existing.some((other) => {
    const theirs = words(other);
    if (!theirs.size) return false;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    const smaller = Math.min(mine.size, theirs.size);
    return shared / smaller >= 0.7 || shared / (mine.size + theirs.size - shared) >= 0.5;
  });
}

export type GradedItem = {
  topic: string;
  difficulty: string | null;
  focus: string | null;
  answered: boolean;
  correct: boolean;
};
export type Stat = { key: string; total: number; correct: number; wrong: number; blank: number; percent: number };
export type PracticeSummary = {
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  blank: number;
  percent: number;
  by_topic: Stat[];
  by_difficulty: Stat[];
  by_focus: Stat[];
};

function stats(items: GradedItem[], keyOf: (i: GradedItem) => string): Stat[] {
  const groups = new Map<string, GradedItem[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups].map(([key, list]) => {
    const correct = list.filter((i) => i.answered && i.correct).length;
    const blank = list.filter((i) => !i.answered).length;
    return {
      key,
      total: list.length,
      correct,
      wrong: list.length - correct - blank,
      blank,
      percent: list.length ? Math.round((correct * 100) / list.length) : 0,
    };
  });
}

/** Totals and breakdowns. Blank questions count as questions asked and not answered; they are never
 *  silently dropped from the percentage. */
export function summarizePractice(items: GradedItem[]): PracticeSummary {
  const total = items.length;
  const correct = items.filter((i) => i.answered && i.correct).length;
  const blank = items.filter((i) => !i.answered).length;
  return {
    total,
    answered: total - blank,
    correct,
    wrong: total - correct - blank,
    blank,
    percent: total ? Math.round((correct * 100) / total) : 0,
    by_topic: stats(items, (i) => i.topic),
    by_difficulty: stats(items, (i) => i.difficulty ?? "unknown"),
    by_focus: stats(items, (i) => i.focus ?? "unknown"),
  };
}
