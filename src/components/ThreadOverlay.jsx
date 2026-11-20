import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'

// CLAIM → KNOT → SOURCE. İplik yalnızca etkinleştirme anında çizilir, sonra çözülür.
export default function ThreadOverlay({ trigger, enabled }) {
  const [geo, setGeo] = useState(null)

  useEffect(() => {
    if (!enabled || !trigger.n) return
    let alive = true
    let tries = 0
    const timers = []

    const attempt = () => {
      if (!alive) return
      const pill = document.querySelector(`[data-pill="${trigger.key}"]`)
      const mark = document.querySelector('[data-evidence-mark]')
      const frame = document.querySelector('[data-viewer-scroll]')
      if (!pill || !mark || !frame) {
        if (tries++ < 10) timers.push(setTimeout(attempt, 70))
        return
      }
      const p = pill.getBoundingClientRect()
      const m = mark.getClientRects()[0] || mark.getBoundingClientRect()
      const f = frame.getBoundingClientRect()
      const x1 = p.right + 1
      const y1 = p.top + p.height / 2
      const x2 = Math.max(m.left - 7, f.left + 6)
      const y2 = Math.min(Math.max(m.top + m.height / 2, f.top + 18), f.bottom - 18)
      const dx = Math.max(56, Math.abs(x2 - x1) * 0.5)
      // Hafif sarkan iplik: kontrol noktaları aşağı kayık
      const sag = Math.min(26, Math.abs(y2 - y1) * 0.12 + 14)
      setGeo({
        id: trigger.n,
        d: `M${x1} ${y1} C${x1 + dx} ${y1 + sag}, ${x2 - dx} ${y2 + sag}, ${x2} ${y2}`,
        x1, y1, x2, y2,
      })
      timers.push(setTimeout(() => alive && setGeo(null), 1500))
    }

    timers.push(setTimeout(attempt, trigger.delay ?? 340))
    return () => {
      alive = false
      timers.forEach(clearTimeout)
    }
  }, [trigger, enabled])

  return (
    <svg className="pointer-events-none fixed inset-0 z-50 h-full w-full" aria-hidden>
      <AnimatePresence>
        {geo && (
          <motion.g key={geo.id} exit={{ opacity: 0, transition: { duration: 0.32, ease: EASE_OUT } }}>
            <motion.circle
              cx={geo.x1} cy={geo.y1} r="3.2" fill="var(--color-accent)"
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
              style={{ transformOrigin: `${geo.x1}px ${geo.y1}px` }}
              transition={{ duration: 0.16, ease: EASE_OUT }}
            />
            <motion.path
              d={geo.d} fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0.95 }} animate={{ pathLength: 1 }}
              transition={{ duration: 0.44, ease: EASE_OUT }}
            />
            {/* Düğüm: iplik kanıta ulaştığında oturur */}
            <motion.g
              initial={{ opacity: 0, scale: 0.55 }} animate={{ opacity: 1, scale: 1 }}
              style={{ transformOrigin: `${geo.x2}px ${geo.y2}px` }}
              transition={{ delay: 0.36, duration: 0.22, ease: EASE_OUT }}
            >
              <circle cx={geo.x2} cy={geo.y2} r="9" fill="none" stroke="var(--color-accent)" strokeOpacity="0.35" strokeWidth="1.2" />
              <circle cx={geo.x2} cy={geo.y2} r="3.8" fill="var(--color-accent)" />
            </motion.g>
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  )
}
