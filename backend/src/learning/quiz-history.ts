/** Practice history per course: which generated questions were answered, and with what outcome.
 *  Pure functions; the service only feeds them rows. The latest attempt decides the outcome, so a
 *  repeated answer never inflates the history (the same rule as the practice history page).
 *  Each row also says which quiz set or generated exam it belongs to (GeneratedExam.items), so the
 *  screen can show one card per set instead of one line per question. */
import { heading } from "./generation/topic-planner";

export type HistoryAttempt = { outcome: string; score: number | null; createdAt: Date };
export type HistoryRow = {
  id: string;
  kind: string;
  topic: string;
  createdAt: Date;
  attempts: HistoryAttempt[];
  _count?: { attempts: number };
  /** The stored question (question text and source); optional for older callers. */
  data?: any;
};
/** A quiz set (PRACTICE) or generated exam (EXAM) a question belongs to. */
export type HistorySet = { id: string; title: string };
export const QUESTION_PREVIEW_MAX = 160;
export type QuizHistoryItem = {
  id: string;
  kind: string;
  topic: string;
  created_at: Date;
  status: "UNANSWERED" | "ANSWERED";
  attempt_count: number;
  latest_outcome: string | null;
  latest_score: number | null;
  latest_answered_at: Date | null;
  /** The question text, on one line and at most QUESTION_PREVIEW_MAX characters (no answer, no source text). */
  question: string | null;
  /** The source part's section heading ("Veri tipleri"), when it has one: a title for a card without a topic. */
  section: string | null;
  /** The quiz set or generated exam the question belongs to; null for a single question. */
  set_id: string | null;
  set_title: string | null;
};

/** One line of the question for a list: spaces collapsed, cut at a word with "…". */
export function questionPreview(text: unknown): string | null {
  const line = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!line) return null;
  if (line.length <= QUESTION_PREVIEW_MAX) return line;
  const cut = line.slice(0, QUESTION_PREVIEW_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > QUESTION_PREVIEW_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "")}…`;
}

/** quiz id → its set, from the sets' stored question lists. */
export function setsByQuiz(sets: { id: string; title: string; items: unknown }[]): Map<string, HistorySet> {
  const out = new Map<string, HistorySet>();
  for (const s of sets)
    for (const item of Array.isArray(s.items) ? s.items : []) {
      const id = (item as any)?.quiz_id;
      if (typeof id === "string" && !out.has(id)) out.set(id, { id: s.id, title: s.title });
    }
  return out;
}

export function quizHistoryItem(row: HistoryRow, set: HistorySet | null = null): QuizHistoryItem {
  // `attempts` is ordered newest first by the query; take the latest one explicitly anyway.
  const latest = [...row.attempts].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  const attemptCount = row._count?.attempts ?? row.attempts.length;
  return {
    id: row.id,
    kind: row.kind,
    topic: row.topic,
    created_at: row.createdAt,
    status: latest ? "ANSWERED" : "UNANSWERED",
    attempt_count: attemptCount,
    latest_outcome: latest?.outcome ?? null,
    latest_score: latest?.score ?? null,
    latest_answered_at: latest?.createdAt ?? null,
    question: questionPreview(row.data?.question),
    section: typeof row.data?.source?.text === "string" ? heading(row.data.source.text, row.data.source.title) : null,
    set_id: set?.id ?? null,
    set_title: set?.title ?? null,
  };
}

export function summarizeQuizHistory(items: QuizHistoryItem[]) {
  const answered = items.filter((i) => i.status === "ANSWERED");
  return {
    total: items.length,
    answered: answered.length,
    unanswered: items.length - answered.length,
    correct: answered.filter((i) => i.latest_outcome === "CORRECT").length,
  };
}
