/** Short-answer and cloze matching. Pure and deterministic.
 *
 *  Exact normalization first (case, Turkish diacritics, punctuation, spacing). Beyond that, only
 *  safe equivalences: the same words in another order, and a one-letter slip in a long single word.
 *  Anything containing digits or operators is compared exactly: x-y must never match x+y. */
const FOLD: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };

export function normalizeAnswer(text: string): string {
  return String(text ?? "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ışğüöç]/g, (c) => FOLD[c])
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const hasMath = (s: string) => /[\d+*/=<>^%−-]/.test(s);

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

export type MatchMode = "EXACT" | "EQUIVALENT" | "TYPO" | null;

export function matchAnswer(expected: string, response: string): MatchMode {
  const exact = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, "");
  if (exact(expected) === exact(response)) return "EXACT";
  if (hasMath(expected) || hasMath(response)) return null;
  const a = normalizeAnswer(expected);
  const b = normalizeAnswer(response);
  if (!a || !b) return null;
  if (a === b) return "EQUIVALENT";
  const ta = a.split(" ");
  const tb = b.split(" ");
  if (ta.length > 1 && ta.length === tb.length && [...ta].sort().join(" ") === [...tb].sort().join(" "))
    return "EQUIVALENT";
  if (ta.length === 1 && tb.length === 1 && a.length >= 6 && editDistanceAtMostOne(a, b)) return "TYPO";
  return null;
}

const STOP = new Set([
  "icin", "olan", "gibi", "daha", "ile", "veya", "ancak", "ise", "bir", "bu", "su", "ve",
  "that", "this", "with", "from", "have", "which", "their", "there",
]);

/** Key terms of the expected answer (letters only, at least 4 characters), without stop words. */
export function rubricTerms(expected: string): string[] {
  const seen = new Set<string>();
  for (const w of normalizeAnswer(expected).split(" "))
    if (w.length >= 4 && !STOP.has(w)) seen.add(w);
  return [...seen].slice(0, 8);
}

/** Transparent key-term coverage. It is shown to the student; it never decides correctness. */
export function rubricCoverage(terms: string[], response: string) {
  const words = normalizeAnswer(response).split(" ");
  const found: string[] = [];
  const missing: string[] = [];
  for (const t of terms)
    (words.some((w) => w === t || (t.length >= 6 && w.length >= 6 && editDistanceAtMostOne(t, w))) ? found : missing).push(t);
  return { terms, found, missing };
}
