import { AnimatePresence, motion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'

export default function Toast({ message }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4" role="status" aria-live="polite">
      <AnimatePresence>
        {message && (
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.14 } }}
            className="m-0 rounded-lg bg-ink px-3.5 py-2 text-[13px] text-white shadow-[0_8px_24px_-8px_rgba(22,24,30,0.5)]"
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
