/** Browser media observations, not attention/mastery. No seek gap is credited. */
export function mergeObserved(intervals) {
  const merged = []
  for (const range of [...intervals].sort((a, b) => a.start_ms - b.start_ms)) {
    const previous = merged.at(-1)
    if (previous && range.start_ms <= previous.end_ms) previous.end_ms = Math.max(previous.end_ms, range.end_ms)
    else merged.push({ ...range })
  }
  return merged
}

export function createWatchTracker() {
  let anchor = null
  let ranges = []
  return {
    reset() { anchor = null },
    sample({ seconds, wallMs, rate = 1, playing, seeking, visible }) {
      const current = { seconds, wallMs, rate }
      if (!playing || seeking || !visible || !Number.isFinite(seconds) || !Number.isFinite(rate) || rate <= 0) { anchor = null; return }
      if (anchor) {
        const elapsed = (wallMs - anchor.wallMs) / 1000
        const media = seconds - anchor.seconds
        // Large wall-clock gaps can be suspended/background tabs. Rate changes
        // and discontinuities reset the anchor rather than guessing watch time.
        if (elapsed > 0 && elapsed <= 2.5 && rate === anchor.rate && media > 0 && media <= elapsed * rate + 0.25) {
          const start = Math.round(anchor.seconds * 1000), end = Math.round(seconds * 1000)
          if (end > start) ranges = mergeObserved([...ranges, { start_ms: start, end_ms: end }])
        }
      }
      anchor = current
    },
    drain() { const result = ranges; ranges = []; return result },
  }
}
