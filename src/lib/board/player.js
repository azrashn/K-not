import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { boardSteps, shownFormula } from './content'
import { activeStepAt, buildTimeline, DONE_FRAME, frameAt, TimelinePlayer } from './timeline'
import { audioDurations, loadStepAudio, pendingAudioAt, StepAudioLoader } from './audio'
import { IDLE_ACTIVITY, readStepTargets } from './activity'
import { POINT_SOURCES_MS } from '../teacher/director'

// Tahtanın tek oynatma durumu. Oynat/Duraklat, Baştan oynat, Bu adımı tekrar, önceki/sonraki,
// adıma tıklama ve klavye okları aynı durumu değiştirir. Ses varsa adım sesi kadar sürer ve
// tahta sesin saatini izler; yoksa adım okuma süresi kadar sürer.

// Ses saati tahtanınkinden bu kadar (ms) saparsa tahta sese uyar.
const AUDIO_DRIFT_MS = 120

// Tahtanın içinde o an yazılan adımı görünür tutar.
function keepInBoard(board, item) {
  const top = item.offsetTop - 12
  const bottom = item.offsetTop + item.offsetHeight + 12
  const viewTop = board.scrollTop
  const viewBottom = viewTop + board.clientHeight
  let target = null
  if (bottom > viewBottom) target = Math.min(top, bottom - board.clientHeight)
  else if (top < viewTop) target = top
  if (target !== null) board.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
}

// Önceden yazılmış bir adıma dönülünce öğretmenin onu göstereceği nokta.
function stepTextCenter(item) {
  const r = (item?.querySelector('p') ?? item)?.getBoundingClientRect()
  if (!r || r.width === 0) return null
  return { x: r.left + Math.min(r.width, 160) / 2, y: (r.top + r.bottom) / 2 }
}

