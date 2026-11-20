import type { WatchInterval } from './watch-intervals';

export type LearningState = 'WATCHED' | 'PARTIALLY_WATCHED' | 'UNWATCHED' | 'UNKNOWN';
export interface RelevantSpan { start_ms: number; end_ms: number }

/** Strict source-span coverage. Last position and global percentage are irrelevant. */
export function classifyLearning(span: RelevantSpan | null, intervals: unknown): { state: LearningState; coverage: number | null } {
  if (!span || span.start_ms < 0 || span.end_ms <= span.start_ms || !Array.isArray(intervals)) return { state: 'UNKNOWN', coverage: null };
  if (intervals.some(i => !i || !Number.isSafeInteger(i.start_ms) || !Number.isSafeInteger(i.end_ms) || i.start_ms < 0 || i.end_ms <= i.start_ms)) {
    return { state: 'UNKNOWN', coverage: null };
  }
  let covered = 0, end = span.start_ms;
  for (const interval of [...intervals as WatchInterval[]].sort((a, b) => a.start_ms - b.start_ms)) {
    const lo = Math.max(span.start_ms, interval.start_ms, end), hi = Math.min(span.end_ms, interval.end_ms);
    if (hi > lo) { covered += hi - lo; end = hi; }
  }
  const coverage = covered / (span.end_ms - span.start_ms);
  return { state: covered === 0 ? 'UNWATCHED' : coverage >= 1 ? 'WATCHED' : 'PARTIALLY_WATCHED', coverage };
}
