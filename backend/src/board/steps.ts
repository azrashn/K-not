/**
 * Board steps: the answer written on the board step by step and read aloud (additive `steps`
 * field of video and knowledge answers). Two sources only:
 *  - model steps from the ai-service, checked again here against this answer's evidence;
 *  - evidence steps, built from the found evidence itself when there are no model steps: the
 *    evidence sentences closest to the question and answer, in evidence order;
 *    board = a short phrase of the sentence, speech = quote = that sentence,
 *    sources = the evidence id / timestamp. Nothing is added that the evidence does not say.
 */

export type Mark = 'underline' | 'circle' | 'arrow';
export type StepsStatus = 'MODEL' | 'REPAIRED' | 'EVIDENCE' | 'NONE';

export interface BoardStep {
  board: string;
  speech: string;
  formula: string | null;
  mark: Mark | null;
  sources: string[];
  source_ids: number[];
  quote?: string;
}

/**
 * One piece of evidence: what a step may cite (`source`) and what it may say (`text`).
 * `order` places it in the material (e.g. [material, page, char_start] or [ms]); default: its index.
 */
export interface StepEvidence { source: string; n: number; text: string; order?: number[] }

export const MAX_STEPS = 6;
const BOARD_MAX = 400, SPEECH_MAX = 1500, FORMULA_MAX = 400, QUOTE_MAX = 300;
const SENTENCE_MAX = 280, PHRASE_WORDS = 7, PHRASE_MAX = 60;
const MARKS = new Set(['underline', 'circle', 'arrow']);

/** Same comparison as the ai-service: case, spacing, quotes, dashes and Turkish i ignored. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/[İIı]/g, 'i').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
}

export function quoteIn(quote: string, texts: string[]): boolean {
  const q = normalizeText(quote).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, '');
  return q.length >= 3 && texts.some(t => normalizeText(t).includes(q));
}

const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * Model steps checked again: shape and limits, sources only from this answer's evidence
 * (a step left without one is dropped), a quote only when it is in one of its sources.
 */
export function sanitizeSteps(raw: unknown, evidence: StepEvidence[]): BoardStep[] {
  if (!Array.isArray(raw)) return [];
  const bySource = new Map(evidence.map(e => [e.source, e]));
  const steps: BoardStep[] = [];
  for (const s of raw.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== 'object') continue;
    const step = s as Record<string, unknown>;
    if (!text(step.board, BOARD_MAX) || !text(step.speech, SPEECH_MAX)) continue;
    const formula = typeof step.formula === 'string' && step.formula.trim() && step.formula.length <= FORMULA_MAX ? step.formula.trim() : null;
    const mark = typeof step.mark === 'string' && MARKS.has(step.mark) ? step.mark as Mark : null;
    const cited = [...new Set((Array.isArray(step.sources) ? step.sources : []).filter((x): x is string => typeof x === 'string' && bySource.has(x)))];
    if (!cited.length) continue;
    const out: BoardStep = {
      board: (step.board as string).trim(), speech: (step.speech as string).trim(), formula, mark,
      sources: cited, source_ids: cited.map(c => bySource.get(c)!.n),
    };
    if (typeof step.quote === 'string' && step.quote.trim() && step.quote.length <= QUOTE_MAX
      && quoteIn(step.quote, cited.map(c => bySource.get(c)!.text))) out.quote = step.quote.trim();
    steps.push(out);
  }
  return steps;
}

/** A sentence of at most SENTENCE_MAX characters, cut at a word: still a verbatim part of it. */
export function clip(sentence: string): string {
  if (sentence.length <= SENTENCE_MAX) return sentence;
  const cut = sentence.slice(0, SENTENCE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > SENTENCE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '');
}

