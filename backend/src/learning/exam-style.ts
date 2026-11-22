/** Past-exam style profile. Pure and deterministic: no model call, so the same exam always gives
 *  the same profile. Only the derived profile is stored; the exam text is discarded after parsing.
 *  Question numbering is required, so an unnumbered file is refused rather than guessed. */
export const EXAM_TEXT_MAX = 20000;
export const EXAM_QUESTIONS_MAX = 60;

type CoreFormat = "MULTIPLE_CHOICE" | "TRUE_FALSE" | "CALCULATION" | "OPEN";
type LaterFormat = "SHORT_ANSWER" | "CLOZE";
export type ExamFormat = CoreFormat | LaterFormat;
/** A profile saved before short answers and blanks were told apart has no SHORT_ANSWER / CLOZE keys. */
export type ExamFormats = Record<CoreFormat, number> & Partial<Record<LaterFormat, number>>;
export type ExamProfile = {
  question_count: number;
  formats: ExamFormats;
  calculation_share: number;
  average_stem_chars: number;
  sample_stems: string[];
  topic_terms: string[];
};

const QUESTION_START = /^\s*(\d{1,2})(?:[.)]|\.[a-z](?=\s))\s+(.+)$/;
const OPTION_LINE = /^\s*[A-Ea-e][.)]\s+\S/;
/** Words of the question and of the exam paper, never a subject. Includes the list from
 *  origin/feature/quiz-quality-overhaul (Fatih): header and scoring words. */
export const TOPIC_STOP = new Set([
  "aşağıdaki", "aşağıda", "verilen", "olarak", "hangisi", "hangileri", "nedir", "bulunuz",
  "hesaplayınız", "hesaplayın", "açıklayınız", "açıklayın", "şıklardan", "şıklar", "doğru", "yanlış",
  "olan", "olanı", "için", "ile", "gibi", "daha", "içinde", "bunların", "değildir", "karşılık",
  "following", "which", "calculate", "explain", "answer", "question", "true", "false",
  // Exam boilerplate (Fatih): header lines and scoring, never a subject.
  "puan", "puanı", "puanlık", "soru", "sorular", "sorusu", "soruları", "cevap", "cevaplayınız", "cevabı",
  "adı", "soyadı", "soyad", "tarih", "numara", "numarası", "öğrenci", "sınav", "sınavı", "süre", "dakika",
  "points", "point", "marks", "name", "date", "student", "exam", "midterm", "final", "total", "score",
  "page", "please", "write", "each", "both", "part", "show", "your", "work", "minutes",
  // Question words and instructions.
  "hangi", "hangisidir", "hangileridir", "nelerdir", "neler", "nasıl", "neden", "niçin", "nedeni",
  "nedenini", "nedenleri", "kaçtır", "kısaca", "kısaltması", "yazınız", "yazın", "yazıp", "veriniz",
  "belirtiniz", "belirtin", "tanımlayınız", "tanımlayın", "karşılaştırınız", "listeleyiniz", "sıralayınız",
  "gösteriniz", "çiziniz", "doldurunuz", "işaretleyiniz", "eşleştiriniz", "tamamlayınız", "örnek",
  "örnekler", "örneği", "örnekle", "örnekleyiniz", "açıklama", "açıklaması", "midir", "mıdır", "mudur",
  "müdür", "değil", "şekilde", "durumunda", "arasındaki", "farkı", "farkları", "aşağıdakilerden",
  "yukarıdaki", "boşluk", "boşluğa", "boşlukları", "kullanarak", "olduğunu", "olduğu", "puanlar", "toplam",
  "tarihi", "cevaplar", "cevapları", "describe", "define", "compare", "briefly", "below",
]);
/** "Ability" verb forms (çalışabilmesinin, yapılabilmesi) describe an action, never a topic. */
const VERB_FORM = /[ae]bilme/;

/** Inflection suffixes for comparing roots (bellek / belleği / belleğin). Longest first. */
const SUFFIXES = [
  "lerinin", "larının", "lerini", "larını", "lerine", "larına", "lerden", "lardan", "lerin", "ların",
  "lerde", "larda", "leri", "ları", "sinin", "sının", "sunun", "sünün", "inin", "ının", "unun", "ünün",
  "sini", "sını", "sunu", "sünü", "sine", "sına", "suna", "süne", "ler", "lar", "nin", "nın", "nun",
  "nün", "den", "dan", "ten", "tan", "yla", "yle", "de", "da", "te", "ta", "in", "ın", "un", "ün",
  "si", "sı", "su", "sü", "yi", "yı", "yu", "yü", "ye", "ya", "la", "le", "i", "ı", "u", "ü", "e", "a",
].sort((a, b) => b.length - a.length);
/** A stem shorter than this is not compared (dizi / dizin must stay apart). */
const ROOT_MIN = 4;
const SOFTENED: Record<string, string> = { ğ: "k", c: "ç", b: "p", d: "t" };

