/** Past-exam style profile. Pure and deterministic: no model call, so the same exam always gives
 *  the same profile. Only the derived profile is stored; the exam text is discarded after parsing.
 *  Question numbering is required, so an unnumbered file is refused rather than guessed. */
export const EXAM_TEXT_MAX = 20000;
export const EXAM_QUESTIONS_MAX = 60;

export type ExamFormat = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "CALCULATION" | "OPEN";
export type ExamProfile = {
  question_count: number;
  formats: Record<ExamFormat, number>;
  calculation_share: number;
  average_stem_chars: number;
  sample_stems: string[];
  topic_terms: string[];
};

const QUESTION_START = /^\s*(\d{1,2})[.)]\s+(.+)$/;
const OPTION_LINE = /^\s*[A-Ea-e][.)]\s+\S/;
const STOP = new Set([
  "aşağıdaki", "aşağıda", "verilen", "olarak", "hangisi", "hangileri", "nedir", "bulunuz",
  "hesaplayınız", "hesaplayın", "açıklayınız", "açıklayın", "şıklardan", "şıklar", "doğru", "yanlış",
  "olan", "olanı", "için", "ile", "gibi", "daha", "içinde", "bunların", "değildir", "karşılık",
  "following", "which", "calculate", "explain", "answer", "question", "true", "false",
]);

function parseQuestions(text: string): { stem: string; options: number; body: string }[] {
  const questions: { stem: string; options: number; body: string }[] = [];
  let current: { stem: string; options: number; body: string } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const start = raw.match(QUESTION_START);
    if (start) {
      current = { stem: start[2].trim(), options: 0, body: start[2] };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    if (OPTION_LINE.test(raw)) current.options += 1;
    else if (raw.trim()) current.body += " " + raw.trim();
  }
  return questions.slice(0, EXAM_QUESTIONS_MAX);
}

function formatOf(q: { options: number; body: string }): ExamFormat {
  if (q.options >= 3) return "MULTIPLE_CHOICE";
  if (/\b(doğru|yanlış|true|false)\b/i.test(q.body)) return "TRUE_FALSE";
  if (/(hesapla|bulunuz|bulun|hesaplay|kaç|calculate|compute)/i.test(q.body)) return "CALCULATION";
  return "OPEN";
}

