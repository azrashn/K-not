/** Turkish word roots for the generation pipeline. The same rule as ai-service quiz_checks.same_root
 *  (keep the two in step): words are folded (Turkish lower case, ı → i), then compared through the stems
 *  one inflection suffix could leave. Nouns need a stem of 4+ letters (dizi / dizin stay apart); a 2–3
 *  letter verb root (aç-alım / aç-mak) counts only when both words end in a verb ending. */

/** Turkish lower case with dotless ı folded to i, like ai-service text.fold. */
export function fold(text: string): string {
  return String(text ?? "").normalize("NFC").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i");
}

const byLength = (list: string) => [...new Set(list.split(/\s+/).filter(Boolean).map(fold))].sort((a, b) => b.length - a.length);

const NOUN_SUFFIXES = byLength(
  "lerinin larının lerini larını lerine larına lerden lardan lerin ların lerde larda leri ları sinin sının " +
  "sunun sünün inin ının unun ünün sini sını sunu sünü sine sına suna süne ler lar nin nın nun nün den dan " +
  "ten tan yla yle nde nda de da te ta in ın un ün si sı su sü yi yı yu yü ye ya la le i ı u ü e a",
);
const VERB_SUFFIXES = byLength(
  "abilir ebilir abilmek ebilmek acak ecek malı meli mak mek alım elim ıyor iyor uyor üyor mış miş muş " +
  "müş ınız iniz unuz ünüz dı di du dü tı ti tu tü",
);
const ROOT_MIN = 4;
const VERB_ROOT_MIN = 2;
const SOFTENED: Record<string, string> = { ğ: "k", c: "ç", b: "p", d: "t" };

function stems(word: string, suffixes: string[], minimum: number): Set<string> {
  const out = new Set<string>();
  for (const suffix of suffixes) {
    if (!word.endsWith(suffix) || word.length - suffix.length < minimum) continue;
    const stem = word.slice(0, -suffix.length);
    out.add(stem);
    const last = stem.at(-1)!;
    if (SOFTENED[last]) out.add(stem.slice(0, -1) + SOFTENED[last]);
  }
  return out;
}

const isVerb = (word: string) => VERB_SUFFIXES.some((s) => word.endsWith(s) && word.length - s.length >= VERB_ROOT_MIN);
const meets = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));

type Forms = { noun: Set<string>; verb: Set<string> | null };
// Topic matching compares thousands of word pairs; the forms of a word never change.
const cache = new Map<string, Forms>();
function forms(folded: string): Forms {
  let f = cache.get(folded);
  if (!f) {
    f = {
      noun: new Set([folded, ...stems(folded, NOUN_SUFFIXES, ROOT_MIN)]),
      verb: isVerb(folded) ? stems(folded, VERB_SUFFIXES, VERB_ROOT_MIN) : null,
    };
    if (cache.size > 50_000) cache.clear();
    cache.set(folded, f);
  }
  return f;
}

/** True when two words are inflections of one word. */
export function sameRoot(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  if (x === y) return true;
  const fx = forms(x);
  const fy = forms(y);
  if (meets(fx.noun, fy.noun)) return true;
  return Boolean(fx.verb && fy.verb && meets(fx.verb, fy.verb));
}

/** Folded words of a text: letters and digits, apostrophe suffixes cut ("Java'da" → "java"). */
export function words(text: string): string[] {
  return (fold(text).match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []).map((w) => w.replace(/['’].*$/u, ""));
}
