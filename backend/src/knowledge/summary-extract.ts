/** Summary and key concepts picked from the WHOLE material, without a model.
 *
 *  Why: a small local model that sees 8 pages of a 150 page deck can only summarize those 8 pages. Here every
 *  page is read, the terms the material itself stresses are found (headings, acronyms, terms that return on
 *  many pages), and the sentences that define or explain them are shown as they stand in the source.
 *
 *  Nothing is rewritten: every quote is a literal piece of its page (only line breaks inside a wrapped slide
 *  bullet become spaces). The result says it was selected, not written.
 *  Pure functions; no I/O, so the rules are tested without a model or a database. */
import type { SummaryItem, SummarySegment } from "./summary";

const MIN_WORDS = 5;
const MAX_WORDS = 40;
const MAX_CONCEPTS = 12;
const MAX_POINTS = 12;
const MIN_ITEMS = 3;

const STOP = new Set(
  `the and for with that this are was were from have has had not but can will would should could into over under about such
  than then them they their there these those which what when where while who whom whose how why also each every both either
  more most many much some any all other another same own very just only even still its it's our your you we us he she his her
  one two three first last next new use used using uses make made makes need needs given take takes get gets see seen say
  chapter page slide figure example examples step steps note notes etc per via can't don't does doesn't did done being been
  bir ve ile için gibi daha çok olan olarak her bu şu ise veya ama fakat ancak kadar sonra önce göre nasıl neden nedir
  var yok değil olur olabilir yapılır edilir sayfa slayt şekil örnek adım`.split(/\s+/),
);
const FOREIGN = /[Ѐ-ӿ֐-ۿऀ-෿぀-ヿ㐀-鿿가-힯]/g;
const MARKER = /^\s*(?:o(?=\s)|[§•▪●◦·‣–—-]|\d{1,2}[.)])\s*/;
const FOOTER = /(?:\b\d{1,3}\s*[-–/]\s*\d{1,4}\s*$)|^(?:chapter|page|slide|sayfa|slayt)\b|©|all rights reserved|^\d+$/i;
const DEFINING = /\b(?:is|are|means|refers? to|defined as|consists? of|provides?|allows?|used (?:to|for)|called|known as|ise|demektir|denir|sağlar)\b/i;
const WORD = /[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9'-]{2,}/g;

type Unit = { text: string; heading: boolean };
type Page = { segment: SummarySegment; order: number; heading: string | null; units: string[]; fixed: string[]; fixedHeading: string | null };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const alphaRatio = (s: string) => {
  const t = s.replace(/\s+/g, "");
  return t.length ? (t.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length / t.length : 0;
};

/** Readable, statement-like text: not a counter, not a number table, no foreign alphabets. */
export function readableUnit(s: string): boolean {
  const n = words(s).length;
  // diagram labels glued together by the text extraction ("msg§is passed", "x = y + 1")
  if (/[§•▪●]/.test(s) || /[=<>]{1}.*[=<>]/.test(s) || (s.match(/[A-Z]/g) || []).length > s.length * 0.35) return false;
  if (n < MIN_WORDS || n > MAX_WORDS) return false;
  if (FOOTER.test(squash(s))) return false;
  if ((s.match(FOREIGN) || []).length > 1) return false;
  return alphaRatio(s) >= 0.55;
}

/** Bullet items of a slide/page text: a marked line opens an item, a line starting in lower case continues
 *  the item before it (slide text wraps sentences over lines). Items are split further at sentence ends. */
export function slideUnits(text: string): Unit[] {
  const items: string[] = [];
  let open = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      open = false;
      continue;
    }
    if (MARKER.test(line)) {
      items.push(line.replace(MARKER, "").trim());
      open = true;
    } else if (open && items.length && /^[a-zçğıöşü]/.test(line)) {
      items[items.length - 1] = `${items[items.length - 1]} ${line}`.trim();
    } else {
      items.push(line);
      open = false;
    }
  }
  const out: Unit[] = [];
  items.forEach((item, i) => {
    for (const part of item.split(/(?<=[.!?])\s+/)) {
      const t = part.trim();
      if (t) out.push({ text: t, heading: false });
    }
    void i;
  });
  return out;
}