export function buildExamProfile(text: string): ExamProfile {
  const clean = String(text || "").slice(0, EXAM_TEXT_MAX);
  const questions = parseQuestions(clean);
  if (!questions.length) {
    throw new Error("NO_NUMBERED_QUESTIONS");
  }
  const formats: Record<ExamFormat, number> = { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, OPEN: 0 };
  const counts = new Map<string, number>();
  let stemChars = 0;
  for (const q of questions) {
    formats[formatOf(q)] += 1;
    stemChars += q.stem.length;
    for (const word of q.body.toLocaleLowerCase("tr").match(/\p{L}{5,}/gu) ?? []) {
      if (!STOP.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const topic_terms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([word]) => word);
  return {
    question_count: questions.length,
    formats,
    calculation_share: Number((formats.CALCULATION / questions.length).toFixed(2)),
    average_stem_chars: Math.round(stemChars / questions.length),
    sample_stems: questions.slice(0, 2).map((q) => q.stem.slice(0, 160)),
    topic_terms,
  };
}

/** At most this many past exams are combined into one new exam. */
export const EXAM_STYLES_MAX = 5;
/** Topic terms kept from several exams (examTopics takes at most 12 anyway). */
export const MERGED_TERMS_MAX = 12;
/** Sample stems are shortened to this when several exams are combined, so each exam keeps one. */
export const MERGED_STEM_CHARS = 120;
export const EXAM_HINT_MAX = 1200;
const HINT_GUARD = "Olgular ve doğru cevap yalnızca verilen kaynak alıntısından gelsin.";
const FORMATS: ExamFormat[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "CALCULATION", "OPEN"];

/** Several saved profiles as one. `term_exams` tells in how many of the exams each topic term
 *  (lower-cased) appears; groundTopics uses it to keep terms shared by the exams first. */
export type MergedExamProfile = ExamProfile & { exam_count: number; term_exams: Record<string, number> };

const termKey = (t: string) => String(t).trim().toLocaleLowerCase("tr");

/**
 * Combines past-exam profiles. Pure and deterministic.
 * - formats are summed, so the kind mix is weighted by each exam's question count;
 * - average stem length is weighted by question count;
 * - topic terms are ordered by how many exams contain them, then by their rank inside those exams;
 * - sample stems are taken in turn, so every exam contributes at least one.
 * A single profile comes back unchanged (plus exam_count and term_exams).
 */
export function mergeExamProfiles(profiles: ExamProfile[]): MergedExamProfile {
  if (!profiles.length) throw new Error("NO_PROFILES");
  const termExams = (list: ExamProfile[]) => {
    const out: Record<string, number> = {};
    for (const p of list)
      for (const key of new Set((p.topic_terms ?? []).map(termKey).filter(Boolean))) out[key] = (out[key] ?? 0) + 1;
    return out;
  };
  if (profiles.length === 1) return { ...profiles[0], exam_count: 1, term_exams: termExams(profiles) };

  const formats: Record<ExamFormat, number> = { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, OPEN: 0 };
  let questions = 0;
  let stemChars = 0;
  for (const p of profiles) {
    for (const f of FORMATS) formats[f] += p.formats?.[f] ?? 0;
    questions += p.question_count ?? 0;
    stemChars += (p.average_stem_chars ?? 0) * (p.question_count ?? 0);
  }

  const term_exams = termExams(profiles);
  const terms = new Map<string, { term: string; score: number }>();
  for (const p of profiles) {
    const seen = new Set<string>();
    (p.topic_terms ?? []).forEach((term, i) => {
      const key = termKey(term);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const cur = terms.get(key) ?? { term: String(term).trim(), score: 0 };
      cur.score += Math.max(1, 8 - i); // earlier in an exam's list = more frequent in that exam
      terms.set(key, cur);
    });
  }
  const topic_terms = [...terms.entries()]
    .sort((a, b) => term_exams[b[0]] - term_exams[a[0]] || b[1].score - a[1].score || a[0].localeCompare(b[0], "tr"))
    .slice(0, MERGED_TERMS_MAX)
    .map(([, v]) => v.term);

  const sample_stems: string[] = [];
  const rounds = Math.max(...profiles.map((p) => p.sample_stems?.length ?? 0));
  for (let r = 0; r < rounds; r++)
    for (const p of profiles) {
      const stem = p.sample_stems?.[r]?.trim().slice(0, MERGED_STEM_CHARS);
      if (stem && !sample_stems.includes(stem)) sample_stems.push(stem);
    }

  return {
    question_count: questions,
    formats,
    calculation_share: questions ? Number((formats.CALCULATION / questions).toFixed(2)) : 0,
    average_stem_chars: questions ? Math.round(stemChars / questions) : 0,
    sample_stems,
    topic_terms,
    exam_count: profiles.length,
    term_exams,
  };
}

/** Server-built guidance for the question writer. It shapes phrasing and format only; facts still
 *  come from the cited course source. Bounded so a large exam cannot dominate the prompt: sample
 *  stems are dropped from the end until it fits, and the source rule at the end is never cut. */
export function examStyleHint(profile: ExamProfile & { exam_count?: number }): string {
  const f = profile.formats;
  const exams = profile.exam_count ?? 1;
  const terms = profile.topic_terms ?? [];
  const stems = profile.sample_stems ?? [];
  const fixed = [
    exams > 1
      ? `Sınav stili (yalnız üslup ve biçim için): ${exams} geçmiş sınav, toplam ${profile.question_count} soru;`
      : `Sınav stili (yalnız üslup ve biçim için): ${profile.question_count} soru;`,
    `çoktan seçmeli ${f.MULTIPLE_CHOICE}, doğru/yanlış ${f.TRUE_FALSE}, hesaplama ${f.CALCULATION}, açık uçlu ${f.OPEN};`,
    `ortalama soru uzunluğu yaklaşık ${profile.average_stem_chars} karakter.`,
    terms.length ? `Sık geçen terimler: ${terms.join(", ")}.` : "",
  ].filter(Boolean);
  for (let k = stems.length; k >= 0; k--) {
    const sample = k ? `Örnek soru kalıpları: ${stems.slice(0, k).map((s) => `“${s}”`).join(" ")}.` : "";
    const hint = [...fixed, sample, HINT_GUARD].filter(Boolean).join(" ");
    if (hint.length <= EXAM_HINT_MAX) return hint;
  }
  return fixed.join(" ").slice(0, EXAM_HINT_MAX - HINT_GUARD.length - 1) + " " + HINT_GUARD;
}
