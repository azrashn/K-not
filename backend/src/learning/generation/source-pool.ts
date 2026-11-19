/** Source pool: the exact texts quiz and exam questions may be written from.
 *
 *  1. Which materials (QUIZ_TRANSCRIPT_POLICY). A video's text is its automatic transcript, with recognition
 *     errors ("Ceva object oriented"). documents_first: when the scope holds a document, only documents are
 *     used; a transcript only for a video the student chose or a scope without any document, and then the
 *     pool carries TRANSCRIPT_WARNING. never: transcripts are never used.
 *  2. Parts. Every segment is cut at sentence ends into parts the ai-service shows whole (PART_CHARS, its
 *     SOURCE_CHARS), so every sentence of a part can be quoted. A part's text is an exact substring of its
 *     segment: the backend's quote check and source link (material + segment id) keep working.
 *  3. Capacity: questions a part can carry, 2 with at least 6 usable sentences, 1 with fewer, 0 without.
 *
 *  buildPool is pure; loadPool only reads materials and their segments. */
import { ApiError } from "../../common/errors";
import type { AuthUser } from "../../common/request-context";
import type { QuizTranscriptPolicy } from "../../config/config";
import type { KnowledgeService } from "../../knowledge/knowledge.service";
import { isTranscriptId, videoChosen } from "../quiz-sources";

export type PoolRequest = { scope?: any; material_id?: string; watched_only?: boolean };
export type PoolMaterial = { id: string; kind?: string; title: string; status: string; version?: string };
export type PoolSegment = { id: string; text?: string; location?: any };

export type SourcePart = {
  /** Unique in the pool: segment id, plus "#n" when a long segment gives several parts. */
  key: string;
  /** Segment id: what the backend checks with knowledge.source(material_id, id). */
  id: string;
  material_id: string;
  version?: string;
  kind?: string;
  title: string;
  location?: any;
  text: string;
  /** Position in the pool: materials in scope order, then segment order. */
  order: number;
  sentences: number;
  capacity: number;
  transcript: boolean;
};

export type SourcePool = {
  parts: SourcePart[];
  /** Some part comes from an automatic transcript. */
  transcript: boolean;
  /** Shown on screen and written into the exam note when transcript is true. */
  warning: string | null;
  /** About how many questions the pool can carry without reusing a sentence. */
  capacity: number;
  /** Transcripts in scope were left out because documents exist (a topic missing from the documents is
   *  then explained with a hint to choose the video). */
  transcriptsLeftOut: boolean;
};

export const TRANSCRIPT_WARNING = "Sorular videonun otomatik transkriptinden hazırlanıyor; yazım hataları olabilir.";
export const NO_DOCUMENT_MESSAGE = "Soru üretmek için derse en az bir belge (PDF, slayt ya da metin) yükleyin.";
export const NOTHING_READY_MESSAGE = "Bu kapsamda soru hazırlamaya uygun hazır kaynak yok.";

// ai-service quiz_engine.py: SENTENCE_MIN, SENTENCE_MAX, SOURCE_CHARS and its sentence split.
export const SENTENCE_MIN = 8;
export const SENTENCE_MAX = 600;
export const PART_CHARS = 1200;
const SENTENCE_END = /(?<=[.!?…])\s+|\s*\n\s*/gu;
/** Materials and segments read per pool, as loadSourceTexts did. */
const MATERIALS_MAX = 8;
const SEGMENTS_MAX = 400;

const isTranscript = (m: { kind?: string; id?: string }) => m.kind === "VIDEO" || isTranscriptId(m.id);

/** Ready materials of the request's scope: the active material, the selected ones, or the whole course. */
export function scopedMaterials<T extends PoolMaterial>(materials: T[], req: PoolRequest): T[] {
  const ready = materials.filter((m) => m.status === "READY");
  if (req.material_id && (!req.scope || req.scope.mode === "active")) return ready.filter((m) => m.id === req.material_id);
  if (req.scope?.mode === "selected" && Array.isArray(req.scope.material_ids)) {
    const ids = new Set<string>(req.scope.material_ids);
    return ready.filter((m) => ids.has(m.id));
  }
  return ready;
}

/** The materials questions may use under the policy, and whether a transcript is among them. */
export function chooseMaterials<T extends PoolMaterial>(
  materials: T[],
  req: PoolRequest,
  policy: QuizTranscriptPolicy,
): { materials: T[]; transcript: boolean; transcriptsLeftOut: boolean } {
  // Watched-only practice is about videos the student watched: only videos can be in it.
  const scoped = scopedMaterials(materials, req).filter((m) => !req.watched_only || isTranscript(m));
  const documents = scoped.filter((m) => !isTranscript(m));
  if (policy === "never") {
    if (!documents.length) throw new ApiError("VALIDATION_ERROR", NO_DOCUMENT_MESSAGE);
    return { materials: documents, transcript: false, transcriptsLeftOut: documents.length < scoped.length };
  }
  if (!scoped.length) throw new ApiError("VALIDATION_ERROR", NOTHING_READY_MESSAGE);
  // A video the student chose, or a scope without any document: the transcript is the only text.
  const chosen = videoChosen(req) ? scoped : documents.length ? documents : scoped;
  return { materials: chosen, transcript: chosen.some(isTranscript), transcriptsLeftOut: chosen.length < scoped.length };
}