function pageOf(segment: SummarySegment, order: number): Page {
  const units = slideUnits(segment.text);
  // The first line of a page is its title when it is short and is not a sentence.
  let heading: string | null = null;
  const first = units[0]?.text;
  if (first && units.length >= 2 && words(first).length <= 10 && !/[.!?]$/.test(first) && alphaRatio(first) >= 0.6 && !FOOTER.test(first)) {
    heading = first;
  }
  return { segment, order, heading, units: units.map((u) => u.text), fixed: [], fixedHeading: null };
}

// ── damaged ligatures ("conges$on", "applica/on") ───────────────────────────────────────────────────
// A label shown to the student is repaired with the material's OWN words: a token with a stray symbol where
// "ti/tt/ft/fi/fl/ff" belongs is put right only when the result is a word that occurs clean elsewhere in the
// material. Quotes are never touched: they stay literal.
const LIGATURES = ["ti", "tt", "ft", "fi", "fl", "ff"];
export function cleanVocabulary(pages: { units: string[]; heading: string | null }[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages)
    for (const u of [...p.units, ...(p.heading ? [p.heading] : [])])
      for (const w of u.match(/[A-Za-zçğıöşü]{5,}/g) || []) counts.set(w.toLowerCase(), (counts.get(w.toLowerCase()) || 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 2).map(([w]) => w));
}
export function repairLabel(label: string, vocab: Set<string>): string {
  return label.replace(/[^\s,.;:()"“”]{4,}/g, (token) => {
    if (vocab.has(token.toLowerCase())) return token;
    for (let i = 0; i < token.length; i++) {
      const ch = token[i];
      if (/[A-Za-zçğıöşü]/.test(ch) && !(ch === "j" || ch === "C")) continue;
      for (const lig of LIGATURES) {
        const cand = token.slice(0, i) + lig + token.slice(i + 1);
        if (vocab.has(cand.toLowerCase())) return cand;
      }
    }
    return token;
  });
}

type Term = { key: string; label: string; score: number; pages: Set<number>; heading: number };

function tokens(s: string): string[] {
  return (s.match(WORD) || []).filter((w) => w.length >= 3);
}

const isAcronym = (w: string) => /^[A-Z][A-Z0-9]{1,9}$/.test(w);

/** Terms the material stresses: acronyms, heading phrases, words that return on several pages. */
export function keyTerms(pages: Page[]): Term[] {
  const terms = new Map<string, Term>();
  const add = (label: string, order: number, inHeading: boolean) => {
    const key = label.toLowerCase();
    let t = terms.get(key);
    if (!t) terms.set(key, (t = { key, label, score: 0, pages: new Set(), heading: 0 }));
    t.pages.add(order);
    if (inHeading) t.heading += 1;
  };
  const content = (w: string) => !STOP.has(w.toLowerCase()) && (isAcronym(w) || w.length >= 4);
  for (const page of pages) {
    const sources: { text: string; heading: boolean }[] = [
      ...(page.fixedHeading ? [{ text: page.fixedHeading, heading: true }] : []),
      ...page.fixed.map((text) => ({ text, heading: false })),
    ];
    for (const src of sources) {
      const ws = tokens(src.text);
      ws.forEach((w, i) => {
        if (!content(w)) return;
        add(isAcronym(w) ? w : w.toLowerCase(), page.order, src.heading);
        const next = ws[i + 1];
        // two content words next to each other: "congestion control", "slow start", "flow control"
        if (next && content(next) && !isAcronym(w) && !isAcronym(next))
          add(`${w.toLowerCase()} ${next.toLowerCase()}`, page.order, src.heading);
      });
    }
  }
  const total = Math.max(1, pages.length);
  const out: Term[] = [];
  for (const t of terms.values()) {
    const df = t.pages.size;
    const phrase = t.key.includes(" ");
    if (df < 2) continue;
    if (df > 0.2 * total && total >= 10) continue; // the topic of the whole material, not a concept in it
    if (phrase && (df < 3 || t.heading < 1)) continue; // a phrase must be a title phrase that returns
    if (!phrase && !isAcronym(t.label) && t.heading < 1 && df < 4) continue;
    t.score = df * (1 + 2 * t.heading) * (phrase ? 2 : 1);
    out.push(t);
  }
  out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  // A word that lives inside a better phrase ("control" in "congestion control") is not a concept on its own.
  const chosen: Term[] = [];
  for (const t of out) {
    if (chosen.length >= 40) break;
    if (!t.key.includes(" ") && chosen.some((c) => c.key.includes(" ") && c.key.split(" ").includes(t.key) && c.pages.size >= t.pages.size * 0.4)) continue;
    if (t.key.includes(" ") && chosen.some((c) => c.key.includes(" ") && (c.key.includes(t.key) || t.key.includes(c.key)) && c.score >= t.score)) continue;
    chosen.push(t);
  }
  return chosen;
}

