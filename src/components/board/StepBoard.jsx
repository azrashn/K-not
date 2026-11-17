import { useEffect, useMemo, useRef, useState } from 'react'
import Board from './Board'
import TeacherStage from './TeacherStage'
import BoardSources, { StepSources } from './BoardSources'
import { BoardCaption, BoardToolbar } from './BoardControls'
import { useBoardPlayer } from '../../lib/board/player'
import { loadPrefs, savePrefs } from '../../lib/board/prefs'
import { stepSources } from '../../lib/board/sources'
import { speak, stepAudioFetcher } from '../../api/tts'
import { loadLocalVoice } from '../../lib/local-voice'
import { textLanguage } from '../../lib/speech'

const reducedMotion = () => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

// Adımların içeriğinden anahtar: yeni bir cevap gelince tahta baştan kurulur.
function stepsKey(steps) {
  let h = 0
  const text = JSON.stringify(steps)
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return `${steps.length}-${h}`
}

function StepBoardInner({ steps, evidence, onSource, fetchAudio, autoPlay, keyboardNav, showSourceList, prefs, setPrefs }) {
  const activity = useRef(null)
  const board = useBoardPlayer({
    steps,
    fetchAudio,
    autoPlay,
    prefs,
    onPrefsChange: setPrefs,
    keyboardNav,
    activityRef: prefs.teacher ? activity : undefined,
  })
  const { wrapperRef, boardRef, stepRefs } = board
  const rows = useMemo(() => stepSources(board.steps, evidence), [board.steps, evidence])
  const byStep = useMemo(() => new Map(rows.map((r) => [r.step, r.items])), [rows])
  const pick = onSource ? (step) => (item) => onSource(item, step) : () => undefined

  return (
    <div ref={wrapperRef} className="space-y-3">
      <BoardToolbar board={board} teacher={prefs.teacher} onTeacher={() => setPrefs({ teacher: !prefs.teacher })} />
      <div className={showSourceList && rows.length ? 'board-layout' : ''}>
        <div className="min-w-0">
          <Board
            steps={board.steps}
            frames={board.frames}
            active={board.finished || board.fast ? -1 : board.active}
            animating={board.animating}
            showSpeech={board.fast}
            onSelect={board.goTo}
            scrollRef={boardRef}
            stepRefs={stepRefs}
            aside={prefs.teacher ? <TeacherStage source={activity} /> : null}
            renderSources={(step, i) => {
              const items = byStep.get(i) || []
              return items.length || step.quote ? <StepSources step={step} items={items} onSource={onSource ? pick(i) : undefined} /> : null
            }}
          />
          <BoardCaption board={board} />
        </div>
        {showSourceList && (
          <BoardSources
            rows={rows}
            active={board.finished || board.fast ? -1 : board.active}
            onStep={board.goTo}
            onSource={onSource ? (item) => onSource(item, rows.find((r) => r.items.includes(item))?.step ?? -1) : undefined}
          />
        )}
      </div>
    </div>
  )
}

// Cevabın tahtada adım adım anlatımı: tahta, öğretmen, oynatma ve kaynaklar.
// steps: cevabın adımları. evidence: cevabın kanıtları (kaynak eşleme için).
// onSource(resolved, stepIndex): kaynak tıklandı; resolved { source, label, evidence, ms, page, slide }.
// fetchAudio: (index, step) → url; verilmezse sunucudaki yerel ses kuruluysa /api/tts kullanılır, değilse sessiz mod.
// lang: verilmezse adımların dilinden bulunur (Türkçe adım Türkçe, İngilizce adım İngilizce sesle).
export default function StepBoard({
  steps,
  evidence = [],
  onSource,
  lang,
  fetchAudio,
  autoPlay = true,
  keyboardNav = true,
  showSourceList = true,
  className = '',
}) {
  const [prefs, setPrefsState] = useState(() => loadPrefs(reducedMotion()))
  const auto = fetchAudio === undefined
  const [voice, setVoice] = useState(null)
  useEffect(() => {
    if (!auto) return undefined
    let alive = true
    loadLocalVoice().then((s) => { if (alive) setVoice(s) })
    return () => { alive = false }
  }, [auto])
  const spoken = useMemo(
    () => lang || textLanguage((steps || []).map((s) => s.speech || s.board || '').join(' ')),
    [lang, steps],
  )
  const canSpeak = Boolean(voice?.available && voice.languages?.[spoken])
  const audio = useMemo(
    () => (auto ? stepAudioFetcher(spoken, speak, canSpeak) : fetchAudio),
    [auto, fetchAudio, spoken, canSpeak],
  )
  // Ses durumu bilinmeden anlatım başlamaz: yoksa sessiz başlayıp sonra baştan sesli başlardı.
  const key = useMemo(() => `${stepsKey(steps || [])}-${audio ? 'a' : 's'}`, [steps, audio])
  const setPrefs = (change) => setPrefsState((current) => {
    const next = { ...current, ...change }
    savePrefs(next)
    return next
  })
  if (!steps?.length) return null
  if (auto && voice === null) return <div className={`step-board ${className}`} role="status">Tahta hazırlanıyor…</div>
  return (
    <div className={`step-board ${className}`}>
      <StepBoardInner
        key={key}
        steps={steps}
        evidence={evidence}
        onSource={onSource}
        fetchAudio={audio}
        autoPlay={autoPlay}
        keyboardNav={keyboardNav}
        showSourceList={showSourceList}
        prefs={prefs}
        setPrefs={setPrefs}
      />
    </div>
  )
}
