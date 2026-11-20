/** Topics bound to source parts. A topic is a label to show and the parts its questions are written from,
 *  so a question never depends on what a search happens to return for the label.
 *
 *  Quiz: the student's topic, with the pool's parts ranked by how many of its words (by root) they hold;
 *  parts a search returned for the topic count too.
 *  Exam: past-exam terms the pool contains (shared by more exams first), then section headings, then every
 *  remaining part as a topic of its own: a course whose past exams share no word with the notes still
 *  gets one topic per part instead of one ("object") for the whole exam. */
import { ApiError } from "../../common/errors";
import { cleanTopicTerms } from "../exam-style";
import { fold, sameRoot, words } from "./roots";
import type { SourcePart, SourcePool } from "./source-pool";

export type PlannedTopic = { label: string; parts: SourcePart[] };

export const TOPIC_NOT_IN_DOCUMENTS =
  "Bu konu ders belgelerinde bulunamadı. Videodan soru hazırlamak için Gelişmiş ayarlardan videoyu seçin.";
export const TOPIC_NOT_IN_SOURCES =
  "Bu konu ders kaynaklarında bulunamadı. Konuyu kaynaklarda geçen bir başlığa ya da kavrama yaklaştırın.";

// Function words: never a label, never what a topic is about.
const STOP = new Set(
  ("ve veya ile ama fakat ancak çünkü için gibi kadar sonra önce olarak olan olur bir bu şu o her çok daha " +
   "en ise de da mi mı ne nedir nasıl hangi tüm bütün bazı diğer başka aynı yani ayrıca sadece yalnızca " +
   "bunu buna bunun şimdi vardır yoktur eder edilir yapılır " +
   // Postpositions and helpers: "Java, tarafından" is not a topic.
   "tarafından üzerinde üzerinden sayesinde boyunca arasında içinde dışında yerine göre karşı doğru değil " +
   "değildir zorunda hale halde şekilde durumda sırasında artık hiçbir " +
   "the and or of to in on for with from that this " +
   "is are was be by as an a it its into also which when").split(/\s+/).map(fold),
);

const contentWords = (text: string) => [...new Set(words(text).filter((w) => w.length >= 3 && !STOP.has(w)))];

// Leading section numbers: "4. ", "4.2 ", "1 ", "IV. ", "3) ", "Bölüm 4: ".
const NUMBERING = /^(?:(?:bölüm|ünite|kısım|chapter|unit|section)\s+)?(?:\d+(?:\.\d+)*\s*[.):–-]?|[ivxlc]+[.)])\s+/iu;
// A numbered line inside a part: "4. Veri Tipleri", "3.1 Sınıflar". A heading need not open the page.
const NUMBERED_LINE = /^\d+(?:\.\d+)*[.)]?\s+\p{Lu}/u;
// Running headers and exam papers, not subjects ("1 JAVA PROGRAMLAMA - VİZE SINAVI", "Ders Notları").
// Matched on folded text; "final" alone is a Java keyword, only "final sınavı" is boilerplate.
const BOILERPLATE =
  /(^|\s)((vize|final|ara|bütünleme|mazeret|yariyil sonu|dönem sonu)\s+sinav|sinav(i|lar|lari)?(\s|$)|ders not|lecture notes|ad\s*soyad|öğrenci no|sayfa\s*\d|page\s*\d)/u;
// A Turkish copula or verb ending: "Java platform bağımsızdır" is a statement, not a heading.
const STATEMENT_END = /(d[iuü]r|t[iuü]r|d[iuü]rlar|d[iuü]rler|[ae]bilir|yor)$/u;

/** True when the label only names the document ("Java Programlama", for "Java Programlama – Ders Notları"). */
export function namesDocument(label: string, title?: string): boolean {
  if (!title) return false;
  const plain = (t: string) => words(t).filter((w) => !/^\d+$/.test(w) && !STOP.has(w));
  const titleWords = plain(title);
  const mine = plain(label);
  return Boolean(titleWords.length && mine.length) && mine.every((w) => titleWords.some((t) => sameRoot(w, t)));
}

/** Words written with a capital in the middle of a sentence ("… çalışan Java kodu", "… JVM üzerinde"):
 *  names that keep their capital in a sentence-case heading. Folded word → written form. */
