// Emil Kowalski ilkeleri: güçlü ease-out, hızlı çıkış, ease-in yok.
export const EASE_OUT = [0.23, 1, 0.32, 1]
export const EASE_DRAWER = [0.32, 0.72, 0, 1]

export const enter = (reduce, extra = {}) => ({ duration: reduce ? 0.12 : 0.22, ease: EASE_OUT, ...extra })
export const leave = (reduce) => ({ duration: reduce ? 0.08 : 0.12, ease: EASE_OUT })

// Reduced motion: hareketi kaldır, opaklığı koru.
export const rise = (reduce, y = 6) => ({
  initial: { opacity: 0, y: reduce ? 0 : y, filter: reduce ? 'blur(0px)' : 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 0, filter: 'blur(0px)' },
})
