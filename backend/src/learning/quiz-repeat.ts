// isDuplicateStem: ported by hand from origin/feature/quiz-quality-overhaul practice-plan.ts (Fatih).
// The ai-service has the same rule (quiz_checks.is_duplicate_stem); this copy checks the whole exam,
// not only the last stems sent with a request.

const STOP = new Set(["ve", "ile", "bir", "bu", "için", "olan", "olarak", "gibi", "the", "and", "of", "is", "are", "a", "an", "to", "in", "ne", "nedir", "hangi"]);

function words(text: string): Set<string> {
  const cleaned = text.toLocaleLowerCase("tr").normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new Set(cleaned.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** A question repeats an earlier one when most of its content words are shared (order and
 *  punctuation do not matter). Used to refuse near-copies inside one set. */
export function isDuplicateStem(stem: string, existing: string[]): boolean {
  const mine = words(stem);
  if (!mine.size) return false;
  return existing.some((other) => {
    const theirs = words(other);
    if (!theirs.size) return false;
    let shared = 0;
    for (const w of mine) if (theirs.has(w)) shared++;
    const smaller = Math.min(mine.size, theirs.size);
    return shared / smaller >= 0.7 || shared / (mine.size + theirs.size - shared) >= 0.5;
  });
}