/** (start, end) of each sentence, as the ai-service splits: a piece shorter than SENTENCE_MIN joins the next
 *  one, a short tail joins the sentence before it. */
export function sentenceSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  const bounds: [number, number][] = [...text.matchAll(SENTENCE_END)].map((m) => [m.index!, m.index! + m[0].length]);
  bounds.push([text.length, text.length]);
  let start = 0;
  let pending: number | null = null;
  for (const [stop, after] of bounds) {
    const begin: number = pending ?? start;
    start = after;
    const piece = text.slice(begin, stop).trim();
    if (!piece) continue;
    if (piece.length < SENTENCE_MIN) {
      pending = begin;
      continue;
    }
    spans.push([begin, stop]);
    pending = null;
  }
  if (pending !== null) {
    if (spans.length) spans[spans.length - 1] = [spans[spans.length - 1][0], text.length];
    else spans.push([pending, text.length]);
  }
  return spans;
}

/** Sentences the ai-service would number in this text (a sentence over SENTENCE_MAX counts as its pieces). */
export function usableSentences(text: string): number {
  return sentenceSpans(text).reduce((n, [a, b]) => n + Math.ceil(text.slice(a, b).trim().length / SENTENCE_MAX), 0);
}

export function partCapacity(sentences: number): number {
  return sentences >= 6 ? 2 : sentences >= 1 ? 1 : 0;
}

/** A segment cut at sentence ends into pieces of at most PART_CHARS (a longer single sentence stays whole). */
export function splitSegment(text: string): string[] {
  const spans = sentenceSpans(text);
  const out: string[] = [];
  let first = -1;
  let last = -1;
  for (const [a, b] of spans) {
    if (first >= 0 && b - first > PART_CHARS) {
      out.push(text.slice(first, last).trim());
      first = -1;
    }
    if (first < 0) first = a;
    last = b;
  }
  if (first >= 0) out.push(text.slice(first, last).trim());
  return out.filter(Boolean);
}

/**
 * The pool from the chosen materials and their segments (pure). Empty segments and PDF pages without text
 * are skipped, as are parts without a usable sentence. `eligible`, when given, keeps only those segment ids
 * (watched-only practice).
 */
export function buildPool(
  chosen: PoolMaterial[],
  segments: Map<string, PoolSegment[]>,
  eligible?: Set<string>,
  transcriptsLeftOut = false,
): SourcePool {
  const parts: SourcePart[] = [];
  for (const m of chosen) {
    for (const seg of segments.get(m.id) ?? []) {
      if (!seg?.id || !seg.text?.trim() || seg.location?.empty || (eligible && !eligible.has(seg.id))) continue;
      const pieces = splitSegment(seg.text);
      pieces.forEach((text, n) => {
        const sentences = usableSentences(text);
        const capacity = partCapacity(sentences);
        if (!capacity) return;
        parts.push({
          key: pieces.length > 1 ? `${seg.id}#${n + 1}` : seg.id,
          id: seg.id,
          material_id: m.id,
          version: m.version,
          kind: m.kind,
          title: m.title,
          location: seg.location,
          text,
          order: parts.length,
          sentences,
          capacity,
          transcript: isTranscript(m),
        });
      });
    }
  }
  const transcript = parts.some((p) => p.transcript);
  return {
    parts,
    transcript,
    warning: transcript ? TRANSCRIPT_WARNING : null,
    capacity: parts.reduce((sum, p) => sum + p.capacity, 0),
    transcriptsLeftOut,
  };
}

/** Evidence the ai-service and quiz-generator expect for a part (the shape knowledge.ask returns). */
export function partEvidence(p: SourcePart) {
  return { id: p.id, text: p.text, location: p.location, material_id: p.material_id, version: p.version, kind: p.kind, title: p.title };
}

/** Reads the chosen materials' segments and builds the pool. An unreadable material only adds nothing. */
export async function loadPool(
  knowledge: KnowledgeService,
  u: AuthUser,
  c: string,
  req: PoolRequest,
  policy: QuizTranscriptPolicy,
  eligible?: Set<string>,
): Promise<SourcePool> {
  const { materials, transcriptsLeftOut } = chooseMaterials((await knowledge.materials(u, c)) as PoolMaterial[], req, policy);
  const segments = new Map<string, PoolSegment[]>();
  for (const m of materials.slice(0, MATERIALS_MAX)) {
    try {
      segments.set(m.id, ((await knowledge.preview(u, c, m.id)).segments ?? []).slice(0, SEGMENTS_MAX));
    } catch {
      /* unreadable: no parts */
    }
  }
  return buildPool(materials.slice(0, MATERIALS_MAX), segments, eligible, transcriptsLeftOut);
}