// A period after these (or after a single letter, as in "e.g." or "J.") does not end a sentence.
const ABBREVIATIONS = new Set(['vb', 'vs', 'örn', 'orn', 'bkz', 'dr', 'prof', 'doç', 'yrd', 'sn', 'mr', 'mrs', 'ms', 'etc', 'no', 'fig', 'yy']);
// End punctuation followed by a sentence start, a blank line, or a new line that starts like a sentence
// (a PDF line wrapped mid-sentence goes on in lower case and is not split).
const BOUNDARY = /[.!?…]+["'”’)\]]*(?=\s+[\p{Lu}\p{N}"'“‘(\[•*-]|\s*$)|\n\s*\n|\n(?=[ \t]*[\p{Lu}\p{N}•*-])/gu;

/** The sentences of a text, each a verbatim part of it (spacing collapsed) with its offset. */
export function sentences(value: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  const push = (from: number, to: number) => {
    const s = value.slice(from, to).replace(/\s+/g, ' ').trim();
    if (s) out.push({ text: s, offset: from });
  };
  let start = 0;
  for (const m of value.matchAll(BOUNDARY)) {
    if (m[0].startsWith('.')) {
      const word = /(\p{L}+)$/u.exec(value.slice(Math.max(0, m.index! - 12), m.index!))?.[1];
      if (word && (word.length === 1 || ABBREVIATIONS.has(word.toLocaleLowerCase('tr')))) continue;
    }
    const end = m.index! + m[0].length;
    push(start, end);
    start = end;
  }
  push(start, value.length);
  return out;
}

// Words that say nothing about the topic (after normalizeText: Turkish i folded, lower case).
const STOPWORDS = new Set([
  've', 'veya', 'ile', 'için', 'icin', 'bir', 'bu', 'şu', 'da', 'de', 'mi', 'mu', 'mü', 'ne', 'nasil', 'neden', 'niçin',
  'hangi', 'gibi', 'daha', 'çok', 'cok', 'en', 'ama', 'fakat', 'ancak', 'kadar', 'olan', 'olarak', 'ise', 'değil',
  'var', 'yok', 'her', 'şey', 'sonra', 'önce', 'göre', 'bunu', 'bunun', 'buna', 'onun', 'ona', 'olur', 'nedir',
  'the', 'and', 'for', 'with', 'are', 'was', 'were', 'how', 'what', 'why', 'which', 'this', 'that', 'from', 'can',
  'does', 'into', 'its', 'not', 'you', 'your',
]);
const WORD_MIN = 3, STEM = 5, SENTENCE_WORDS_MIN = 4, EVIDENCE_STEPS_MAX = 5, COMMON_MIN_SENTENCES = 3;

/** The topic words of a text (normalized, citation labels and stopwords removed). */
export function topicWords(value: string): string[] {
  const words = normalizeText(value.replace(/\[\d+\]/g, ' ')).split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter(w => w.length >= WORD_MIN && !STOPWORDS.has(w)))];
}

/** Same word up to Turkish suffixes: "çalıştırılır" ~ "çalıştırmak", "java" ~ "javanın". */
const sameWord = (a: string, b: string) => {
  const n = Math.min(STEM, a.length, b.length);
  return a.slice(0, n) === b.slice(0, n);
};
const overlap = (words: string[], query: string[]) => query.filter(q => words.some(w => sameWord(w, q))).length;
const wordCount = (s: string) => s.split(' ').filter(w => /[\p{L}\p{N}]/u.test(w)).length;

/** A short phrase for the board: the first words of the sentence, "…" when cut. */
export function shortPhrase(sentence: string): string {
  const words = sentence.replace(/[.!?]+$/, '').split(' ');
  let phrase = '';
  for (const w of words.slice(0, PHRASE_WORDS)) {
    if ((phrase + ' ' + w).trim().length > PHRASE_MAX) break;
    phrase = (phrase + ' ' + w).trim();
  }
  if (!phrase) phrase = sentence.slice(0, PHRASE_MAX);
  const cut = phrase.length < sentence.replace(/[.!?]+$/, '').length;
  return cut ? phrase.replace(/[\s,;:]+$/, '') + '…' : phrase;
}

