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

// Turkish writing: dot + exactly three digits groups thousands ("6.250.000"), the comma is the
// decimal mark ("3,5"). A dot not followed by three-digit groups stays a decimal point ("1.5").
const TR_THOUSANDS = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const PLAIN = /^\d+(?:[.,]\d+)?$/;

/** A single number, optionally signed and followed by a unit ("480 km/sa", "6.250.000 TL", "%12").
 *  Null for anything else, so expressions such as x-y or 3-4 never become numbers. */
export function parseNumber(text: string): { value: number; decimals: number } | null {
  const m = /^([+-]?)\s*%?\s*(\d[\d.,]*)\s*([\p{L}/%°²³.\s]*)$/u.exec(String(text ?? "").trim());
  if (!m) return null;
  const sign = m[1];
  const raw = m[2].replace(/[.,]$/, ""); // "480." ends a sentence, it is not a decimal mark
  let normalized: string;
  if (TR_THOUSANDS.test(raw)) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (PLAIN.test(raw)) normalized = raw.replace(",", ".");
  else return null;
  const decimals = normalized.includes(".") ? normalized.split(".")[1].length : 0;
  return { value: Number(sign + normalized), decimals };
}

/** Same number in another spelling: 6250000 = 6.250.000, 3.5 = 3,5. A longer answer that rounds to
 *  a decimal key is accepted ("33,333" for 33,33); an integer key needs the integer. */
function sameNumber(expected: string, response: string): boolean {
  const a = parseNumber(expected), b = parseNumber(response);
  if (!a || !b) return false;
  const tolerance = a.decimals ? 0.5 * 10 ** -a.decimals + 1e-9 : 1e-9 * Math.max(1, Math.abs(a.value));
  return Math.abs(a.value - b.value) <= tolerance;
}

export function matchAnswer(expected: string, response: string): MatchMode {
  const exact = (s: string) => s.trim().toLocaleLowerCase("tr").replace(/\s+/g, "");
  if (exact(expected) === exact(response)) return "EXACT";
  if (sameNumber(expected, response)) return "EQUIVALENT";
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
