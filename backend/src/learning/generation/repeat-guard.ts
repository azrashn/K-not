/** Repeat guard of one quiz or exam: question stems compared by Turkish root (the ai-service rule, so a
 *  repeat the ai-service let through is still caught here) and the source sentences already used. */
import { fold, sameRoot, words } from "./roots";

/** What one ai-service request carries (QuizRequest.avoid_stems / avoid_quotes limits). */
export const AVOID_STEMS_MAX = 10;
export const AVOID_QUOTES_MAX = 60;

const STEM_STOP = new Set(
  "ve ile bir bu için olan olarak gibi the and of is are a an to in ne nedir hangi".split(" ").map(fold),
);
const stemWords = (text: string) => [...new Set(words(text).filter((w) => w.length > 2 && !STEM_STOP.has(w)))];

/** Most content words shared with an earlier stem; a word is shared when the other stem holds a word of
 *  the same root (order, punctuation and suffixes ignored). */
export function isDuplicateStem(stem: string, existing: string[]): boolean {
  const mine = stemWords(stem);
  if (!mine.length) return false;
  return existing.some((other) => {
    const theirs = stemWords(other);
    if (!theirs.length) return false;
    const shared = mine.filter((w) => theirs.some((t) => sameRoot(w, t))).length;
    return shared / Math.min(mine.length, theirs.length) >= 0.7 || shared / (mine.length + theirs.length - shared) >= 0.5;
  });
}

/** Sentence key: case, spacing and closing punctuation ignored (ai-service quiz_checks.canonical). */
export const quoteKey = (quote: string) => fold(quote).replace(/\s+/g, " ").trim().replace(/[.!?;,]+$/, "");

export class RepeatGuard {
  private readonly stems: string[] = [];
  private readonly quotes: string[] = [];
  private readonly keys = new Set<string>();

  constructor(earlier: { stems?: string[]; quotes?: string[] } = {}) {
    for (const s of earlier.stems ?? []) this.stems.push(s);
    for (const q of earlier.quotes ?? []) this.addQuote(q);
  }

  private addQuote(quote: string) {
    const key = quoteKey(quote);
    if (!key || this.keys.has(key)) return;
    this.keys.add(key);
    this.quotes.push(quote);
  }

  isRepeat(stem: string): boolean {
    return isDuplicateStem(stem, this.stems);
  }

  isUsedQuote(quote: string): boolean {
    return this.keys.has(quoteKey(quote));
  }

  /** Records an accepted question. */
  accept(stem: string, quote: string): void {
    this.stems.push(stem);
    this.addQuote(quote);
  }

  /** The latest stems and sentences, within one request's limits. */
  avoidStems(): string[] {
    return this.stems.slice(-AVOID_STEMS_MAX);
  }

  avoidQuotes(): string[] {
    return this.quotes.slice(-AVOID_QUOTES_MAX);
  }
}
