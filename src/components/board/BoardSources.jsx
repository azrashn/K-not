import { isResolved } from '../../lib/board/sources'

// Bir kaynak: çözüldüyse tıklanır ve ilgili ana / sayfaya gider; çözülemediyse yalnızca etiket.
export function SourceChip({ item, onSource }) {
  if (!isResolved(item) || !onSource) {
    return <span className="board-chip is-muted" title="Bu kaynak cevabın kanıtlarında bulunamadı">{item.label}</span>
  }
  return (
    <button type="button" className="board-chip press" onClick={() => onSource(item)} title={item.evidence?.title || undefined}>
      {item.label}
    </button>
  )
}

// Tahtada adımın altında: kaynaklar ve varsa kaynaktan kısa alıntı (tıklanınca ilk kaynağa gider).
export function StepSources({ step, items, onSource }) {
  const first = items.find(isResolved)
  const quote = typeof step.quote === 'string' ? step.quote.trim() : ''
  if (!items.length && !quote) return null
  return (
    <div className="space-y-1.5 pt-1">
      {quote && (
        first && onSource
          ? <button type="button" className="board-quote" onClick={() => onSource(first)}>“{quote}”</button>
          : <p className="board-quote">“{quote}”</p>
      )}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => <SourceChip key={i} item={item} onSource={onSource} />)}
        </div>
      )}
    </div>
  )
}

// Tahtanın yanında adım numaralarıyla eşleşen kaynak listesi. Numaraya tıklamak o adıma gider.
export default function BoardSources({ rows, active, onStep, onSource }) {
  if (!rows.length) return null
  return (
    <section aria-label="Adımların kaynakları" className="board-sources">
      <h3 className="m-0 px-3 pt-3 text-[12.5px] font-medium text-ink-3">Kaynaklar</h3>
      <ol className="m-0 list-none p-1.5">
        {rows.map(({ step, items }) => (
          <li key={step} className={`board-source-row ${step === active ? 'is-active' : ''}`}>
            <button type="button" className="board-source-step font-mono" onClick={() => onStep(step)} aria-label={`${step + 1}. adıma git`}>
              {step + 1}
            </button>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {items.map((item, i) => <SourceChip key={i} item={item} onSource={onSource} />)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
