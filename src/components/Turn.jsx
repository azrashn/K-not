import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'
import ClaimRow from './ClaimRow'
import KnotStrength, { analyze } from './KnotStrength'
import { useApp } from '../app/store'
import NextSteps from './NextSteps'

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

export default function Turn({ turn, activeId, onActivate, onAsk, activeCount }) {
  const reduce = useReducedMotion()
  const { scenario, status, id } = turn
  const { dispatch } = useApp()
  const [verified, setVerified] = useState(!turn.fresh)
  const counted = useRef(false)

  useEffect(() => {
    if (status !== 'ready' || verified) return
    const t = setTimeout(() => setVerified(true), reduce ? 0 : 700)
    return () => clearTimeout(t)
  }, [status, verified, reduce])

  const scn = { ...scenario, onNearby: () => onAsk('AVL ağaçlarında denge nasıl sağlanır?') }
  const claims = scenario.claims.map((c, i) => ({ ...c, n: i + 1, tag: c.unsupported ? `İddia ${i + 1}` : c.gap ? 'Yanıt' : `İddia ${i + 1}` }))
  const knotState = analyze(claims).state

  // Kaynak Güveni: taze yanıtın kanıt durumu Analitik'e işlenir.
  useEffect(() => {
    if (turn.fresh && verified && !counted.current) {
      counted.current = true
      dispatch({ type: 'ASKED', state: knotState, question: scenario.question })
    }
  }, [turn.fresh, verified, knotState, dispatch, scenario.question])
  const sources = new Set(claims.flatMap((c) => c.cites.map((x) => x.doc))).size
  const meta = status === 'searching'
    ? null
    : sources
      ? `${activeCount} materyalde arandı · ${sources} kaynakta bulundu`
      : `${activeCount} materyalde arandı · eşleşen kaynak yok`

  return (
    <motion.section
      aria-label={scenario.question}
      initial={turn.fresh ? { opacity: 0, y: reduce ? 0 : 10 } : false}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
      className="py-10 first:pt-8"
    >
      <h2 className="display m-0 text-[30px] text-ink sm:text-[36px]">{scenario.question}</h2>
      <p className="m-0 mb-5 mt-2 h-5 text-[13px] text-ink-3">{meta}</p>

      {status === 'searching' ? (
        <Searching count={activeCount} />
      ) : (
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
          <KnotStrength claims={claims} verified={verified} onActivate={(claim, cite) => onActivate(id, claim, cite)} />
          {verified && (
            <motion.div initial={turn.fresh ? { opacity: 0 } : false} animate={{ opacity: 1, transition: { duration: 0.24, ease: EASE_OUT } }}>
              <NextSteps
                turnId={id}
                scenario={scn}
                activeId={activeId?.startsWith(`${id}:`) ? activeId.slice(id.length + 1) : null}
                onActivate={(claim, cite) => onActivate(id, claim, cite)}
              />
            </motion.div>
          )}
        </>
      )}
    </motion.section>
  )
}
