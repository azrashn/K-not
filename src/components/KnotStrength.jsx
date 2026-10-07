import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'

const STATES = {
  SIKI: { label: 'SIKI', text: 'text-siki', dot: 'bg-siki', fill: 'bg-siki', tint: 'bg-siki-tint', line: 'border-siki-line' },
  GEVESEK: { label: 'GEVEŞEK', text: 'text-gevesek', dot: 'bg-gevesek', fill: 'bg-gevesek', tint: 'bg-gevesek-tint', line: 'border-gevesek-line' },
  KOPUK: { label: 'KOPUK', text: 'text-kopuk', dot: 'bg-kopuk', fill: 'bg-kopuk', tint: 'bg-kopuk-tint', line: 'border-kopuk-line' },
}

// Düğüm Gücü: yüzde yok. Her iddia için bir halka: tam / kısmi / boş.
export default function KnotStrength({ knot, claims, verified }) {
  const reduce = useReducedMotion()
  const s = STATES[knot.state]
  const key = verified ? knot.state : 'PENDING'

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 transition-colors duration-300 sm:px-5 ${
        verified ? `${s.tint} ${s.line}` : 'border-line bg-white/50'
      }`}
      role="status"
      aria-live="polite"
      data-knot={verified ? knot.state : 'pending'}
    >
      <span className="text-[12.5px] font-medium text-ink-3">Düğüm Gücü</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={key}
          initial={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.2, ease: EASE_OUT } }}
          exit={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)', transition: { duration: 0.1 } }}
          className={`inline-flex items-center gap-2 font-mono text-[12.5px] font-semibold tracking-wide ${verified ? s.text : 'text-ink-3'}`}
        >
          <span className={`size-2 rounded-full ${verified ? s.dot : 'bg-ink-3 breathe'}`} aria-hidden />
          {verified ? s.label : 'KONTROL EDİLİYOR'}
        </motion.span>
      </AnimatePresence>

      <span className={`min-w-0 flex-1 basis-56 text-[13.5px] ${verified ? 'text-ink' : 'text-ink-3'}`}>
        {verified ? knot.line : 'Her iddia kaynağıyla eşleştiriliyor…'}
      </span>

      <span className="flex items-center gap-1.5" aria-hidden>
        {claims.map((c, i) => {
          const level = c.gap || !c.cites.length ? 0 : c.cites.some((x) => x.strength === 'partial') ? 0.5 : 1
          return (
            <span key={c.id} className="relative h-1.5 w-7 overflow-hidden rounded-full bg-line-strong/60">
              {verified && level > 0 && (
                <motion.span
                  className={`absolute inset-y-0 left-0 rounded-full ${s.fill}`}
                  style={{ width: `${level * 100}%`, transformOrigin: 'left' }}
                  initial={{ scaleX: reduce ? 1 : 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.3, delay: reduce ? 0 : 0.06 * i, ease: EASE_OUT }}
                />
              )}
            </span>
          )
        })}
      </span>
    </div>
  )
}
