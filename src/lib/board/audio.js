import { activeStepAt } from './timeline'

// Adımların sesi. Önce ilk adım istenir, anlatım hazır olur olmaz başlar; diğerleri arka planda
// sırayla gelir. Sesi gelmeyen adım okuma süresiyle gösterilir; ilki gelmezse geri kalanı denenmez.
// Durum: { state: 'idle' | 'loading' | 'ready' | 'failed', url?, durationMs? }

export class StepAudioLoader {
  constructor(count, fetchAudio, onChange) {
    this.statuses = Array.from({ length: count }, () => ({ state: 'idle' }))
    this.fetchAudio = fetchAudio
    this.onChange = onChange
    this.started = false
    this.disposed = false
  }

  start() {
    if (this.started) return Promise.resolve()
    this.started = true
    return this.run()
  }

  set(index, status) {
    this.statuses = this.statuses.map((s, i) => (i === index ? status : s))
    this.onChange(this.statuses)
  }

  async run() {
    for (let i = 0; i < this.statuses.length; i++) {
      if (this.disposed) return
      this.set(i, { state: 'loading' })
      try {
        const { url, durationMs } = await this.fetchAudio(i)
        if (this.disposed) return
        this.set(i, durationMs > 0 ? { state: 'ready', url, durationMs } : { state: 'failed' })
      } catch {
        if (this.disposed) return
        if (i === 0) {
          this.statuses = this.statuses.map(() => ({ state: 'failed' }))
          this.onChange(this.statuses)
          return
        }
        this.set(i, { state: 'failed' })
      }
    }
  }

  dispose() {
    this.disposed = true
  }
}

// Çizelge için süreler: sesi hazır olanın sesi, diğerleri okuma tahmini (null).
export const audioDurations = (statuses) => statuses.map((s) => (s.state === 'ready' && s.durationMs ? s.durationMs : null))

// Adım başına/sonuna bu kadar (ms) yakınken gelmekte olan ses beklenir.
export const AUDIO_WAIT_MARGIN_MS = 60

// `t` anında tahtanın sesini beklemesi gereken adım ya da -1. Başarısız ses hiç bekletmez.
export function pendingAudioAt(timeline, t, statuses) {
  const active = activeStepAt(timeline, Math.max(t, 0))
  if (active < 0) return -1
  const waiting = (i) => statuses[i]?.state === 'loading' || statuses[i]?.state === 'idle'
  const step = timeline.steps[active]
  if (waiting(active) && t <= step.start + AUDIO_WAIT_MARGIN_MS) return active
  const next = active + 1
  if (next < timeline.steps.length && waiting(next) && t >= step.end - AUDIO_WAIT_MARGIN_MS) return next
  return -1
}

// fetchAudio(index, step) → url ya da { url, durationMs }. Süre bilinmiyorsa dosyadan okunur.
export async function loadStepAudio(fetchAudio, index, step) {
  const got = await fetchAudio(index, step)
  const audio = typeof got === 'string' ? { url: got, durationMs: 0 } : got
  if (audio.durationMs > 0) return audio
  const durationMs = await new Promise((resolve) => {
    const probe = new Audio()
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration * 1000) : 0)
    probe.onerror = () => resolve(0)
    probe.src = audio.url
  })
  return { url: audio.url, durationMs }
}
