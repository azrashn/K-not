import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CaretDown, List } from '@phosphor-icons/react'
import { TYPE_LABEL } from '../data/academic'
import { EASE_OUT } from '../lib/motion'

export default function Header({ onMenu, showMenu, course, materials, onBack }) {
  const ready = materials.filter((m) => m.status === 'ready')
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 bg-paper px-4 sm:px-6">
      {showMenu && (
        <button type="button" onClick={onMenu} aria-label="Menüyü aç" className="press -ml-1 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white">
          <List size={20} />
        </button>
      )}
      {onBack && (
        <>
          <button type="button" onClick={onBack} className="press -ml-1 hidden h-8 items-center rounded-md px-1.5 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink sm:inline-flex">Dersler</button>
          <span aria-hidden className="hidden text-ink-3/60 sm:inline">/</span>
        </>
      )}
      <div ref={wrap} className="relative min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen((o) => !o)}
          className="press -ml-2 flex max-w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white"
          style={{ width: 'fit-content' }}
        >
          <span className="truncate text-[14px] font-semibold text-ink" style={{ letterSpacing: '-0.01em' }}>
            {course.name} <span className="font-normal text-ink-3">· {ready.length} materyal aktif</span>
          </span>
          <CaretDown size={13} className={`shrink-0 text-ink-3 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              role="dialog"
              aria-label="Aktif materyaller"
              initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -4 }}
              animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.16, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              style={{ transformOrigin: 'top left' }}
              className="absolute left-0 top-full z-30 mt-1.5 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line-strong bg-white shadow-[0_12px_32px_-12px_rgba(22,24,30,0.28)]"
            >
              <p className="m-0 border-b border-line px-3.5 py-2.5 text-[12.5px] text-ink-3">
                Yanıtlar yalnızca bu {ready.length} materyalden üretilir.
              </p>
              <ul className="scroll-quiet m-0 max-h-72 list-none overflow-y-auto p-1.5">
                {ready.map((m) => (
                  <li key={m.name} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-paper">
                    <span className="w-[4.2rem] shrink-0 font-mono text-[10.5px] font-medium uppercase text-ink-3">{TYPE_LABEL[m.type]}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{m.name}</span>
                    <span className="font-mono text-[11px] text-ink-3 num">{m.pages} s.</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  )
}
