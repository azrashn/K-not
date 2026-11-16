/** Plan for a generated exam: which question kinds, in which order, from which topics.
 *  The mix follows the saved exam style (largest remainder), so the new exam keeps the old exam's shape. */
import type { ExamProfile } from "./exam-style";

export type QuestionKind = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER" | "OPEN";

const KIND_OF_FORMAT: Record<string, QuestionKind> = {
  MULTIPLE_CHOICE: "MULTIPLE_CHOICE",
  TRUE_FALSE: "TRUE_FALSE",
  CALCULATION: "SHORT_ANSWER",
  OPEN: "OPEN",
};
export const EXAM_MAX_QUESTIONS = 20;

export function planExamKinds(profile: ExamProfile, count: number): QuestionKind[] {
  const n = Math.max(1, Math.min(EXAM_MAX_QUESTIONS, Math.floor(count)));
  const total = profile.question_count || 1;
  const entries = Object.entries(profile.formats).map(([format, c]) => {
    const exact = (c / total) * n;
    return { kind: KIND_OF_FORMAT[format], floor: Math.floor(exact), rest: exact - Math.floor(exact), c };
  });
  const merged = new Map<QuestionKind, { floor: number; rest: number }>();
  for (const e of entries) {
    if (!e.c) continue;
    const cur = merged.get(e.kind) ?? { floor: 0, rest: 0 };
    merged.set(e.kind, { floor: cur.floor + e.floor, rest: cur.rest + e.rest });
  }
  const kinds: QuestionKind[] = [];
  for (const [kind, v] of merged) for (let i = 0; i < v.floor; i++) kinds.push(kind);
  const order = [...merged.entries()].sort((a, b) => b[1].rest - a[1].rest);
  for (let i = 0; kinds.length < n; i++) kinds.push(order[i % order.length][0]);
  // Interleave so the exam does not start with ten questions of one kind.
  const byKind = new Map<QuestionKind, number>();
  for (const k of kinds) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  const out: QuestionKind[] = [];
  while (out.length < n)
    for (const [k, left] of byKind) if (left > 0) { out.push(k); byKind.set(k, left - 1); if (out.length >= n) break; }
  return out;
}

/** User topics win; otherwise the style's topic terms. Duplicates and blanks are dropped. */
export function examTopics(userTopics: string[] | undefined, profile: ExamProfile): string[] {
  const source = userTopics?.length ? userTopics : profile.topic_terms;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of source) {
    const topic = String(t).trim().slice(0, 200);
    const key = topic.toLocaleLowerCase("tr");
    if (topic && !seen.has(key)) { seen.add(key); out.push(topic); }
  }
  return out.slice(0, 12);
}
