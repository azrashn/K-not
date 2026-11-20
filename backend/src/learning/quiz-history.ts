/** Practice history per course: which generated questions were answered, and with what outcome.
 *  Pure functions; the service only feeds them rows. The latest attempt decides the outcome, so a
 *  repeated answer never inflates the history (the same rule as the practice history page). */
export type HistoryAttempt = { outcome: string; score: number | null; createdAt: Date };
export type HistoryRow = {
  id: string;
  kind: string;
  topic: string;
  createdAt: Date;
  attempts: HistoryAttempt[];
  _count?: { attempts: number };
};
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
};

export function quizHistoryItem(row: HistoryRow): QuizHistoryItem {
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
