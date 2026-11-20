/** Source-bound summary helpers. The model proposes points; a point is kept only when its quote is
 *  copied from the source segment it cites. Pure functions so the rule is tested without a model. */
export type SummaryFocus = "summary" | "concepts";
export type SummarySegment = { id: string; text: string; location: unknown };
export type SummarySource = { id: string; location: unknown };
export type SummaryItem =
  | { text: string; quote: string; source: SummarySource }
  | { term: string; explanation: string; quote: string; source: SummarySource };

const MAX_ITEMS = 10;

/** Evenly spread up to `n` items so a long material is summarized from its whole length. */
export function pickSpread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

export function verifiedSummaryItems(
  focus: SummaryFocus,
  raw: any,
  picked: SummarySegment[],
): SummaryItem[] {
  // The AI service answers {focus, items: [...]} with items it already checked against the sources.
  const proposed = raw?.items;
  if (!Array.isArray(proposed)) return [];
  const out: SummaryItem[] = [];
  for (const item of proposed.slice(0, MAX_ITEMS)) {
    const index = item?.source_index;
    const segment = Number.isInteger(index) ? picked[index - 1] : undefined;
    if (!segment || typeof item.quote !== "string" || !item.quote.trim()) continue;
    // The quote must be a verbatim part of the cited segment, never of another one.
    if (!segment.text.includes(item.quote)) continue;
    const source = { id: segment.id, location: segment.location };
    if (focus === "concepts") {
      const { term, explanation } = item;
      if (typeof term !== "string" || term.trim().length < 2 || term.length > 80) continue;
      if (typeof explanation !== "string" || explanation.trim().length < 8 || explanation.length > 400) continue;
      out.push({ term: term.trim(), explanation: explanation.trim(), quote: item.quote, source });
    } else {
      const { text } = item;
      if (typeof text !== "string" || text.trim().length < 8 || text.length > 400) continue;
      out.push({ text: text.trim(), quote: item.quote, source });
    }
  }
  return out;
}
