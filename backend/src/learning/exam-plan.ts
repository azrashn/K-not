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

export type ExamItem = { kind: QuestionKind; variant?: "CALCULATION" };

/** v2 plan: the same mix as planExamKinds, but a calculation stays a calculation (SHORT_ANSWER with
 *  variant CALCULATION) so the engine recomputes its answer. SHORT_ANSWER only comes from CALCULATION. */
export function planExamItems(profile: ExamProfile, count: number): ExamItem[] {
  return planExamKinds(profile, count).map((kind) =>
    kind === "SHORT_ANSWER" ? { kind, variant: "CALCULATION" } : { kind },
  );
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

// groundTopics and commonReason: ported by hand from origin/feature/quiz-quality-overhaul (Fatih).
type SourceText = { title?: string; text: string };
const lower = (s: string) => s.toLocaleLowerCase("tr");

/** A heading worth asking about: the first line of a slide/section, short, mostly letters. */
function heading(text: string): string | null {
  const line = (text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "").replace(/[\s:;,.–-]+$/, "");
  if (line.length < 4 || line.length > 80) return null;
  const letters = [...line].filter((ch) => /\p{L}/u.test(ch)).length;
  if (letters / line.length < 0.6 || line.split(/\s+/).length > 10) return null;
  if (/^(chapter|bölüm|ünite|unit|lecture|ders)\s*\d+$/i.test(line)) return null;
  return line;
}

/**
 * Topics the course sources can actually answer. Terms from the past exam are kept only when they occur in
 * the sources (most frequent first); headings of the sources fill the rest, so a past exam from another
 * wording or language still yields questions. User-written topics are never filtered.
 */
export function groundTopics(
  candidates: string[],
  sources: SourceText[],
  want: number,
): { topics: string[]; dropped: string[] } {
  const text = lower(sources.map((s) => s.text).join("\n"));
  const count = (term: string) => {
    const t = lower(term);
    let n = 0;
    for (let i = text.indexOf(t); i >= 0 && n < 1000; i = text.indexOf(t, i + t.length)) n++;
    return n;
  };
  const scored = candidates.map((t) => ({ t, n: count(t) }));
  const kept = scored.filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.t);
  const dropped = scored.filter((x) => x.n === 0).map((x) => x.t);
  const out = [...kept];
  const seen = new Set(out.map(lower));
  const target = Math.min(12, Math.max(want, 6));
  if (out.length < target) {
    // Round-robin over materials so one long document does not provide every topic.
    const byTitle = new Map<string, string[]>();
    for (const s of sources) {
      const h = heading(s.text);
      if (!h) continue;
      const list = byTitle.get(s.title ?? "") ?? [];
      list.push(h);
      byTitle.set(s.title ?? "", list);
    }
    const lists = [...byTitle.values()];
    for (let i = 0; out.length < target && lists.some((l) => i < l.length); i++)
      for (const l of lists) {
        const h = l[i];
        if (h && !seen.has(lower(h)) && out.length < target) { seen.add(lower(h)); out.push(h); }
      }
  }
  return { topics: out.slice(0, 12), dropped };
}

/** "En sık neden" for a failed run: the reason most attempts ended with. */
export function commonReason(failures: { reason: string }[]): { reason: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const f of failures) counts.set(f.reason, (counts.get(f.reason) ?? 0) + 1);
  let best: { reason: string; count: number } | null = null;
  for (const [reason, n] of counts) if (!best || n > best.count) best = { reason, count: n };
  return best;
}
