/** Student fixes laid over the engine's transcript. Pure and deterministic.
 *
 *  A fix applies only while the engine's text for that chunk is still the text that was corrected
 *  (compared by SHA-256). If the video is reprocessed and the chunk changed, the fix is reported as
 *  stale instead of being applied to different words. */
import { createHash } from "node:crypto";

export const CORRECTION_MAX_CHARS = 3000;
export const CORRECTION_HISTORY_MAX = 20;

export type EngineChunk = { text: string; start_seconds: number; end_seconds: number };
export type Correction = { chunkIndex: number; originalSha: string; text: string };
export type TranscriptChunk = {
  index: number;
  text: string;
  start_seconds: number;
  end_seconds: number;
  corrected: boolean;
  original_text?: string;
};
export type HistoryEntry = { text: string; at: string };

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function applyCorrections(chunks: EngineChunk[], corrections: Correction[]) {
  const byIndex = new Map(corrections.map((c) => [c.chunkIndex, c]));
  const stale: number[] = [];
  const out: TranscriptChunk[] = chunks.map((chunk, index) => {
    const fix = byIndex.get(index);
    if (!fix) return { index, ...chunk, corrected: false };
    if (fix.originalSha !== sha256(chunk.text)) {
      stale.push(index);
      return { index, ...chunk, corrected: false };
    }
    return { index, text: fix.text, start_seconds: chunk.start_seconds, end_seconds: chunk.end_seconds, corrected: true, original_text: chunk.text };
  });
  // Fixes whose chunk no longer exists are stale too.
  for (const c of corrections) if (c.chunkIndex >= chunks.length) stale.push(c.chunkIndex);
  return { chunks: out, stale: [...new Set(stale)].sort((a, b) => a - b) };
}

/** Changes whenever any fix is added, edited or removed, so a material's version follows its fixes. */
export function correctionsDigest(corrections: Pick<Correction, "chunkIndex" | "text">[]): string {
  if (!corrections.length) return "";
  const parts = [...corrections].sort((a, b) => a.chunkIndex - b.chunkIndex).map((c) => `${c.chunkIndex}:${sha256(c.text)}`);
  return sha256(parts.join("|")).slice(0, 16);
}

/** Newest first, bounded. */
export function pushHistory(history: unknown, text: string, at = new Date()): HistoryEntry[] {
  const prior = Array.isArray(history) ? (history as HistoryEntry[]) : [];
  return [{ text, at: at.toISOString() }, ...prior].slice(0, CORRECTION_HISTORY_MAX);
}

export function cleanCorrection(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
  return clean.length >= 1 && clean.length <= CORRECTION_MAX_CHARS ? clean : null;
}