/**
 * What evidence steps are chosen for: the question, and the written answer only when a model
 * wrote it (an answer made of the excerpts themselves would match every sentence).
 */
export interface StepQuery { question: string; answer?: string }

/**
 * Steps built from the evidence alone: the evidence sentences that share the most topic words
 * with the question (2 points per word) and the written answer (1 point), at most 5, shown in
 * evidence order (`order`: document position or video time) rather than score order. Words in
 * more than half of the sentences (with at least 3 sentences) do not count, unless no sentence
 * scores without them; then they count after all. Sentences under
 * 4 words, repeats (also one inside another, as overlapping chunks give), sentences sharing no
 * word and sentences under half the best score are left out; no sentence left means no steps.
 * Quotes stay verbatim.
 */
export function evidenceSteps(evidence: StepEvidence[], query: StepQuery): BoardStep[] {
  const all = evidence.flatMap((e, i) => sentences(String(e.text || '')).map(s => {
    const sentence = clip(s.text);
    return { e, sentence, words: topicWords(sentence), key: normalizeText(sentence), order: [...(e.order ?? [i]), s.offset] };
  }));
  // A word in more than half of the evidence sentences (e.g. "Java" in a Java text) tells them
  // apart from nothing: it does not count, once there are enough sentences to say so.
  const telling = (word: string) => all.length < COMMON_MIN_SENTENCES
    || all.filter(s => s.words.some(w => sameWord(w, word))).length <= all.length / 2;
  const asked = topicWords(query.question), answered = topicWords(query.answer ?? '');
  const score = (q: string[], a: string[]) => all.map(s => ({ ...s, score: 2 * overlap(s.words, q) + overlap(s.words, a) }))
    .filter(c => c.score > 0 && wordCount(c.sentence) >= SENTENCE_WORDS_MIN);
  let scored = score(asked.filter(telling), answered.filter(telling));
  // Only common words matched ("Dijkstra nedir?" over a Dijkstra lecture): score once more with them.
  if (!scored.length) scored = score(asked, answered);
  // Only sentences close to the best one: at least half of its score.
  const best = Math.max(0, ...scored.map(c => c.score));
  const candidates = scored.filter(c => c.score * 2 >= best);

  const before = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const chosen: typeof candidates = [];
  for (const c of [...candidates].sort((a, b) => b.score - a.score || before(a.order, b.order))) {
    if (chosen.length >= EVIDENCE_STEPS_MAX) break;
    if (chosen.some(k => k.key.includes(c.key) || c.key.includes(k.key))) continue;
    chosen.push(c);
  }
  return chosen.sort((a, b) => before(a.order, b.order)).map(({ e, sentence }) => ({
    board: shortPhrase(sentence), speech: sentence, formula: null, mark: null,
    sources: [e.source], source_ids: [e.n], quote: sentence,
  }));
}

/**
 * The `steps` of an answer. `answered` is false for guidance, clarification, missing evidence
 * and similar answers that explain nothing: they get no steps. Otherwise valid model steps win;
 * without them (no model, failed, timed out, invalid) the steps come from the evidence.
 */
export function boardSteps(answered: boolean, evidence: StepEvidence[], query: StepQuery,
  generated?: { steps?: unknown; steps_status?: unknown }): { steps: BoardStep[]; steps_status: StepsStatus } {
  if (!answered || !evidence.length) return { steps: [], steps_status: 'NONE' };
  const status = generated?.steps_status;
  if (status === 'MODEL' || status === 'REPAIRED') {
    const steps = sanitizeSteps(generated?.steps, evidence);
    if (steps.length) return { steps, steps_status: status };
  }
  const steps = evidenceSteps(evidence, query);
  return steps.length ? { steps, steps_status: 'EVIDENCE' } : { steps: [], steps_status: 'NONE' };
}

/** "mm:ss" (or "h:mm:ss") of a video moment: the frontend matches it to the citation. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
