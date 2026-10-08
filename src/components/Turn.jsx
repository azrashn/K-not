import { motion, useReducedMotion } from 'framer-motion'
import { Info, WarningCircle, ArrowClockwise } from '@phosphor-icons/react'
import { EASE_OUT } from '../lib/motion'
import { errorText } from '../api/messages'
import ClaimRow from './ClaimRow'
import KnotStrength from './KnotStrength'
import { Btn } from './ui'

function Searching({ count }) {
  return (
    <div className="flex items-center gap-3 py-2 text-[14.5px] text-ink-3" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className="breathe size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 160}ms` }} />)}
      </span>
      {count} materyalde kanıt aranıyor…
    </div>
  )
}

// Hizmet hatası: kanıt yokluğundan (KOPUK) ayrı. Yanıt üretilemedi; kaynaklar hakkında bir şey söylemez.
function ServiceError({ error, onRetry }) {
  return (
    <div role="alert" data-turn-error={error?.code} className="flex items-start gap-3 rounded-xl bg-ink/[0.04] px-4 py-3.5">
      <WarningCircle size={20} className="mt-0.5 shrink-0 text-ink-2" aria-hidden />
      <div className="min-w-0">
        <p className="m-0 text-[15px] font-medium text-ink">Yanıt alınamadı</p>
        <p className="m-0 mt-0.5 text-[14px] leading-relaxed text-ink-2">{errorText(error)}</p>
        {onRetry && error?.code !== 'NO_READY_DOCUMENTS' && (
          <Btn variant="soft" size="sm" className="mt-3" onClick={onRetry}><ArrowClockwise size={15} /> Tekrar sor</Btn>
        )}
      </div>
    </div>
  )
}

export default function Turn({ turn, activeId, onActivate, onRetry, activeCount }) {
  const reduce = useReducedMotion()
  const { question, status, id, answer, error } = turn
  const claims = answer?.claims ?? []
  const sources = answer ? new Set(claims.flatMap((c) => c.cites.map((x) => x.docId))).size : 0
  const meta = status !== 'ready'
    ? null
    : sources
      ? `${activeCount} materyalde arandı · ${sources} kaynakta bulundu`
      : `${activeCount} materyalde arandı · eşleşen kaynak yok`

  return (
    <motion.section
      aria-label={question}
      data-outcome={answer?.outcome ?? status}
      initial={{ opacity: 0, y: reduce ? 0 : 10 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
      className="py-10 first:pt-8"
    >
      <h2 className="display m-0 text-[30px] text-ink sm:text-[36px]">{question}</h2>
      <p className="m-0 mb-5 mt-2 h-5 text-[13px] text-ink-3">{meta}</p>

      {status === 'searching' && <Searching count={activeCount} />}
      {status === 'error' && <ServiceError error={error} onRetry={onRetry} />}
      {status === 'ready' && answer && (
        <>
          <div>
            {claims.map((c) => (
              <ClaimRow
                key={c.id}
                turnId={id}
                claim={c}
                active={activeId === `${id}:${c.id}`}
                onActivate={(claim, cite) => onActivate(id, claim, cite)}
              />
            ))}
          </div>
          {answer.outcome === 'PARTIALLY_ANSWERED' && (
            <p className="m-0 mt-3 text-[14px] leading-relaxed text-gevesek" data-partial-note>
              Soru yalnızca kısmen yanıtlanabildi.{answer.uncovered.length > 0 && <> Kaynaklarda karşılığı bulunmayan: <span className="font-medium">{answer.uncovered.join(', ')}</span>.</>}
            </p>
          )}
          <KnotStrength
            claims={claims}
            state={answer.state}
            heuristic={!answer.supportConfirmed}
            verified
            onActivate={(claim, cite) => onActivate(id, claim, cite)}
          />
          {answer.extractive && (
            <p className="m-0 mt-5 flex gap-2 text-[12.5px] leading-relaxed text-ink-3" data-extractive-note>
              <Info size={15} className="mt-px shrink-0" aria-hidden />
              <span>Deneysel yanıt üreticisi: bu yanıt üretken bir dil modeliyle değil, kaynaklardan cümle seçen çıkarımsal bir temel yöntemle oluşturuldu.</span>
            </p>
          )}
        </>
      )}
    </motion.section>
  )
}
