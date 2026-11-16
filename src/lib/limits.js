import { useEffect, useState } from 'react'
import { api } from '../api/endpoints'

// What the server really enforces. Until it answers (or if it cannot), the defaults are shown.
export const DEFAULT_LIMITS = { document_bytes: 30 * 1024 * 1024, study_file_bytes: 20 * 1024 * 1024, video_bytes: 100 * 1024 * 1024 }
const MIB = 1024 * 1024
export const mb = (bytes) => `${Math.max(1, Math.round(bytes / MIB))} MB`

let cached = null
export function useLimits() {
  const [limits, setLimits] = useState(cached || DEFAULT_LIMITS)
  useEffect(() => {
    if (cached) return
    const abort = new AbortController()
    Promise.resolve(api.limits(abort.signal))
      .then((l) => {
        if (!l || abort.signal.aborted) return
        cached = { ...DEFAULT_LIMITS, ...l }
        setLimits(cached)
      })
      .catch(() => {})
    return () => abort.abort()
  }, [])
  return limits
}
export const resetLimitsCache = () => { cached = null }
