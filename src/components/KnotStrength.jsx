import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'

const STATES = {
  SIKI: { label: 'SIKI', text: 'text-siki', color: 'var(--color-siki)', soft: 'var(--color-siki-tint)' },
  GEVESEK: { label: 'GEVEŞEK', text: 'text-gevesek', color: 'var(--color-gevesek)', soft: 'var(--color-gevesek-tint)' },
  KOPUK: { label: 'KOPUK', text: 'text-kopuk', color: 'var(--color-kopuk)', soft: 'var(--color-kopuk-tint)' },
}

const levelOf = (c) => (c.gap || !c.cites?.length ? 0 : c.cites.some((x) => x.strength === 'partial') ? 0.5 : 1)

// Düğüm Gücü simgesi: her iddia bir düğüm; aralarındaki ip kanıt gücünü anlatır.
//  SIKI → gergin ip + sıkı düğüm · GEVEŞEK → gevşek sarkan ip + açık ilmek · KOPUK → kopuk, uçları yıpranmış ip
export function KnotGlyph({ state, levels, verified, reduce }) {
  const s = STATES[state]
  const n = Math.max(1, levels.length)
  const step = 46
  const xs = levels.map((_, i) => 9 + i * step)
  const W = n === 1 ? 62 : xs[n - 1] + 12
  const col = verified ? s.color : 'var(--color-ink-3)'
  const d = (delay) => ({ duration: reduce ? 0 : 0.36, delay: reduce ? 0 : delay, ease: EASE_OUT })

  const segs = []
  for (let i = 0; i < n - 1; i++) {
    const a = xs[i] + 5
    const b = xs[i + 1] - 5
    const mid = (a + b) / 2
    const kind = levels[i] === 1 && levels[i + 1] === 1 ? 'tight' : levels[i] === 0 || levels[i + 1] === 0 ? 'broken' : 'loose'
    segs.push({ a, b, mid, kind, i })
  }
  const tail = n === 1 && levels[0] === 0

  return (
    <svg width={W} height="26" viewBox={`0 0 ${W} 26`} fill="none" aria-hidden className="shrink-0 overflow-visible">
      {!verified && <path d={`M${xs[0] + 6} 13H${W - 4}`} stroke={col} strokeWidth="1.4" strokeDasharray="1 4" strokeLinecap="round" className="breathe" />}
      {verified && segs.map(({ a, b, mid, kind, i }) => (
        <g key={i}>
          {kind === 'tight' && (
            <>
              <motion.path d={`M${a} 13H${b}`} stroke={col} strokeWidth="2" strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.circle cx={mid} cy="13" r="4.2" fill="var(--color-paper)" stroke={col} strokeWidth="2" initial={{ scale: reduce ? 1 : 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ transformOrigin: `${mid}px 13px` }} transition={d(0.28)} />
            </>
          )}
          {kind === 'loose' && (
            <>
              <motion.path d={`M${a} 13Q${mid} 25 ${b} 13`} stroke={col} strokeWidth="1.7" strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.circle cx={mid} cy="19" r="3.6" fill="var(--color-paper)" stroke={col} strokeWidth="1.5" strokeDasharray="4 2.6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={d(0.3)} />
            </>
          )}
          {kind === 'broken' && (
            <>
              <motion.path d={`M${a} 13H${mid - 6}M${mid - 6} 13l5-4.2M${mid - 6} 13h6M${mid - 6} 13l5 4.2`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.path d={`M${mid + 5} 13H${mid + 9}`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeDasharray="1 4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={d(0.25)} />
            </>
          )}
        </g>
      ))}
      {verified && tail && (
        <motion.path d={`M${xs[0] + 6} 13h20M${xs[0] + 26} 13l5-4.2M${xs[0] + 26} 13h6M${xs[0] + 26} 13l5 4.2`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
      )}
      {xs.map((x, i) => {
        const l = verified ? levels[i] : 0
        return (
          <motion.g key={i} initial={{ scale: reduce ? 1 : 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ transformOrigin: `${x}px 13px` }} transition={d(0.04 * i)}>
            <circle cx={x} cy="13" r="5" fill={l === 1 ? col : l === 0.5 ? s.soft : 'var(--color-paper)'} stroke={col} strokeWidth="1.6" strokeDasharray={l === 0 && verified ? '2.4 2.2' : undefined} />
            {l === 0.5 && <path d={`M${x} 8a5 5 0 0 0 0 10z`} fill={col} />}
          </motion.g>
        )
      })}
    </svg>
  )
}

// Düğüm Gücü: sade bir imza. Yüzde yok; durum, tek cümle ve ip.
export default function KnotStrength({ knot, claims, verified }) {
  const reduce = useReducedMotion()
  const s = STATES[knot.state]
  const levels = claims.map(levelOf)
  const key = verified ? knot.state : 'PENDING'

  return (
    <div className="mt-5 flex items-center gap-4" role="status" aria-live="polite" data-knot={verified ? knot.state : 'pending'}>
      <KnotGlyph key={key} state={knot.state} levels={levels} verified={verified} reduce={reduce} />
      <div className="min-w-0">
        <p className="m-0 flex items-baseline gap-2.5">
          <span className="text-[12.5px] font-medium text-ink-3">Düğüm Gücü</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={key}
              initial={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.2, ease: EASE_OUT } }}
              exit={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)', transition: { duration: 0.1 } }}
              className={`font-mono text-[12.5px] font-semibold tracking-[0.04em] ${verified ? s.text : 'text-ink-3'}`}
            >
              {verified ? s.label : 'KONTROL EDİLİYOR'}
            </motion.span>
          </AnimatePresence>
        </p>
        <p className={`m-0 mt-0.5 text-[14px] ${verified ? 'text-ink-2' : 'text-ink-3'}`}>
          {verified ? knot.line : 'Her iddia kaynağıyla eşleştiriliyor…'}
        </p>
      </div>
    </div>
  )
}
