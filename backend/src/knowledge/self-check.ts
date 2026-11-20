/** Self-check: the student's own text compared with the course materials (see ai-service self_check.py).
 *  Only recorded, source-verified facts are passed on: every source must belong to a material the
 *  student may read, and nothing here invents a score. The student's text is never logged. */
export const SELF_CHECK_MAX_CHARS = 4000;
const LABELS = new Set(["IN_SOURCE", "NOT_IN_SOURCE", "CONFLICTS", "PARTIAL", "UNCHECKED"]);
const REASONS = new Set(["QUESTION", "OPINION", "TOO_SHORT"]);

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const terms = (v: unknown) =>
  Array.isArray(v) ? v.filter((t) => typeof t === "string").slice(0, 6).map((t) => t.slice(0, 60)) : [];

function location(raw: any) {
  if (!raw || typeof raw !== "object") return {};
  if (Number.isSafeInteger(raw.page)) return { page: raw.page };
  if (Number.isSafeInteger(raw.slide)) return { slide: raw.slide };
  if (Number.isSafeInteger(raw.start_ms))
    return { start_ms: raw.start_ms, end_ms: Number.isSafeInteger(raw.end_ms) ? raw.end_ms : null };
  return {};
}

type Allowed = Map<string, { title: string; kind: string }>;

function cleanOne(c: any, allowed: Allowed, withParts: boolean): any {
  const one = {
    text: text(c.text, 600),
    label: c.label as string,
    sources: (Array.isArray(c.sources) ? c.sources : [])
      .filter((s: any) => allowed.has(s?.material_id) && /^[a-f0-9]{64}$/.test(s?.source_id ?? ""))
      .slice(0, 2)
      .map((s: any) => {
        const m = allowed.get(s.material_id)!;
        return {
          source_id: s.source_id as string,
          material_id: s.material_id as string,
          title: m.title,
          kind: m.kind,
          location: location(s.location),
          quote: text(s.quote, 160),
        };
      }),
    missing_terms: terms(c.missing_terms),
    // A translated claim was compared by its technical terms only; the student is told so.
    translated: c.label === "IN_SOURCE" && c.translated === true,
    matched_terms: c.label === "IN_SOURCE" && c.translated === true ? terms(c.matched_terms) : [],
    unmatched_numbers: terms(c.unmatched_numbers),
    conflict:
      c.label === "CONFLICTS" && c.conflict && ["NUMBER", "NEGATION"].includes(c.conflict.kind)
        ? {
            kind: c.conflict.kind as string,
            claim: terms(c.conflict.claim),
            source: terms(c.conflict.source),
            claim_negated: c.conflict.claim_negated === true,
            source_negated: c.conflict.source_negated === true,
          }
        : null,
    // The halves of a compound claim ("A ve B"), each judged alone.
    parts: withParts && Array.isArray(c.parts)
      ? c.parts
          .filter((p: any) => LABELS.has(p?.label) && typeof p?.text === "string")
          .slice(0, 4)
          .map((p: any) => cleanOne(p, allowed, false))
      : [],
  };
  // A claim that ended up without a source cannot be "found" or "conflicting": say only what is known.
  return !one.sources.length && ["IN_SOURCE", "CONFLICTS", "PARTIAL", "UNCHECKED"].includes(one.label)
    ? { ...one, label: "NOT_IN_SOURCE", conflict: null, missing_terms: [], unmatched_numbers: [], translated: false, matched_terms: [], parts: one.parts.length > 1 ? one.parts : [] }
    : one;
}

export function cleanSelfCheck(body: any, allowed: Allowed) {
  const claims = (Array.isArray(body?.claims) ? body.claims : [])
    .filter((c: any) => LABELS.has(c?.label) && typeof c?.text === "string")
    .slice(0, 25)
    .map((c: any) => cleanOne(c, allowed, true));
  const count = (label: string) => claims.filter((c: any) => c.label === label).length;
  return {
    claims,
    skipped: (Array.isArray(body?.skipped) ? body.skipped : [])
      .filter((s: any) => REASONS.has(s?.reason))
      .slice(0, 10)
      .map((s: any) => ({ text: text(s.text, 120), reason: s.reason as string })),
    summary: {
      IN_SOURCE: count("IN_SOURCE"),
      NOT_IN_SOURCE: count("NOT_IN_SOURCE"),
      CONFLICTS: count("CONFLICTS"),
      PARTIAL: count("PARTIAL"),
      UNCHECKED: count("UNCHECKED"),
      total: claims.length,
    },
    truncated: body?.truncated === true,
    method: "lexical",
    verified: false,
  };
}
