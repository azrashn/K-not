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

/** Server-built guidance for the question writer. It shapes phrasing and format only; facts still
 *  come from the cited course source. Bounded so a large exam cannot dominate the prompt. */
export function examStyleHint(profile: ExamProfile): string {
  const f = profile.formats;
  const parts = [
    `Sınav stili (yalnız üslup ve biçim için): ${profile.question_count} soru;`,
    `çoktan seçmeli ${f.MULTIPLE_CHOICE}, doğru/yanlış ${f.TRUE_FALSE}, hesaplama ${f.CALCULATION}, açık uçlu ${f.OPEN};`,
    `ortalama soru uzunluğu yaklaşık ${profile.average_stem_chars} karakter.`,
    profile.topic_terms.length ? `Sık geçen terimler: ${profile.topic_terms.join(", ")}.` : "",
    profile.sample_stems.length ? `Örnek soru kalıpları: ${profile.sample_stems.map((s) => `“${s}”`).join(" ")}.` : "",
    "Olgular ve doğru cevap yalnızca verilen kaynak alıntısından gelsin.",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 1200);
}
