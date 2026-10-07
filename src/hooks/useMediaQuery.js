import { useSyncExternalStore } from 'react'

export function useMediaQuery(query) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => true,
  )
}
