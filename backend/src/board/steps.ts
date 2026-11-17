/**
 * Board steps: the answer written on the board step by step and read aloud (additive `steps`
 * field of video and knowledge answers). Two sources only:
 *  - model steps from the ai-service, checked again here against this answer's evidence;
 *  - evidence steps, built from the found evidence itself when there are no model steps:
 *    board = a short phrase of the evidence sentence, speech = quote = that sentence,
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

/** One piece of evidence: what a step may cite (`source`) and what it may say (`text`). */
export interface StepEvidence { source: string; n: number; text: string }

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

/** The first sentence of a text (at most SENTENCE_MAX characters, cut at a word): a verbatim part of it. */
export function firstSentence(value: string): string {
  const t = value.replace(/\s+/g, ' ').trim();
  const end = t.search(/[.!?](\s|$)/);
  const sentence = end >= 0 ? t.slice(0, end + 1) : t;
  if (sentence.length <= SENTENCE_MAX) return sentence;
  const cut = sentence.slice(0, SENTENCE_MAX);
  const space = cut.lastIndexOf(' ');
  return (space > SENTENCE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '');
}

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

/** Steps built from the evidence alone, one per distinct evidence sentence. */
export function evidenceSteps(evidence: StepEvidence[]): BoardStep[] {
  const seen = new Set<string>();
  const steps: BoardStep[] = [];
  for (const e of evidence) {
    if (steps.length >= MAX_STEPS) break;
    const sentence = firstSentence(String(e.text || ''));
    const key = normalizeText(sentence);
    if (sentence.length < 3 || seen.has(key)) continue;
    seen.add(key);
    steps.push({ board: shortPhrase(sentence), speech: sentence, formula: null, mark: null,
      sources: [e.source], source_ids: [e.n], quote: sentence });
  }
  return steps;
}

/**
 * The `steps` of an answer. `answered` is false for guidance, clarification, missing evidence
 * and similar answers that explain nothing: they get no steps. Otherwise valid model steps win;
 * without them (no model, failed, timed out, invalid) the steps come from the evidence.
 */
export function boardSteps(answered: boolean, evidence: StepEvidence[], generated?: { steps?: unknown; steps_status?: unknown }):
  { steps: BoardStep[]; steps_status: StepsStatus } {
  if (!answered || !evidence.length) return { steps: [], steps_status: 'NONE' };
  const status = generated?.steps_status;
  if (status === 'MODEL' || status === 'REPAIRED') {
    const steps = sanitizeSteps(generated?.steps, evidence);
    if (steps.length) return { steps, steps_status: status };
  }
  const steps = evidenceSteps(evidence);
  return steps.length ? { steps, steps_status: 'EVIDENCE' } : { steps: [], steps_status: 'NONE' };
}

/** "mm:ss" (or "h:mm:ss") of a video moment: the frontend matches it to the citation. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