function properNames(text: string): Map<string, string> {
  const out = new Map<string, string>();
  // After a word that starts in lower case: "Java Programlama" (a title line) names nothing.
  for (const m of String(text).matchAll(/(?<=(?:^|\s)[\p{Ll}\d][\p{L}\d]*,? )(\p{Lu}[\p{L}\d+#]*)/gu)) out.set(fold(m[1]), m[1]);
  return out;
}

/** "Veri Tipleri" → "Veri tipleri", "NESNE YÖNELİMLİ PROGRAMLAMA" → "Nesne yönelimli programlama"; short
 *  all-capital words (JVM) and names the text writes with a capital (Java) keep their form. */
function sentenceCase(label: string, names: Map<string, string>): string {
  const shouting = !/\p{Ll}/u.test(label);
  const out = label
    .split(/(\s+)/)
    .map((w) => {
      if (/^\s+$/.test(w)) return w;
      const core = w.replace(/['’].*$/u, "").replace(/[^\p{L}\p{N}+#]+$/u, "");
      const name = names.get(fold(core));
      if (name) return name + w.slice(core.length);
      const acronym = core.length >= 2 && core.length <= 5 && core === core.toLocaleUpperCase("tr") && /\p{Lu}/u.test(core);
      return !shouting && acronym ? w : w.toLocaleLowerCase("tr");
    })
    .join("");
  return out.charAt(0).toLocaleUpperCase("tr") + out.slice(1);
}

/**
 * A line cleaned into a topic, or null when it is not one: the section number is dropped and the rest is
 * written in sentence case. Refused: a piece of a sentence (starts in lower case, ends in "ve", a word cut
 * "eri-" or "eri…"), a statement, exam and document boilerplate, and the document's own name.
 */
export function cleanHeading(raw: string, opts: { title?: string; text?: string } = {}): string | null {
  const line = String(raw).trim();
  if (/(…|\.\.\.|\p{L}[-‐­])$/u.test(line)) return null;
  const h = line.replace(NUMBERING, "").replace(/[\s:;,.–-]+$/u, "").trim();
  if (h.length < 4 || h.length > 60) return null;
  const tokens = h.split(/\s+/);
  if (tokens.length > 8 || !/^\p{Lu}/u.test(h) || /^\p{L}[,;]/u.test(h)) return null;
  const letters = [...h].filter((ch) => /\p{L}/u.test(ch)).length;
  if (letters / h.length < 0.6 || /[.!?]/.test(h)) return null;
  if (/^(chapter|bölüm|ünite|unit|lecture|ders|hafta|week)\s*\d*$/iu.test(h)) return null;
  const last = fold(tokens[tokens.length - 1]).replace(/[^\p{L}\p{N}]/gu, "");
  if (STOP.has(last) || (tokens.length > 1 && STATEMENT_END.test(last))) return null;
  if (BOILERPLATE.test(fold(h)) || namesDocument(h, opts.title)) return null;
  return sentenceCase(h, properNames(opts.text ?? ""));
}

/** Heading lines of a part, best first: numbered section lines ("4. Veri Tipleri"), then the first line
 *  (a slide title). A one-line part is a sentence, not a heading. */
function headingLines(text: string): string[] {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const numbered = lines.slice(0, -1).filter((l) => NUMBERED_LINE.test(l));
  return [...new Set([...numbered, lines[0]])];
}

/** All headings of a part, cleaned (see cleanHeading). */
export function headings(text: string, title?: string): string[] {
  const out: string[] = [];
  const lines = headingLines(text);
  // Names are read from the running text only: every word of a heading line starts with a capital.
  const body = String(text).split(/\r?\n/).filter((l) => !lines.includes(l.trim())).join("\n");
  for (const line of lines) {
    const h = cleanHeading(line, { title, text: body });
    if (h && !out.some((o) => fold(o) === fold(h))) out.push(h);
  }
  return out;
}

/** A heading worth asking about: the part's best heading line, cleaned; null when it has none. */
export function heading(text: string, title?: string): string | null {
  return headings(text, title)[0] ?? null;
}

/** The part's 1–2 most frequent subject words (by root), or null when it has none. Words of the document's
 *  title are left out: a page header repeats them, and they name the document, not the part. */
export function subjectLabel(text: string, title?: string): string | null {
  const titleWords = title ? words(title) : [];
  // Words as written (Turkish lower case, apostrophe suffixes cut), grouped by root; a group is shown
  // by its shortest form. Exam boilerplate is not filtered here: "final" is a Java keyword, not a header.
  const groups: { forms: string[]; n: number; first: number }[] = [];
  // A short boilerplate line (the page header "1 JAVA PROGRAMLAMA - VİZE SINAVI") is not what the part is about.
  const running = String(text)
    .split(/\r?\n/)
    .filter((l) => !(l.trim().split(/\s+/).length <= 8 && BOILERPLATE.test(fold(l))))
    .join("\n");
  const written = running.toLocaleLowerCase("tr").match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
  written.forEach((raw, i) => {
    const w = raw.replace(/['’].*$/u, "");
    if (w.length < 4 || STOP.has(fold(w)) || /^\d+$/.test(w) || /[ae]bilme/.test(w)) return;
    if (titleWords.some((t) => sameRoot(t, w))) return;
    const hit = groups.find((g) => sameRoot(g.forms[0], w));
    if (hit) {
      hit.n++;
      if (!hit.forms.includes(w)) hit.forms.push(w);
    } else groups.push({ forms: [w], n: 1, first: i });
  });
  const top = groups
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, 2)
    // A second word only when it recurs: "Bytecode", not "Bytecode, yılında".
    .filter((g, i) => i === 0 || g.n >= 2)
    .map((g) => [...g.forms].sort((a, b) => a.length - b.length)[0]);
  if (!top.length) return null;
  const label = top.join(", ");
  return label.charAt(0).toLocaleUpperCase("tr") + label.slice(1, 80);
}

/** A short label: the part's heading, else its subject words, else its first whole words (never cut). */
export function partLabel(text: string, title?: string): string {
  const label = heading(text, title) ?? subjectLabel(text, title);
  if (label) return label;
  const first = String(text).trim().split(/\s+/).slice(0, 6);
  while (first.length > 1 && STOP.has(fold(first[first.length - 1]))) first.pop();
  const joined = first.join(" ").replace(/[\s,;:–-]+$/u, "");
  return joined.charAt(0).toLocaleUpperCase("tr") + joined.slice(1, 80);
}

/** Headings of the pool's parts, with running page headers left out: a heading that opens three or more
 *  parts of one material is the page header ("1 JAVA PROGRAMLAMA" on every page), not a section. */
function poolHeadings(parts: SourcePart[]): Map<string, string[]> {
  const all = new Map(parts.map((p) => [p.key, headings(p.text, p.title)]));
  const counts = new Map<string, number>();
  for (const p of parts) for (const h of all.get(p.key)!) {
    const k = `${p.material_id}|${fold(h)}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const p of parts) all.set(p.key, all.get(p.key)!.filter((h) => (counts.get(`${p.material_id}|${fold(h)}`) ?? 0) < 3));
  return all;
}

/** How strongly a part is about these words: distinct words found (by root), then their occurrences. */
function score(topicWords: string[], part: SourcePart): { found: number; hits: number } {
  const partWords = words(part.text);
  let found = 0;
  let hits = 0;
  for (const t of topicWords) {
    const n = partWords.filter((w) => sameRoot(t, w)).length;
    if (n) found++;
    hits += n;
  }
  return { found, hits };
}

/**
 * The pool's parts that are about `topic`, best first. A part counts when it holds a word of the topic (by
 * root) or when a search returned its segment (`retrieved`, best first): a topic in other words or another
 * language can still be found. Ties keep the pool order.
 */
export function rankParts(topic: string, parts: SourcePart[], retrieved: string[] = []): SourcePart[] {
  const topicWords = contentWords(topic);
  const rank = new Map(retrieved.map((id, i) => [id, i]));
  return parts
    .map((p) => {
      const s = score(topicWords, p);
      const r = rank.get(p.id);
      // Share of the topic's words found, plus up to 0.5 for the search rank.
      const value = (topicWords.length ? s.found / topicWords.length : 0) + (r === undefined ? 0 : 0.5 * (1 - r / (rank.size + 1)));
      return { p, value, hits: s.hits };
    })
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || b.hits - a.hits || a.p.order - b.p.order)
    .map((x) => x.p);
}

/** The quiz topic as written, bound to its parts; VALIDATION_ERROR when the pool has nothing on it. */
export function quizTopic(topic: string, pool: SourcePool, retrieved: string[] = []): PlannedTopic {
  const label = String(topic).trim().slice(0, 200);
  const parts = rankParts(label, pool.parts, retrieved);
  if (!parts.length)
    throw new ApiError("VALIDATION_ERROR", pool.transcriptsLeftOut ? TOPIC_NOT_IN_DOCUMENTS : TOPIC_NOT_IN_SOURCES);
  return { label, parts };
}

/** Round-robin over materials, so one long document does not provide every topic first. */
function byMaterial(parts: SourcePart[]): SourcePart[] {
  const lists = new Map<string, SourcePart[]>();
  for (const p of parts) lists.set(p.material_id, [...(lists.get(p.material_id) ?? []), p]);
  const out: SourcePart[] = [];
  for (let i = 0; out.length < parts.length; i++) for (const l of lists.values()) if (l[i]) out.push(l[i]);
  return out;
}

/**
 * Exam topics in the order they should be used. `terms` are the past exams' topic terms; `priority` maps a
 * lower-cased term to how many selected exams hold it. Every part of the pool ends up in at least one topic,
 * so the question plan can always reach the whole pool.
 */
export function examTopics(terms: string[], pool: SourcePool, priority: Record<string, number> = {}): PlannedTopic[] {
  const topics: PlannedTopic[] = [];
  const labels = new Set<string>();
  const covered = new Set<string>();
  const add = (label: string, parts: SourcePart[]) => {
    let unique = label;
    for (let n = 2; labels.has(fold(unique)); n++) unique = `${label} (${n})`;
    labels.add(fold(unique));
    topics.push({ label: unique, parts });
    for (const p of parts) covered.add(p.key);
  };

  // 1. Terms of the past exams that the pool holds, by how many exams share them, then by how many parts.
  const shared = new Map(Object.entries(priority).map(([term, n]) => [fold(term), n]));
  const termTopics = cleanTopicTerms(terms)
    .map((term, index) => ({ term, index, parts: rankParts(term, pool.parts).filter((p) => score(contentWords(term), p).found) }))
    .filter((t) => t.parts.length)
    .sort((a, b) => (shared.get(fold(b.term)) ?? 0) - (shared.get(fold(a.term)) ?? 0) || b.parts.length - a.parts.length || a.index - b.index);
  for (const t of termTopics) add(t.term, t.parts);

  // 2. Section headings, then 3. every part no topic holds yet, each a topic of its own.
  const ordered = byMaterial(pool.parts);
  const found = poolHeadings(pool.parts);
  for (const p of ordered) {
    const h = found.get(p.key)![0];
    if (h && !labels.has(fold(h))) add(h, [p]);
  }
  for (const p of ordered) if (!covered.has(p.key)) add(partLabel(p.text, p.title), [p]);
  return topics;
}

/** Topic ideas for the quiz form (GET /quiz-topics): short labels of what the sources are about. Section
 *  headings first (numbered sections, then slide titles, in turn over the materials), cleaned to "Veri
 *  tipleri"; then the parts' subject words. Never a piece of a sentence, a page header, exam boilerplate
 *  or a file's, video's or document's own name. */
export const SUGGESTIONS_MAX = 5;
const LABEL_MAX = 60;
export function suggestTopics(pool: SourcePool, max = SUGGESTIONS_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (label: string | null | undefined, title?: string) => {
    if (!label || label.length > LABEL_MAX || seen.has(fold(label)) || out.length >= max || namesDocument(label, title)) return;
    seen.add(fold(label));
    out.push(label);
  };
  const ordered = byMaterial(pool.parts);
  if (!max) return out;
  const found = poolHeadings(pool.parts);
  for (const p of ordered) for (const h of found.get(p.key)!) add(h, p.title);
  // Subject words are computed only while more are needed: a long course has thousands of parts.
  for (const p of ordered) {
    if (out.length >= max) break;
    if (!found.get(p.key)!.length) add(subjectLabel(p.text, p.title), p.title); // a part with a heading gave it
  }
  return out;
}
