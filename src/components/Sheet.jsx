import { useEffect } from 'react'
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'framer-motion'
import { EASE_DRAWER } from '../lib/motion'

// Bottom sheet: sürükleyerek kapanır (hız + mesafe), Esc ile kapanır.
export default function Sheet({ open, onClose, children }) {
  const reduce = useReducedMotion()
  const controls = useDragControls()

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Kaynağı kapat"
            tabIndex={-1}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-ink/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Kaynak görüntüleyici"
            className="fixed inset-x-0 bottom-0 z-40 flex h-[84dvh] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-line-strong bg-desk shadow-[0_-16px_40px_-16px_rgba(22,24,30,0.35)]"
            initial={{ y: '100%' }}
            animate={{ y: 0, transition: { duration: reduce ? 0.15 : 0.34, ease: EASE_DRAWER } }}
            exit={{ y: '100%', transition: { duration: reduce ? 0.12 : 0.24, ease: EASE_DRAWER } }}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 500) onClose() }}
          >
            <div
              className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center bg-paper active:cursor-grabbing"
              onPointerDown={(e) => controls.start(e)}
              aria-hidden
            >
              <span className="h-1 w-9 rounded-full bg-line-strong" />
            </div>
            <div className="min-h-0 flex-1">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