const lowerTr = (s: string) => String(s).trim().toLocaleLowerCase("tr");

/** The word and every stem it could have under one inflection suffix, with the final consonant
 *  hardened (belleğ → bellek). Two words share a root when these sets meet. */
function rootForms(word: string): Set<string> {
  const w = lowerTr(word);
  const forms = new Set([w]);
  for (const suffix of SUFFIXES) {
    if (!w.endsWith(suffix)) continue;
    const stem = w.slice(0, -suffix.length);
    if (stem.length < ROOT_MIN) continue;
    forms.add(stem);
    const last = stem.at(-1)!;
    if (SOFTENED[last]) forms.add(stem.slice(0, -1) + SOFTENED[last]);
  }
  return forms;
}

/** True when two terms are inflections of one word: bellek / belleği, nesne / nesneler. */
export function sameRoot(a: string, b: string): boolean {
  const fa = rootForms(a);
  for (const f of rootForms(b)) if (fa.has(f)) return true;
  return false;
}

/** A term that can be a topic: not a question/exam word, not an "ability" verb form. */
export function isTopicTerm(term: string): boolean {
  const w = lowerTr(term);
  return Boolean(w) && !TOPIC_STOP.has(w) && !VERB_FORM.test(w);
}

/** Terms in their order without question/exam words, one per root: the first (most frequent) form wins.
 *  Also cleans profiles saved before these rules existed. */
export function cleanTopicTerms(terms: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of terms ?? []) {
    const term = String(raw).trim();
    if (!isTopicTerm(term) || out.some((t) => sameRoot(t, term))) continue;
    out.push(term);
  }
  return out;
}

/** Counts of words grouped by root: the sum, under the most frequent form (then the shorter one). */
function groupByRoot(counts: Map<string, number>): [string, number][] {
  const groups: { forms: [string, number][]; total: number }[] = [];
  for (const [word, n] of counts) {
    const group = groups.find((g) => g.forms.some(([f]) => sameRoot(f, word)));
    if (group) {
      group.forms.push([word, n]);
      group.total += n;
    } else groups.push({ forms: [[word, n]], total: n });
  }
  return groups.map((g) => {
    const [best] = [...g.forms].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]));
    return [best[0], g.total] as [string, number];
  });
}

type ParsedQuestion = { stem: string; options: number; optionTexts: string[]; body: string };

function parseQuestions(text: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  let current: ParsedQuestion | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const start = raw.match(QUESTION_START);
    if (start) {
      current = { stem: start[2].trim(), options: 0, optionTexts: [], body: start[2] };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    // One option per line, or all of them on one line ("a) Microsoft b) Sun Microsystems c) Apple d) IBM").
    if (OPTION_LINE.test(raw)) {
      const items = labelledItems(raw);
      const texts = items.length ? items : [raw.replace(/^\s*[A-Ea-e][.)]\s+/, "").trim()];
      current.options += texts.length;
      current.optionTexts.push(...texts);
    } else if (raw.trim()) current.body += " " + raw.trim();
  }
  return questions.slice(0, EXAM_QUESTIONS_MAX);
}

/** The texts after the labels a, b, c, … of a line, in order. Labels count only as an ordered run starting at a,
 *  so "A) " elsewhere in a sentence is not one. */
