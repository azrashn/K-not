// Tahtanın animasyonu bir zaman çizelgesi olarak.
// Her adımın sırayla beş olayı vardır: start (adım başlar, altyazı görünür) → write (not ve formül
// yazılır) → mark (vurgu çizilir) → sources (kaynaklar görünür) → end. Tahta `frameAt(timeline, t)`
// ile çizilir; oynatma, duraklatma, atlama ve "hızlı göster" aynı koddur.
// Adımın süresi sesi varsa sesin süresidir (not sesin ilk yarısında yazılır), yoksa altyazının
// okuma süresidir.

export const READING_CHARS_PER_SEC = 15
export const MIN_STEP_MS = 3000
export const WRITE_LEAD_MS = 250
export const WRITE_MS_PER_CHAR = 55
export const MIN_WRITE_MS = 600
export const WRITE_SHARE = 0.5
// Formül, LaTeX kaynağından daha az karakter sayılır.
export const FORMULA_CHAR_WEIGHT = 0.5
export const MARK_MS = 700
// Kaynaklar sonraki adımdan önce en az bu kadar görünür kalır.
export const SOURCES_HOLD_MS = 700

export function readingTimeMs(text) {
  const chars = text.trim().length
  return Math.max(MIN_STEP_MS, Math.round((chars / READING_CHARS_PER_SEC) * 1000))
}

// steps: [{ board, speech, formula?, mark? }]. durationsMs: adım başına ses süresi (yoksa okuma süresi).
export function buildTimeline(steps, { durationsMs } = {}) {
  const timings = []
  const events = []
  let t = 0
  steps.forEach((step, i) => {
    const given = durationsMs?.[i]
    const fromAudio = given != null && given > 0
    const duration = fromAudio ? given : readingTimeMs(step.speech)

    const boardChars = step.board.trim().length
    const formulaChars = (step.formula?.trim().length ?? 0) * FORMULA_CHAR_WEIGHT
    const chars = boardChars + formulaChars
    const writeMs = chars === 0 ? 0
      : fromAudio ? Math.max(MIN_WRITE_MS, duration * WRITE_SHARE)
        : Math.max(MIN_WRITE_MS, Math.min(chars * WRITE_MS_PER_CHAR, duration * WRITE_SHARE))

    const start = t
    const writeStart = start + WRITE_LEAD_MS
    const writeEnd = writeStart + writeMs
    const boardEnd = chars > 0 ? writeStart + writeMs * (boardChars / chars) : writeStart
    const markEnd = writeEnd + (step.mark ? MARK_MS : 0)
    const sourcesAt = markEnd
    const end = Math.max(start + duration, sourcesAt + SOURCES_HOLD_MS)

    timings.push({ start, writeStart, boardEnd, writeEnd, markEnd, sourcesAt, end })
    events.push({ at: start, step: i, type: 'start' })
    events.push({ at: writeStart, step: i, type: 'write' })
    if (step.mark) events.push({ at: writeEnd, step: i, type: 'mark' })
    events.push({ at: sourcesAt, step: i, type: 'sources' })
    events.push({ at: end, step: i, type: 'end' })
    t = end
  })
  return { steps: timings, events, totalMs: t }
}

function progress(t, from, to) {
  if (t <= from) return 0
  if (t >= to) return 1
  return (t - from) / (to - from)
}

export const HIDDEN_FRAME = { phase: 'hidden', board: 0, formula: 0, mark: 0, sources: false, active: false }
export const DONE_FRAME = { phase: 'done', board: 1, formula: 1, mark: 1, sources: true, active: false }

// `t` anında her adımın görünümü. phase: hidden | starting | writing | marking | done.
export function frameAt(timeline, t) {
  const finished = t >= timeline.totalMs
  return timeline.steps.map((s, i) => {
    if (t < s.start) return HIDDEN_FRAME
    const board = progress(t, s.writeStart, s.boardEnd)
    const formula = progress(t, s.boardEnd, s.writeEnd)
    const mark = s.markEnd > s.writeEnd ? progress(t, s.writeEnd, s.markEnd) : t >= s.writeEnd ? 1 : 0
    const phase = t < s.writeStart ? 'starting' : t < s.writeEnd ? 'writing' : t < s.markEnd ? 'marking' : 'done'
    // Tahta bitince son adım etkin kalır, altyazısı görünsün.
    const active = finished ? i === timeline.steps.length - 1 : t < s.end
    return { phase, board, formula, mark, sources: t >= s.sourcesAt, active }
  })
}

export const eventsBetween = (timeline, from, to) => timeline.events.filter((e) => e.at > from && e.at <= to)

// `t` anında anlatılan adım (bitince sonuncusu), ilkinden önce -1.
export function activeStepAt(timeline, t) {
  if (timeline.steps.length === 0 || t < 0) return -1
  for (let i = 0; i < timeline.steps.length; i++) if (t < timeline.steps[i].end) return i
  return timeline.steps.length - 1
}

// Zaman çizelgesini bir saate karşı oynatır. `now` dışarıdan verilebilir (test, ses saati).
// `tick()` konumu döndürür ve son tick'ten beri geçilen olayları bildirir; `seek` atladığı olayları bildirmez.
export class TimelinePlayer {
  constructor(timeline, now = () => performance.now(), onEvent) {
    this.timeline = timeline
    this.now = now
    this.onEvent = onEvent
    this.origin = 0
    this.pausedAt = 0
    this.last = 0
    this.playing = false
  }

  position() {
    const p = this.playing ? this.now() - this.origin : this.pausedAt
    return Math.min(Math.max(p, 0), this.timeline.totalMs)
  }

  get finished() {
    return this.position() >= this.timeline.totalMs
  }

  play() {
    if (this.playing) return
    if (this.pausedAt >= this.timeline.totalMs) this.seek(0)
    this.origin = this.now() - this.pausedAt
    this.playing = true
    if (this.pausedAt === 0 && this.last === 0) this.emit(-1, 0) // ilk adımın start olayı
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = this.position()
    this.playing = false
  }

  // Aynı konumda yeni bir çizelge: sonraki adımların sesi geldikçe süreler değişir.
  replaceTimeline(timeline) {
    const p = Math.min(this.position(), timeline.totalMs)
    this.timeline = timeline
    if (this.playing) this.origin = this.now() - p
    else this.pausedAt = p
    this.last = Math.min(this.last, timeline.totalMs)
  }

  // Saati `ms`'ye taşır (ses çalarken saat sestedir); `seek`ten farkı aradaki olaylar yine bildirilir.
  sync(ms) {
    const p = Math.min(Math.max(ms, 0), this.timeline.totalMs)
    if (this.playing) this.origin = this.now() - p
    else this.pausedAt = p
  }

  seek(ms) {
    const p = Math.min(Math.max(ms, 0), this.timeline.totalMs)
    this.pausedAt = p
    this.origin = this.now() - p
    this.last = p
  }

  tick() {
    const p = this.position()
    if (p > this.last) this.emit(this.last, p)
    this.last = p
    if (this.playing && p >= this.timeline.totalMs) {
      this.pausedAt = p
      this.playing = false
    }
    return p
  }

  emit(from, to) {
    if (!this.onEvent) return
    for (const e of eventsBetween(this.timeline, from, to)) this.onEvent(e)
  }
}
