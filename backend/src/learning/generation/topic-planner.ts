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

/** A heading worth asking about: the first line of a slide/section, short and mostly letters. */
export function heading(text: string): string | null {
  const line = (String(text).split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "").replace(/[\s:;,.–-]+$/, "");
  if (line.length < 4 || line.length > 80 || line.split(/\s+/).length > 10) return null;
  const letters = [...line].filter((ch) => /\p{L}/u.test(ch)).length;
  if (letters / line.length < 0.6) return null;
  if (/[.!?]/.test(line) || /^(chapter|bölüm|ünite|unit|lecture|ders)\s*\d+$/i.test(line)) return null;
  // A heading is followed by more text; a one-line part is a sentence, not a heading.
  return String(text).trim().includes("\n") ? line : null;
}

/** A short label: the part's heading, else its 1–2 most frequent subject words (by root), else its first words. */
export function partLabel(text: string): string {
  const h = heading(text);
  if (h) return h;
  // Words as written (Turkish lower case, apostrophe suffixes cut), grouped by root; a group is shown
  // by its shortest form. Exam boilerplate is not filtered here: "final" is a Java keyword, not a header.
  const groups: { forms: string[]; n: number; first: number }[] = [];
  const written = String(text).toLocaleLowerCase("tr").match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? [];
  written.forEach((raw, i) => {
    const w = raw.replace(/['’].*$/u, "");
    if (w.length < 4 || STOP.has(fold(w)) || /^\d+$/.test(w) || /[ae]bilme/.test(w)) return;
    const hit = groups.find((g) => sameRoot(g.forms[0], w));
    if (hit) {
      hit.n++;
      if (!hit.forms.includes(w)) hit.forms.push(w);
    } else groups.push({ forms: [w], n: 1, first: i });
  });
  const top = groups
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, 2)
    .map((g) => [...g.forms].sort((a, b) => a.length - b.length)[0]);
  const label = top.length ? top.join(", ") : String(text).trim().split(/\s+/).slice(0, 6).join(" ");
  return label.charAt(0).toLocaleUpperCase("tr") + label.slice(1, 80);
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
  for (const p of ordered) {
    const h = heading(p.text);
    if (h && !labels.has(fold(h))) add(h, [p]);
  }
  for (const p of ordered) if (!covered.has(p.key)) add(partLabel(p.text), [p]);
  return topics;
}

/** Topic ideas for the quiz form (GET /quiz-topics): short labels of what the sources are about, never a
 *  file or video title. Section headings first (in turn over the materials), then part labels. */
export const SUGGESTIONS_MAX = 5;
const LABEL_MAX = 60;
export function suggestTopics(pool: SourcePool, max = SUGGESTIONS_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (label: string | null) => {
    if (!label || label.length > LABEL_MAX || seen.has(fold(label)) || out.length >= max) return;
    seen.add(fold(label));
    out.push(label);
  };
  const ordered = byMaterial(pool.parts);
  for (const p of ordered) add(heading(p.text));
  // Labels are computed only while more are needed: a long course has thousands of parts.
  for (const p of ordered) {
    if (out.length >= max) break;
    add(partLabel(p.text));
  }
  return out;
}