export function labelledItems(text: string): string[] {
  const marks: { at: number; end: number }[] = [];
  for (const m of text.matchAll(/(?:^|\s)\(?([A-Ea-e])[.)]\s*(?=\S)/g)) {
    if (m[1].toLowerCase() === String.fromCharCode(97 + marks.length))
      marks.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return marks.map((m, i) => text.slice(m.end, marks[i + 1]?.at ?? text.length).trim());
}

/** Options written on the question's own line, as a PDF often has them: "… hangi şirket? a) Microsoft b) Sun
 *  c) Apple d) IBM". */
export function inlineOptionCount(text: string): number {
  return labelledItems(text).length;
}

// A labelled item that is a question or an instruction of its own ("(a) Find all frequent itemsets …",
// "a) Fermanın ilan edilmesinde etkili olan bir gelişmeyi yazınız. (10 Puan)"), not an option: an English
// instruction starts the item, a Turkish one ends it, or it ends in "?" or carries points. A verb inside a
// descriptive option ("Allows a programmer to write a subclass …") does not make it one.
const SUB_QUESTION_START = new RegExp(
  "^(?:find|list|show|explain|describe|compute|calculate|write|justify|state|draw|compare|prove|give|identify|" +
    "determine|discuss|name|define|what|why|how|which|who|when)(?!\\p{L})",
  "iu",
);
const SUB_QUESTION_END = new RegExp(
  "(?<!\\p{L})(?:yazınız|açıklayınız|hesaplayınız|bulunuz|belirtiniz|listeleyiniz|karşılaştırınız|gösteriniz|" +
    "çiziniz|yorumlayınız|veriniz|sayınız)[.:]?\\s*(?:\\([^)]*\\)|\\[[^\\]]*\\])?\\s*$|\\?\\s*$",
  "iu",
);
const POINTS = /\(\s*\d+\s*(?:puan|points?|pts?)\s*\)|\[\s*\d+\s*p\s*\]/i;
const isSubQuestion = (item: string) => SUB_QUESTION_START.test(item.trim()) || SUB_QUESTION_END.test(item.trim()) || POINTS.test(item);
/** Labelled items that are mostly questions or instructions are sub-questions of one written question. */
function isSubQuestionList(items: string[]): boolean {
  return items.length >= 2 && items.filter(isSubQuestion).length * 2 >= items.length;
}

/** "Identify each statement as true or false", "başına doğru ise (D), yanlış ise (Y) yazınız": the labelled lines
 *  below are statements to mark, not options. */
const TF_INSTRUCTION =
  /(?:identify|mark|circle|indicate|decide|state)\b.{0,60}\b(?:true|false)\b|(?:doğru|yanlış)\s+ise\s*\(?[DY]\)?/i;
/** Markers of a true/false item: "T F", "TRUE FALSE", "TRUE/FALSE", "YES NO" (capitals, as printed on the paper),
 *  "true … false", "(D) / (Y)", "doğru / yanlış". A "Yes No" circled in a question that asks for a justification
 *  is not one. */
const TF_CAPS = /(?<![A-Za-z])T\s+F(?![A-Za-z])|(?<![A-Za-z])YES\s+NO(?![A-Za-z])/;
const TF_MARK = new RegExp(
  "\\b(?:true|false)\\b.{0,30}\\b(?:true|false)\\b|(?<!\\p{L})(?:doğru|yanlış)(?!\\p{L}).{0,25}(?<!\\p{L})(?:doğru|yanlış)(?!\\p{L})" +
    "|\\(\\s*[DY]\\s*\\)|\\[\\s*D\\s*\\]\\s*/?\\s*\\[\\s*Y\\s*\\]",
  "isu",
);

/** A blank to fill: "______", "......" or "boşluğu doldurunuz / boşlukları tamamlayınız". */
const BLANK = /_{3,}|\.{4,}|boşlu(?:ğ|k)\w*\s+(?:doldur|tamamla)/i;
/** The paper asks for a short answer: "kısa yanıt", "tek sözcük", "ne denir". "Kısaca açıklayınız" is NOT one:
 *  it asks for an explanation, so it stays an open question. */
const SHORT = /kısa\s+(?:yanıt|cevap)|tek\s+(?:kelime|sözcük)|bir\s+(?:kelime|sözcük)le|ne\s+denir/i;

/** A question that asks what a program prints, with no options: a short answer. */
const PRINTS = /what\s+does\s+(?:this|the)\s+(?:program|code|method)\s+print|ekran\s+çıktısı\s+(?:ne|nedir)|çıktısı\s+nedir/i;
const CALCULATE =
  /(hesapla|bulunuz|bulun|hesaplay|kaç|calculate|compute|find\s+all|show\s+your\s+work|how\s+many)/i;

function formatOf(q: ParsedQuestion): ExamFormat {
  // Statements to mark true or false come first: their (a), (b), (c) labels are not options.
  if (TF_INSTRUCTION.test(q.body)) return "TRUE_FALSE";
  const items = [...q.optionTexts, ...labelledItems(q.body)];
  if (items.length >= 3 && !isSubQuestionList(items)) return "MULTIPLE_CHOICE";
  if (TF_CAPS.test(q.body) || TF_MARK.test(q.body)) return "TRUE_FALSE";
  if (BLANK.test(q.body)) return "CLOZE";
  if (CALCULATE.test(q.body)) return "CALCULATION";
  if (SHORT.test(q.body) || PRINTS.test(q.body)) return "SHORT_ANSWER";
  return "OPEN";
}

export function buildExamProfile(text: string): ExamProfile {
  const clean = String(text || "").slice(0, EXAM_TEXT_MAX);
  const questions = parseQuestions(clean);
  if (!questions.length) {
    throw new Error("NO_NUMBERED_QUESTIONS");
  }
  const formats: Record<ExamFormat, number> = { ...NO_FORMATS };
  const counts = new Map<string, number>();
  let stemChars = 0;
  for (const q of questions) {
    formats[formatOf(q)] += 1;
    stemChars += q.stem.length;
    for (const word of q.body.toLocaleLowerCase("tr").match(/\p{L}{5,}/gu) ?? []) {
      if (isTopicTerm(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const topic_terms = groupByRoot(counts)
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
const FORMATS: ExamFormat[] = ["MULTIPLE_CHOICE", "TRUE_FALSE", "CALCULATION", "SHORT_ANSWER", "CLOZE", "OPEN"];
/** A profile saved before short answers and blanks were told apart has no such keys: they count as 0. */
const NO_FORMATS: Record<ExamFormat, number> = {
  MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, SHORT_ANSWER: 0, CLOZE: 0, OPEN: 0,
};

/** Several saved profiles as one. `term_exams` tells in how many of the exams each topic term
 *  (lower-cased) appears; groundTopics uses it to keep terms shared by the exams first. */
export type MergedExamProfile = ExamProfile & { exam_count: number; term_exams: Record<string, number> };

const termKey = (t: string) => String(t).trim().toLocaleLowerCase("tr");

/**
 * Combines past-exam profiles. Pure and deterministic.
 * - formats are summed, so the kind mix is weighted by each exam's question count;
 * - average stem length is weighted by question count;
 * - topic terms lose question/exam words, count once per root (bellek / belleği), and are ordered by
 *   how many exams contain them, then by their rank inside those exams;
 * - sample stems are taken in turn, so every exam contributes at least one.
 * A single profile comes back with only its terms cleaned (a new profile is already clean: unchanged).
 */
export function mergeExamProfiles(profiles: ExamProfile[]): MergedExamProfile {
  if (!profiles.length) throw new Error("NO_PROFILES");
  // Terms of every exam, cleaned (question/exam words out, one per root), grouped by root across exams.
  // The first form seen names the group: the most frequent one of the earliest exam that has it.
  const groups: { term: string; forms: string[]; exams: number; score: number }[] = [];
  for (const p of profiles)
    cleanTopicTerms(p.topic_terms).forEach((term, i) => {
      let group = groups.find((g) => g.forms.some((f) => sameRoot(f, term)));
      if (!group) groups.push((group = { term, forms: [], exams: 0, score: 0 }));
      group.forms.push(term);
      group.exams += 1;
      group.score += Math.max(1, 8 - i); // earlier in an exam's list = more frequent in that exam
    });
  const term_exams = Object.fromEntries(groups.map((g) => [termKey(g.term), g.exams]));
  if (profiles.length === 1)
    return { ...profiles[0], topic_terms: groups.map((g) => g.term), exam_count: 1, term_exams };

  const formats: Record<ExamFormat, number> = { ...NO_FORMATS };
  let questions = 0;
  let stemChars = 0;
  for (const p of profiles) {
    for (const f of FORMATS) formats[f] += p.formats?.[f] ?? 0;
    questions += p.question_count ?? 0;
    stemChars += (p.average_stem_chars ?? 0) * (p.question_count ?? 0);
  }

  const topic_terms = [...groups]
    .sort((a, b) => b.exams - a.exams || b.score - a.score || termKey(a.term).localeCompare(termKey(b.term), "tr"))
    .slice(0, MERGED_TERMS_MAX)
    .map((g) => g.term);

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
    // Short answers and blanks are named only when the exam has them: the hint of an exam without them is unchanged.
    `çoktan seçmeli ${f.MULTIPLE_CHOICE}, doğru/yanlış ${f.TRUE_FALSE}, hesaplama ${f.CALCULATION}, ` +
      (f.SHORT_ANSWER ? `kısa yanıt ${f.SHORT_ANSWER}, ` : "") +
      (f.CLOZE ? `boşluk doldurma ${f.CLOZE}, ` : "") +
      `açık uçlu ${f.OPEN};`,
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
