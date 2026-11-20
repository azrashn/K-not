import { ArrowCounterClockwise, ArrowClockwise, CaretLeft, CaretRight, FastForward, Pause, Play, SpeakerHigh, SpeakerSlash, Student } from '@phosphor-icons/react'

function Control({ icon: Icon, children, ...rest }) {
  return (
    <button type="button" className="board-control press" {...rest}>
      <Icon size={14} weight="bold" aria-hidden />
      {children}
    </button>
  )
}

// Tahtanın üstündeki düğmeler. Hepsi useBoardPlayer'ın tek oynatma durumunu kullanır.
export function BoardToolbar({ board, teacher, onTeacher }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Control icon={board.playing ? Pause : Play} onClick={board.togglePlay}>{board.playing ? 'Duraklat' : 'Oynat'}</Control>
      <Control icon={ArrowCounterClockwise} onClick={board.restart}>Baştan oynat</Control>
      {board.ttsAvailable
        ? <Control icon={board.audioOn ? SpeakerHigh : SpeakerSlash} aria-pressed={board.audioOn} onClick={board.toggleSound}>{board.audioOn ? 'Ses açık' : 'Ses kapalı'}</Control>
        : <span className="board-badge" title="Ses servisi henüz bağlı değil; adımlar okuma süresiyle akar.">Sessiz mod</span>}
      <Control icon={FastForward} aria-pressed={board.fast} title="Bütün adımları animasyonsuz göster" onClick={board.toggleFast}>Hızlı göster</Control>
      {onTeacher && <Control icon={Student} aria-pressed={teacher} onClick={onTeacher}>Öğretmen</Control>}
      {board.waiting && <span role="status" className="text-[12.5px] text-ink-3">Ses hazırlanıyor…</span>}
    </div>
  )
}

// Tahtanın altındaki altyazı, adım gezinmesi ve ilerleme çizgisi.
export function BoardCaption({ board }) {
  const { steps, active, current, finished, fast } = board
  const subtitle = !fast && active >= 0 ? steps[active] : null
  return (
    <div className="board-caption">
      <div className="flex flex-col gap-2 px-4 py-3">
        {subtitle ? (
          <div className="flex min-w-0 gap-3" aria-live="polite">
            <span className="shrink-0 pt-0.5 font-mono text-[11.5px] text-accent">{active + 1}/{steps.length}</span>
            <p className="m-0 min-w-0 text-[13.5px] leading-relaxed text-ink-2">{subtitle.speech}</p>
          </div>
        ) : (
          <p className="m-0 min-w-0 pt-0.5 text-[12.5px] text-ink-3">
            {finished || fast ? `${steps.length} adımın hepsi tahtada.` : `${steps.length} adım hazır.`}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1">
          <Control icon={CaretLeft} onClick={() => board.goTo(Math.max(0, current) - 1)} disabled={current <= 0} aria-label="Önceki adım">Önceki</Control>
          <Control icon={ArrowClockwise} onClick={() => board.goTo(Math.max(0, current))}>Bu adımı tekrar</Control>
          <Control icon={CaretRight} onClick={() => board.goTo(current < 0 ? 0 : current + 1)} disabled={current >= steps.length - 1} aria-label="Sonraki adım">Sonraki</Control>
        </div>
      </div>
      <div className="h-[2px] bg-hair" role="progressbar" aria-label="Anlatımın ilerlemesi" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(board.progress * 100)}>
        <div className="h-full bg-accent" style={{ width: `${board.progress * 100}%` }} />
      </div>
    </div>
  )
}
