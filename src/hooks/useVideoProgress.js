import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { videoErrorText } from '../lib/video'
import { createWatchTracker, mergeObserved } from '../lib/watch-tracker'

export function useVideoProgress(courseId, videoId, ready, player) {
  const [state, setState] = useState({ progress: null, error: '', saving: false })
  const session = useRef(null)
  useEffect(() => {
    if (!ready || !videoId) { session.current = null; setState({ progress: null, error: '', saving: false }); return }
    const current = { tracker: createWatchTracker(), pending: [], dirty: false, position: 0,
      progress: null, active: true, sending: false, failed: false, touched: false }
    session.current = current
    setState({ progress: null, error: '', saving: false })
    const load = new AbortController()
    function update(patch) { if (current.active) setState(old => ({ ...old, ...patch })) }
    function sample(forcePosition = false) {
      const video = player.current
      if (!video || !current.progress) return
      const next = Math.min(current.progress.duration_ms, Math.max(0, Math.round(video.currentTime * 1000)))
      current.touched ||= forcePosition || (!video.paused && !video.seeking)
      if (current.touched && next !== current.position) { current.position = next; current.dirty = true }
      current.tracker.sample({ seconds: video.currentTime, wallMs: performance.now(), rate: video.playbackRate,
        playing: !video.paused && !video.ended, seeking: video.seeking, visible: !document.hidden })
    }
    async function flush(keepalive = false) {
      current.pending = mergeObserved([...current.pending, ...current.tracker.drain()])
        .map(i => ({ start_ms: i.start_ms, end_ms: Math.min(i.end_ms, current.progress?.duration_ms ?? i.end_ms) }))
        .filter(i => i.end_ms > i.start_ms)
      if (current.sending || !current.progress || (!current.dirty && !current.pending.length)) return
      // Long uninterrupted intervals are split into bounded API observations.
      const batch = []
      const remaining = []
      for (const range of current.pending) {
        for (let start = range.start_ms; start < range.end_ms; start += 120000) {
          const item = { start_ms: start, end_ms: Math.min(start + 120000, range.end_ms) }
          if (batch.length < 60) batch.push(item); else remaining.push(item)
        }
      }
      current.pending = remaining
      const position = current.position
      current.dirty = false; current.sending = true
      update({ saving: true })
      try {
        const request = api.saveVideoProgress(courseId, videoId, { position_ms: position, intervals: batch }, keepalive ? undefined : AbortSignal.timeout(15000), keepalive)
        current.flight = request
        const result = await request
        current.progress = result; current.failed = false
        update({ progress: result, error: '' })
      } catch (error) {
        current.pending = mergeObserved([...batch, ...current.pending]); current.dirty = true; current.failed = true
        update({ error: videoErrorText(error) })
      } finally {
        current.sending = false; current.flight = null; update({ saving: false })
        // Flush the final event if unmounted during an in-flight write. Avoid a
        // retry loop on failure; the visible tab retries on its next tick.
        if (!current.active && !current.failed && (current.dirty || current.pending.length)) void flush(true)
      }
    }
    current.sample = sample; current.flush = flush
    function loadProgress() {
      return api.videoProgress(courseId, videoId, load.signal).then(progress => {
        if (!current.active) return
        current.progress = progress; current.position = progress.position_ms
        update({ progress, error: '' })
      }).catch(error => { if (error.name !== 'AbortError') update({ error: videoErrorText(error) }) })
    }
    current.retry = () => current.progress ? flush() : loadProgress()
    void loadProgress()
    const timer = setInterval(() => { sample(); void flush() }, 5000)
    const leaving = () => { sample(); current.tracker.reset(); void flush(true) }
    const hidden = () => { if (document.hidden) leaving(); else current.tracker.reset() }
    window.addEventListener('pagehide', leaving)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      // Sample while the selected media still belongs to this effect.
      // timeupdate/pause already captured its last position; do not read a new player.
      current.active = false; load.abort(); clearInterval(timer)
      window.removeEventListener('pagehide', leaving); document.removeEventListener('visibilitychange', hidden)
      current.tracker.reset(); void flush(true)
      if (session.current === current) session.current = null
    }
  }, [courseId, videoId, ready, player])
  const observe = useCallback(() => session.current?.sample(), [])
  const reset = useCallback(() => session.current?.tracker.reset(), [])
  const flush = useCallback(() => { session.current?.sample(); return session.current?.flush() }, [])
  const seeked = useCallback(() => { session.current?.tracker.reset(); session.current?.sample(true); void session.current?.flush() }, [])
  const retry = useCallback(() => session.current?.retry(), [])
  const flushForQuestion = useCallback(async () => {
    const current = session.current
    if (!current?.progress) return false
    current.sample()
    if (current.flight) await current.flight.catch(() => {})
    if (!current.active) return false
    // Establish an explicit empty observation when a never-played video is
    // queried. A missing/unreadable progress record remains UNKNOWN server-side.
    if (current.progress.revision === 0) current.dirty = true
    await current.flush()
    return !current.failed
  }, [])
  return { ...state, observe, reset, flush, seeked, retry, flushForQuestion }
}
