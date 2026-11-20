import { ApiError } from '../common/errors';

export interface WatchInterval { start_ms: number; end_ms: number }
export const MAX_PROGRESS_INTERVALS = 2000;

export function mergeWatched(intervals: WatchInterval[], duration: number): WatchInterval[] {
  const sorted = intervals.map(interval => ({ ...interval })).sort((a, b) => a.start_ms - b.start_ms);
  const merged: WatchInterval[] = [];
  for (const interval of sorted) {
    if (!Number.isSafeInteger(interval.start_ms) || !Number.isSafeInteger(interval.end_ms) ||
      interval.start_ms < 0 || interval.end_ms <= interval.start_ms || interval.end_ms > duration) {
      throw new ApiError('VALIDATION_ERROR', 'İzleme aralığı video süresinin içinde olmalıdır.');
    }
    const previous = merged.at(-1);
    // Never fill gaps: a seek remains unwatched, even if it is short.
    if (previous && interval.start_ms <= previous.end_ms) previous.end_ms = Math.max(previous.end_ms, interval.end_ms);
    else merged.push(interval);
  }
  if (merged.length > MAX_PROGRESS_INTERVALS) throw new ApiError('VALIDATION_ERROR', 'Bu video için izleme aralığı sınırına ulaşıldı.');
  return merged;
}

export function progressView(videoId: string, duration: number, row?: { positionMs: number; intervals: unknown; revision: number } | null) {
  const intervals = mergeWatched((row?.intervals || []) as WatchInterval[], duration);
  const watched = intervals.reduce((sum, i) => sum + i.end_ms - i.start_ms, 0);
  return { video_id: videoId, duration_ms: duration, position_ms: row?.positionMs || 0,
    intervals, watched_ms: watched, watched_percent: Math.round(watched / duration * 1000) / 10,
    revision: row?.revision || 0, observation: 'MEDIA_PLAYBACK_ONLY' as const };
}