const wholeWord = (term: string) => new RegExp(`(^|[^A-Za-zÇĞİÖŞÜçğıöşü0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-zÇĞİÖŞÜçğıöşü0-9])`, "i");

/** `text` as it stands in the segment (line breaks of a wrapped bullet aside). */
const verbatim = (segment: SummarySegment, quote: string) => squash(segment.text).includes(squash(quote));

function dedupe(pages: Page[]): Page[] {
  const seen = new Set<string>();
  const kept = pages.map((p) => ({
    ...p,
    units: p.units.filter((u) => {
      const k = squash(u).toLowerCase();
      if (seen.has(k)) return false; // repeated headers and footers
      seen.add(k);
      return readableUnit(u);
    }),
  }));
  // Analysis copies (terms, matching) are repaired with the material's own vocabulary; quotes stay literal.
  const vocab = cleanVocabulary(kept);
  for (const p of kept) {
    p.fixed = p.units.map((u) => repairLabel(u, vocab));
    p.fixedHeading = p.heading ? repairLabel(p.heading, vocab) : null;
  }
  return kept;
}

function defineScore(unit: string, term: Term, page: Page): number {
  let s = 0;
  const w = words(unit);
  if (DEFINING.test(unit)) s += 3;
  if (unit.toLowerCase().startsWith(term.key)) s += 2; // "TCP: ...", "Congestion control is ..."
  if (page.fixedHeading && page.fixedHeading.toLowerCase().includes(term.key)) s += 2;
  if (unit.includes(":")) s += 1;
  if (w.length >= 8 && w.length <= 28) s += 1;
  return s;
}

