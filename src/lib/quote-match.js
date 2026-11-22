/**
 * Finding the sentence a question rests on (its quote) in a source text, to mark it.
 *
 * The quote and the text rarely match byte for byte: PDF text breaks lines, splits words with a hyphen at the
 * line end ("geliş-\ntirme"), doubles spaces and may differ in case or in typographic quotes. Both sides are
 * folded the same way, with a map from every folded character back to the original text, so the match is
 * marked in the text as written. Without an exact match the closest sentence is returned (`exact: false`),
 * never an invented position; with nothing close enough, null.
 */

const LETTER = /\p{L}/u;
const SPACE = /\s/u;
const QUOTES = { "‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "«": '"', "»": '"' };
const DASHES = /[‐‑‒–—−]/u;
const HYPHENS = /[-‐‑­]/u;

/** Lower case, Turkish rules, with ı/İ folded to i so "Işık" and "ışık", "TİP" and "tip" meet. */
function lowerChar(c) {
  return c.toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/̇/g, "");
}

/**
 * `text` folded: one space for any run of white space, line-end hyphens joined, lower case, typographic
 * quotes and dashes made plain. `map[k]` is the index in `text` of folded character k.
 */
export function foldWithMap(text) {
  const src = String(text ?? "");
  let norm = "";
  const map = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "­") continue; // soft hyphen
    if (HYPHENS.test(c) && i > 0 && LETTER.test(src[i - 1])) {
      // "geliş-\n tirme": a hyphen, white space with a line break, then a letter → one word.
      let j = i + 1;
      let newline = false;
      while (j < src.length && SPACE.test(src[j])) {
        if (src[j] === "\n" || src[j] === "\r") newline = true;
        j++;
      }
      if (newline && j < src.length && LETTER.test(src[j])) {
        i = j - 1;
        continue;
      }
    }
    if (SPACE.test(c)) {
      if (norm && norm[norm.length - 1] !== " ") {
        norm += " ";
        map.push(i);
      }
      continue;
    }
    const plain = QUOTES[c] ?? (DASHES.test(c) ? "-" : c);
    for (const ch of lowerChar(plain)) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

const tokens = (folded) => folded.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/** Sentence spans [start, end) of `text`: a sentence ends at . ! ? … or a blank line; a single line break
 *  (PDF text breaks lines inside sentences) does not end it. */
export function sentenceSpans(text) {
  const src = String(text ?? "");
  const spans = [];
  for (const para of src.matchAll(/(?:(?!\n[ \t]*\n)[\s\S])+/gu)) {
    for (const m of para[0].matchAll(/[^.!?…]+(?:[.!?…]+["'’”)]*)?/gu)) {
      const raw = m[0];
      const lead = raw.length - raw.trimStart().length;
      const body = raw.trim();
      const start = para.index + m.index + lead;
      if (body) spans.push({ start, end: start + body.length });
    }
  }
  return spans;
}

/**
 * Where `quote` is in `text`: { start, end, exact } in the original text, or null.
 * Exact: the folded quote (trailing "…" or "." dropped) is found in the folded text.
 * Otherwise the sentence sharing the most words with the quote, when it holds at least half of them.
 */
export function matchQuote(text, quote) {
  const t = foldWithMap(text);
  const q = foldWithMap(quote).norm.trim().replace(/[\s.…]+$/u, "").replace(/^[\s"'(]+|[\s"')]+$/gu, "");
  if (q.length < 3 || !t.norm) return null;
  const at = t.norm.indexOf(q);
  if (at >= 0) return { start: t.map[at], end: t.map[at + q.length - 1] + 1, exact: true };

  const want = [...new Set(tokens(q))];
  if (!want.length) return null;
  let best = null;
  for (const s of sentenceSpans(text)) {
    const have = new Set(tokens(foldWithMap(String(text).slice(s.start, s.end)).norm));
    const shared = want.filter((w) => have.has(w)).length;
    const score = shared / want.length;
    if (!best || score > best.score || (score === best.score && shared > best.shared)) best = { ...s, score, shared };
  }
  const enough = want.length <= 2 ? best?.shared === want.length : best && best.score >= 0.5 && best.shared >= 2;
  return enough ? { start: best.start, end: best.end, exact: false } : null;
}

/**
 * Boxes to mark on a rendered page. `lines` is the page's text layer: lines of words, each word
 * [text, x0, y0, x1, y1] in page fractions (0-1). The words are joined (a space inside a line, a line break
 * between lines, so a line-end hyphen joins), matched with matchQuote, and the matched words become one box
 * per line. Returns { boxes: [{ x, y, width, height }], exact } or null.
 */
export function highlightBoxes(lines, quote) {
  let text = "";
  const owner = []; // character index → [line, word]
  (lines || []).forEach((line, li) => {
    (line || []).forEach((word, wi) => {
      if (text) text += wi === 0 ? "\n" : " ";
      while (owner.length < text.length) owner.push(null);
      const w = String(word?.[0] ?? "");
      for (let k = 0; k < w.length; k++) owner.push([li, wi]);
      text += w;
    });
  });
  const found = matchQuote(text, quote);
  if (!found) return null;
  const byLine = new Map();
  for (let k = found.start; k < found.end; k++) {
    const o = owner[k];
    if (!o) continue;
    const [li, wi] = o;
    const [, x0, y0, x1, y1] = lines[li][wi];
    const box = byLine.get(li);
    if (!box) byLine.set(li, { x0, y0, x1, y1 });
    else Object.assign(box, { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x1), y1: Math.max(box.y1, y1) });
  }
  const boxes = [...byLine.keys()]
    .sort((a, b) => a - b)
    .map((li) => byLine.get(li))
    .map((b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }))
    .filter((b) => b.width > 0 && b.height > 0);
  return boxes.length ? { boxes, exact: found.exact } : null;
}
