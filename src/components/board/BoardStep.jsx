import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import Formula from './Formula'
import { boardSegments, formulaView } from '../../lib/board/content'
import { drawStrokes, markStrokes, mergeLineRects, revealAt, strokePath } from '../../lib/board/geometry'

// Metin öğesinin satır kutuları, öğeye göre.
function measureLines(el) {
  const origin = el.getBoundingClientRect()
  const range = document.createRange()
  range.selectNodeContents(el)
  const rects = Array.from(range.getClientRects?.() ?? []).map((r) => ({
    left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top,
  }))
  return mergeLineRects(rects)
}

// KaTeX formülünün görünen kutusu; el yazısıyla yazıldıysa satırları.
function measureFormula(el) {
  const target = el.querySelector('.katex-html')
  if (!target) return measureLines(el)
  const origin = el.getBoundingClientRect()
  const r = target.getBoundingClientRect()
  if (r.width === 0) return []
  return [{ left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top }]
}

// Boyut değişince ve fontlar yüklenince yeniden ölçer.
function useMeasured(ref, measure, key) {
  const [boxes, setBoxes] = useState([])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let alive = true
    const update = () => alive && setBoxes(measure(el))
    update()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null
    observer?.observe(el)
    document.fonts?.ready.then(update)
    return () => {
      alive = false
      observer?.disconnect()
    }
  }, [ref, measure, key])
  return boxes
}

// Yazılan satırın ucundaki kalem.
function Pen({ at }) {
  return (
    <svg aria-hidden data-board-pen="" viewBox="0 0 18 18" className="pointer-events-none absolute z-10 size-[18px]" style={{ left: at.x, top: at.y - 18 }}>
      <path d="M1 17 L3.5 11.5 L6.5 14.5 Z" className="fill-accent" />
      <path d="M3.5 11.5 L13 2 L16 5 L6.5 14.5 Z" className="fill-ink" opacity={0.85} />
    </svg>
  )
}

function Segments({ segments }) {
  return segments.map((s, i) => (s.kind === 'text' ? <span key={i}>{s.text}</span> : <Formula key={i} tex={s.tex} />))
}

// Tahtadaki tek adım: numara, el yazısı not, varsa formül ve vurgu; altında isteğe bağlı kaynaklar.
// frame: timeline.frameAt çıktısı. dimmed: başka bir adım anlatılıyor, bu biten adım geri çekilir.
export default function BoardStep({ step, index, frame, animating, showSpeech, dimmed, onSelect, itemRef, children }) {
  const textRef = useRef(null)
  const formulaRef = useRef(null)
  const segments = useMemo(() => boardSegments(step.board), [step.board])
  const formula = useMemo(() => formulaView(step.board, step.formula), [step.board, step.formula])
  const lines = useMeasured(textRef, measureLines, step.board)
  const formulaBox = useMeasured(formulaRef, measureFormula, formula)

  const text = revealAt(lines, frame.board)
  const formulaReveal = revealAt(formulaBox, frame.formula)
  const strokes = step.mark ? markStrokes(step.mark, lines) : []
  const drawn = drawStrokes(strokes, frame.mark)

  const writingBoard = animating && frame.phase === 'writing' && frame.board < 1
  const writingFormula = animating && frame.phase === 'writing' && frame.board >= 1
  const marking = animating && frame.phase === 'marking'

  return (
    <li ref={itemRef} data-active={frame.active || undefined} className={`board-step ${dimmed ? 'is-dimmed' : ''}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${index + 1}. adıma git`}
        aria-current={frame.active ? 'step' : undefined}
        className="board-step-number font-hand"
      >
        {index + 1}
      </button>
      <div className="min-w-0 flex-1 cursor-pointer space-y-1.5" onClick={onSelect}>
        <div className="relative">
          <p ref={textRef} className="board-hand font-hand" style={text.clip ? { clipPath: text.clip } : undefined}>
            <Segments segments={segments} />
          </p>
          {strokes.length > 0 && (
            <svg aria-hidden data-board-mark="" className="pointer-events-none absolute left-0 top-0 size-px overflow-visible">
              {strokes.map((stroke, i) => (
                <path
                  key={i}
                  d={strokePath(stroke)}
                  pathLength={1}
                  fill="none"
                  className="stroke-accent"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1 1"
                  strokeDashoffset={1 - drawn.each[i]}
                  opacity={drawn.each[i] > 0 ? 1 : 0}
                />
              ))}
            </svg>
          )}
          {writingBoard && text.pen && <Pen at={text.pen} />}
          {marking && drawn.pen && <Pen at={drawn.pen} />}
        </div>

        {formula && (
          <div className="relative">
            <div
              ref={formulaRef}
              className={formula.kind === 'text' ? 'board-hand font-hand' : 'board-formula w-fit max-w-full'}
              style={formulaReveal.clip ? { clipPath: formulaReveal.clip } : undefined}
            >
              {formula.kind === 'text' ? formula.text : <Formula tex={formula.tex} display />}
            </div>
            {writingFormula && formulaReveal.pen && <Pen at={formulaReveal.pen} />}
          </div>
        )}

        {showSpeech && <p className="text-[13.5px] leading-relaxed text-ink-2">{step.speech}</p>}

        {children && (
          // Gizliyken de yer kaplar; göründüğünde tahta zıplamaz.
          <div data-board-sources="" style={{ visibility: frame.sources ? 'visible' : 'hidden' }} onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        )}
      </div>
    </li>
  )
}
