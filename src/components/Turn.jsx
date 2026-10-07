import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'
import ClaimRow from './ClaimRow'
import KnotStrength from './KnotStrength'
import NextSteps from './NextSteps'

function Searching({ count }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white/60 px-5 py-4 text-[14px] text-ink-3" role="status">
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
  const [verified, setVerified] = useState(!turn.fresh)

  useEffect(() => {
    if (status !== 'ready' || verified) return
    const t = setTimeout(() => setVerified(true), reduce ? 0 : 700)
    return () => clearTimeout(t)
  }, [status, verified, reduce])

  const scn = { ...scenario, onNearby: () => onAsk('AVL ağaçlarında denge nasıl sağlanır?') }

  return (
    <motion.section
      aria-label={scenario.question}
      initial={turn.fresh ? { opacity: 0, y: reduce ? 0 : 10 } : false}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
      className="py-8 first:pt-6"
    >
      <h2 className="m-0 mb-5 text-[24px] font-semibold leading-[1.2] text-ink sm:text-[26px]">{scenario.question}</h2>

      {status === 'searching' ? (
        <Searching count={activeCount} />
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-line-strong bg-surface">
            {scenario.claims.map((c) => (
              <ClaimRow
                key={c.id}
                turnId={id}
                claim={c}
                last={false}
                active={activeId === `${id}:${c.id}`}
                onActivate={(claim, cite) => onActivate(id, claim, cite)}
              />
            ))}
            <KnotStrength knot={scenario.knot} claims={scenario.claims} verified={verified} />
          </div>
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