export function useBoardPlayer({ steps: rawSteps, fetchAudio, autoPlay = true, prefs, onPrefsChange, keyboardNav = true, activityRef }) {
  const ttsAvailable = Boolean(fetchAudio)
  const fetchAudioRef = useRef(fetchAudio)
  useLayoutEffect(() => { fetchAudioRef.current = fetchAudio })
  const fast = prefs.fast
  const audioOn = ttsAvailable && prefs.audio
  const steps = useMemo(() => boardSteps(rawSteps), [rawSteps])
  const timelineSteps = useMemo(() => steps.map((s) => ({ ...s, formula: shownFormula(s.board, s.formula) })), [steps])

  // Ses yalnızca anlatım oynatılınca istenir (geçmişteki her cevap için değil).
  const [statuses, setStatuses] = useState(() => steps.map(() => ({ state: 'idle' })))
  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const loaderRef = useRef(null)
  const audioRef = useRef(null)
  const audioStepRef = useRef(-1)

  const durationKey = audioOn ? audioDurations(statuses).join(',') : 'off'
  const timeline = useMemo(
    () => buildTimeline(timelineSteps, audioOn ? { durationsMs: audioDurations(statusesRef.current) } : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- durationKey süreleri temsil eder
    [timelineSteps, durationKey, audioOn],
  )

  const eventHandler = useRef(() => {})
  const playerRef = useRef(null)
  if (!playerRef.current) {
    playerRef.current = new TimelinePlayer(timeline, undefined, (e) => eventHandler.current(e))
    if (!autoPlay) playerRef.current.seek(timeline.totalMs)
  }
  const player = playerRef.current

  const [position, setPosition] = useState(() => player.position())
  // Bu adıma kadar olanlar bir kez yazıldı; geri gidince silinmez.
  const [revealed, setRevealed] = useState(autoPlay ? -1 : rawSteps.length - 1)
  const revealedRef = useRef(revealed)
  revealedRef.current = revealed
  // Öğrenci anlatımın akmasını istiyor (ses bekleniyor olabilir).
  const [playing, setPlaying] = useState(false)
  const boardRef = useRef(null)
  const wrapperRef = useRef(null)
  const stepRefs = useRef([])

  const stopAudio = () => audioRef.current?.pause()

  // Etkin adımın sesini tahtanın olduğu yerden çalar ya da durdurur.
  function syncAudio() {
    if (!audioOn || !player.playing) return stopAudio()
    const p = player.position()
    const i = activeStepAt(player.timeline, p)
    const status = statusesRef.current[i]
    if (i < 0 || status?.state !== 'ready' || !status.url || !status.durationMs) return stopAudio()
    const offsetMs = p - player.timeline.steps[i].start
    if (offsetMs >= status.durationMs) return stopAudio()
    const el = (audioRef.current ??= new Audio())
    if (audioStepRef.current !== i) {
      el.src = status.url
      audioStepRef.current = i
    }
    if (Math.abs(el.currentTime * 1000 - offsetMs) > AUDIO_DRIFT_MS * 2) el.currentTime = offsetMs / 1000
    if (el.paused) {
      el.play().catch(() => {
        // Tarayıcı tıklamasız sese izin vermedi: "Oynat" beklenir.
        player.pause()
        setPlaying(false)
      })
    }
  }

  useLayoutEffect(() => {
    eventHandler.current = (e) => { if (e.type === 'start') syncAudio() }
  })

  // Yeni çizelge (ses süreleri geldi ya da ses açıldı/kapandı) aynı yerde.
  const audioOnRef = useRef(audioOn)
  useLayoutEffect(() => {
    if (player.timeline === timeline) return
    const old = player.timeline
    const finished = player.position() >= old.totalMs
    const step = activeStepAt(old, player.position())
    player.replaceTimeline(timeline)
    if (finished && !player.playing) player.seek(timeline.totalMs)
    else if (audioOnRef.current !== audioOn && step >= 0) {
      // Ses açıldı ya da kapandı: o adım yeni süresiyle baştan.
      player.seek(timeline.steps[step].start)
      audioStepRef.current = -1
      syncAudio()
    }
    audioOnRef.current = audioOn
    setPosition(player.position())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline])

  // Anlatım sesli oynarken ses getirilir (önce ilk adım).
  useEffect(() => {
    if (!playing || !audioOn || loaderRef.current) return
    const fetchNow = fetchAudioRef.current
    if (!fetchNow) return
    loaderRef.current = new StepAudioLoader(steps.length, (i) => loadStepAudio(fetchNow, i, steps[i]), setStatuses)
    void loaderRef.current.start()
  }, [playing, audioOn, steps])

  useEffect(() => () => {
    audioRef.current?.pause()
    loaderRef.current?.dispose()
    loaderRef.current = null
  }, [])

  // Yeni cevap bir kez başlar; "Hızlı göster" açıksa bitmiş hâliyle gösterilir.
  const started = useRef(false)
  useEffect(() => {
    if (started.current || !autoPlay) return
    started.current = true
    if (fast) player.seek(player.timeline.totalMs)
    else setPlaying(true)
    setPosition(player.position())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Oynarken her karede bir çizim. Ses varsa tahta adımın sesini bekler ve sesin saatini izler.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      let p = player.tick()
      if (player.finished) {
        setPosition(p)
        setPlaying(false)
        stopAudio()
        return
      }
      const waitFor = audioOn ? pendingAudioAt(player.timeline, p, statusesRef.current) : -1
      if (waitFor >= 0) {
        if (player.playing) {
          player.pause()
          stopAudio()
        }
      } else if (!player.playing) {
        player.play()
        syncAudio()
      } else {
        const el = audioRef.current
        const i = activeStepAt(player.timeline, p)
        if (audioOn && el && !el.paused && audioStepRef.current === i) {
          const target = player.timeline.steps[i].start + el.currentTime * 1000
          if (Math.abs(target - p) > AUDIO_DRIFT_MS) {
            player.sync(target)
            p = player.tick()
          }
        }
      }
      setPosition(p)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audioOn])

  const shownAt = fast ? timeline.totalMs : position
  const timelineFrames = frameAt(timeline, shownAt)
  const active = activeStepAt(timeline, shownAt)
  const finished = shownAt >= timeline.totalMs
  const waiting = playing && audioOn && pendingAudioAt(timeline, shownAt, statuses) >= 0

  // Bir kez biten adımlar yazılı kalır: geri gidince sonrakiler silinmez.
  let lastDone = -1
  timelineFrames.forEach((f, i) => { if (f.phase === 'done') lastDone = i })
  useEffect(() => {
    if (lastDone > revealed) setRevealed(lastDone)
  }, [lastDone, revealed])
  const frames = timelineFrames.map((f, i) => (i <= revealed ? { ...DONE_FRAME, active: f.active } : f))

  // Anlatılan adım tahtada ve sayfada görünür kalsın.
  useEffect(() => {
    if (!playing || fast || active < 0) return
    const item = stepRefs.current[active]
    if (boardRef.current && item) keepInBoard(boardRef.current, item)
    wrapperRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [active, playing, fast])

  function play() {
    if (fast) onPrefsChange({ fast: false })
    if (player.finished) {
      player.seek(0)
      setPosition(0)
    }
    audioStepRef.current = -1
    setPlaying(true)
  }

  function togglePlay() {
    if (playing) {
      player.pause()
      stopAudio()
      setPlaying(false)
      setPosition(player.position())
    } else play()
  }

  // Her zaman 1. adımdan, tahta yeniden yazılır.
  function restart() {
    player.pause()
    stopAudio()
    player.seek(0)
    setRevealed(-1)
    setPosition(0)
    if (fast) onPrefsChange({ fast: false })
    audioStepRef.current = -1
    setPlaying(true)
  }

  // Bir adıma git: anlatım o adımın başından oynar ve sonrakilerle devam eder. Yazılı hiçbir şey silinmez.
  function goTo(i) {
    if (i < 0 || i >= steps.length) return
    stopAudio()
    player.pause()
    player.seek(timeline.steps[i].start)
    audioStepRef.current = -1
    setPosition(player.position())
    if (fast) onPrefsChange({ fast: false })
    setPlaying(true)
  }
  const goToRef = useRef(goTo)
  const currentRef = useRef(active)
  useLayoutEffect(() => {
    goToRef.current = goTo
    currentRef.current = active
  })

  useEffect(() => {
    if (!keyboardNav) return
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Yazı yazarken ya da videonun kendi ← / → tuşları için dokunma.
      const target = e.target instanceof Element ? e.target : null
      if (target?.closest('input, textarea, select, [contenteditable=true], video')) return
      e.preventDefault()
      const from = currentRef.current < 0 ? 0 : currentRef.current
      goToRef.current(e.key === 'ArrowLeft' ? from - 1 : from + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboardNav])

  function toggleSound() {
    const audio = !prefs.audio
    onPrefsChange({ audio })
    if (!audio) stopAudio()
  }

  function toggleFast() {
    const next = !fast
    onPrefsChange({ fast: next })
    if (next) {
      player.pause()
      player.seek(player.timeline.totalMs)
      stopAudio()
      setPlaying(false)
      setPosition(player.timeline.totalMs)
      boardRef.current?.scrollTo({ top: 0 })
    }
  }

  // Tahtanın o anki işi; öğretmen her karede okur (kalem, vurgu ve kaynaklar DOM'dan).
  const running = playing && !fast
  useLayoutEffect(() => {
    if (!activityRef) return
    activityRef.current = () => {
      const p = player.position()
      const tl = player.timeline
      const step = activeStepAt(tl, p)
      const audio = audioOn ? audioRef.current : null
      const waitingNow = running && audioOn && pendingAudioAt(tl, p, statusesRef.current) >= 0
      if (!running || step < 0) return { ...IDLE_ACTIVITY, playing: running, waiting: waitingNow, soundOn: audioOn, audio }
      const timing = tl.steps[step]
      const sinceStart = p - timing.start
      if (step <= revealedRef.current && sinceStart < POINT_SOURCES_MS) {
        // Tahtada zaten yazılı bir adıma dönüldü: öğretmen önce onu gösterir.
        return { playing: true, waiting: waitingNow, step, phase: 'done', pen: null, mark: null, sources: stepTextCenter(stepRefs.current[step]), sinceSourcesMs: sinceStart, soundOn: audioOn, audio }
      }
      return {
        playing: true,
        waiting: waitingNow,
        step,
        phase: frameAt(tl, p)[step].phase,
        ...readStepTargets(stepRefs.current[step] ?? null),
        sinceSourcesMs: p >= timing.sourcesAt ? p - timing.sourcesAt : null,
        soundOn: audioOn,
        audio,
      }
    }
  })
  useEffect(() => () => { if (activityRef) activityRef.current = null }, [activityRef])

  return {
    steps,
    frames,
    active,
    current: active,
    finished,
    playing,
    waiting,
    fast,
    audioOn,
    ttsAvailable,
    animating: playing && !waiting && !fast,
    progress: timeline.totalMs > 0 ? Math.min(1, shownAt / timeline.totalMs) : 1,
    boardRef,
    wrapperRef,
    stepRefs,
    togglePlay,
    restart,
    goTo,
    toggleSound,
    toggleFast,
  }
}
