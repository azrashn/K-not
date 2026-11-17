import BoardStep from './BoardStep'
import { DONE_FRAME } from '../../lib/board/timeline'

// Tahta yüzeyi ve adımlar. Oynatmayı bilmez: her adımın görünümü `frames` ile gelir
// (timeline.frameAt). `frames` verilmezse tahta bitmiş hâliyle çizilir.
// steps: boardSteps() ile hazırlanmış adımlar. aside: tahtanın sağında duran öğretmen.
export default function Board({
  steps,
  frames,
  active = -1,
  animating = false,
  showSpeech = false,
  onSelect,
  aside,
  scrollRef,
  stepRefs,
  renderSources,
}) {
  const shown = frames || steps.map(() => DONE_FRAME)
  return (
    <div className="board-surface">
      <div ref={scrollRef} className={`board-scroll scroll-quiet ${aside ? 'has-aside' : ''}`}>
        <ol className="m-0 list-none space-y-5 p-0">
          {steps.map((step, i) => shown[i].phase === 'hidden' ? null : (
            <BoardStep
              key={i}
              itemRef={stepRefs ? (el) => void (stepRefs.current[i] = el) : undefined}
              step={step}
              index={i}
              frame={shown[i]}
              animating={animating}
              showSpeech={showSpeech}
              dimmed={active >= 0 && i !== active}
              onSelect={() => onSelect?.(i)}
            >
              {renderSources?.(step, i)}
            </BoardStep>
          ))}
        </ol>
      </div>
      {aside && <div className="board-aside">{aside}</div>}
    </div>
  )
}
