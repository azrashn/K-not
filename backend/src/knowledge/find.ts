/** Text search inside one material. Pure: case, Turkish diacritics and spacing do not matter
 *  ("isik" finds "Işık"), and every hit keeps the segment (page, slide, time) it came from. */
export type FindSegment = { id: string; text: string; location: unknown };
export type FindHit = {
  segment_id: string;
  location: unknown;
  count: number;
  snippet: string;
  match_start: number;
  match_end: number;
};

const TR: Record<string, string> = { ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g", ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c" };
/** One output unit per input unit, so offsets in the folded text equal offsets in the original. */
export function foldChar(c: string): string {
  if (TR[c]) return TR[c];
  const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (base || c).toLowerCase().slice(0, 1) || c;
}
export const fold = (s: string) => s.split("").map(foldChar).join("");

export const FIND_MIN = 2;
export const FIND_MAX_HITS = 50;
const CONTEXT = 70;

export function findInSegments(segments: FindSegment[], query: string, limit = FIND_MAX_HITS): FindHit[] {
  const needle = fold(String(query).trim().replace(/\s+/g, " "));
  if (needle.length < FIND_MIN) return [];
  const hits: FindHit[] = [];
  for (const segment of segments) {
    const text = segment.text;
    // Fold per UTF-16 code unit so offsets in the folded text equal offsets in the original.
    const flat = text.replace(/\s+/g, " ");
    const folded = flat.split("").map(foldChar).join("");
    let at = folded.indexOf(needle);
    if (at < 0) continue;
    let count = 0;
    for (let i = at; i >= 0; i = folded.indexOf(needle, i + needle.length)) count++;
    const from = Math.max(0, at - CONTEXT);
    const to = Math.min(flat.length, at + needle.length + CONTEXT);
    hits.push({
      segment_id: segment.id,
      location: segment.location,
      count,
      snippet: (from > 0 ? "…" : "") + flat.slice(from, to) + (to < flat.length ? "…" : ""),
      match_start: at - from + (from > 0 ? 1 : 0),
      match_end: at - from + (from > 0 ? 1 : 0) + needle.length,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