export function extractConcepts(segments: SummarySegment[]): SummaryItem[] {
  const pages = dedupe(segments.map((s, i) => pageOf(s, i)));
  const terms = keyTerms(pages).slice(0, MAX_CONCEPTS * 3);
  const usedUnits = new Set<string>();
  const items: { order: number; item: SummaryItem }[] = [];
  for (const term of terms) {
    if (items.length >= MAX_CONCEPTS) break;
    const re = wholeWord(term.label);
    let best: { score: number; page: Page; unit: string } | null = null;
    for (const page of pages) {
      for (let i = 0; i < page.units.length; i++) {
        const unit = page.units[i];
        if (!re.test(page.fixed[i]) || usedUnits.has(unit)) continue;
        const score = defineScore(page.fixed[i], term, page) - page.order * 1e-6; // earlier page wins a tie
        if (!best || score > best.score) best = { score, page, unit };
      }
    }
    if (!best || best.score < 1) continue;
    if (!verbatim(best.page.segment, best.unit)) continue;
    usedUnits.add(best.unit);
    const repaired = term.label;
    if (/[^A-Za-zÇĞİÖŞÜçğıöşü0-9 '-]/.test(repaired)) continue; // a label that is still damaged is not shown
    const label = isAcronym(repaired) ? repaired : repaired.replace(/^./, (c) => c.toUpperCase());
    items.push({
      order: best.page.order,
      item: {
        term: label,
        explanation: best.page.fixedHeading ? `Sayfa başlığı: ${best.page.fixedHeading}` : "Kaynakta geçtiği yer",
        quote: squash(best.unit),
        source: { id: best.page.segment.id, location: best.page.segment.location },
      },
    });
  }
  return items.sort((a, b) => a.order - b.order).map((x) => x.item);
}

export function extractPoints(segments: SummarySegment[]): SummaryItem[] {
  const pages = dedupe(segments.map((s, i) => pageOf(s, i))).filter((p) => p.units.length > 0);
  if (!pages.length) return [];
  const terms = keyTerms(pages).slice(0, 40);
  const weight = new Map(terms.map((t) => [t.key, t.score]));
  const top = Math.max(1, ...terms.map((t) => t.score));
  const groups = Math.max(3, Math.min(MAX_POINTS, Math.ceil(pages.length / 10)));
  const items: SummaryItem[] = [];
  const used = new Set<string>();
  for (let g = 0; g < groups; g++) {
    const slice = pages.slice(Math.floor((g * pages.length) / groups), Math.floor(((g + 1) * pages.length) / groups));
    let best: { score: number; page: Page; unit: string } | null = null;
    for (const page of slice) {
      page.units.forEach((unit, i) => {
        if (used.has(unit) || (page.heading && unit === page.heading)) return;
        const lower = page.fixed[i].toLowerCase();
        let s = 0;
        for (const [key, w] of weight) if (lower.includes(key)) s += w / top;
        s = s / Math.sqrt(words(unit).length);
        if (DEFINING.test(unit)) s += 0.35;
        if (i < 3) s += 0.1;
        if (!best || s > best.score) best = { score: s, page, unit };
      });
    }
    if (!best) continue;
    const { page, unit } = best as { page: Page; unit: string };
    if (!verbatim(page.segment, unit)) continue;
    used.add(unit);
    const loc = page.segment.location as any;
    const where = loc?.page != null ? `Sayfa ${loc.page}` : loc?.slide != null ? `Slayt ${loc.slide}` : "Kaynak";
    const title = page.fixedHeading && words(page.fixedHeading).length >= 2 && alphaRatio(page.fixedHeading) >= 0.75 ? page.fixedHeading : "";
    items.push({ text: title ? `${where} · ${title}` : where, quote: squash(unit), source: { id: page.segment.id, location: page.segment.location } });
  }
  return items;
}

/** Items for the focus, or [] when the material is too thin to say anything (the caller then falls back). */
export function extractSummary(focus: "summary" | "concepts", segments: SummarySegment[]): SummaryItem[] {
  const usable = segments.filter((s) => typeof s.text === "string" && s.text.trim());
  const items = focus === "concepts" ? extractConcepts(usable) : extractPoints(usable);
  return items.length >= MIN_ITEMS ? items : [];
}


/** The pages that say the most, for the model to read: one best page per section of the material (so the
 *  whole length is covered), ranked by how many of the material's key terms its sentences carry. Returns the
 *  segments in reading order, plus the cleaned key terms as hints. A short material is returned whole. */
export function selectKeyPages(segments: SummarySegment[], n: number): { picked: SummarySegment[]; terms: string[] } {
  const usable = segments.filter((s) => typeof s.text === "string" && s.text.trim());
  if (usable.length <= n) return { picked: usable, terms: [] };
  const pages = dedupe(usable.map((s, i) => pageOf(s, i)));
  const terms = keyTerms(pages).slice(0, 40);
  const top = Math.max(1, ...terms.map((t) => t.score));
  const weight = new Map(terms.map((t) => [t.key, t.score / top]));
  const scored = pages.map((page) => {
    const unitScores = page.fixed
      .map((u) => {
        const lower = u.toLowerCase();
        let sc = 0;
        for (const [key, w] of weight) if (lower.includes(key)) sc += w;
        return sc / Math.sqrt(Math.max(4, words(u).length));
      })
      .sort((a, b) => b - a);
    const sentences = page.units.length;
    const score = unitScores.slice(0, 3).reduce((a, b) => a + b, 0) + (page.heading ? 0.2 : 0) + Math.min(sentences, 8) * 0.03;
    return { page, score: sentences >= 2 ? score : 0 };
  });
  const picked: SummarySegment[] = [];
  for (let g = 0; g < n; g++) {
    const slice = scored.slice(Math.floor((g * scored.length) / n), Math.floor(((g + 1) * scored.length) / n));
    const best = slice.reduce<{ page: Page; score: number } | null>((a, b) => (!a || b.score > a.score ? b : a), null);
    if (best && best.score > 0) picked.push(best.page.segment);
  }
  return { picked: picked.length >= 3 ? picked : usable.slice(0, n), terms: terms.slice(0, 16).map((t) => t.label) };
}
