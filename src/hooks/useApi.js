import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { isProcessing } from '../lib/materials'

/** Tek seferlik yükleme: { data, error, loading, reload }. Bileşen kapanınca istek iptal edilir. */
export function useResource(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const ctl = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    load(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data, error: null, loading: false }),
      (error) => !ctl.signal.aborted && error?.name !== 'AbortError' && setState({ data: null, error, loading: false }),
    )
    return () => ctl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export const POLL_MS = 3000

/**
 * Ders materyalleri; işlenen materyal varken 3 sn'de bir yoklanır (api-contracts.md §1).
 * Zamanlayıcı ve istekler bileşen kapanınca temizlenir.
 */
export function useCourseDocuments(courseId, { interval = POLL_MS } = {}) {
  const [state, setState] = useState({ docs: null, error: null, loading: true })
  const ctl = useRef(null)
  const timer = useRef(null)
  const alive = useRef(true)

  const fetchNow = useCallback(async function poll() {
    clearTimeout(timer.current)
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    try {
      const docs = await api.documents(courseId, c.signal)
      if (!alive.current || c.signal.aborted) return
      setState({ docs, error: null, loading: false })
      if (docs.some(isProcessing)) timer.current = setTimeout(poll, interval)
    } catch (error) {
      if (!alive.current || error?.name === 'AbortError') return
      setState((s) => ({ ...s, error, loading: false }))
      // Geçici ağ hatasında yoklamaya devam; yetki/bulunamadı hatalarında dur.
      if (error?.retryable) timer.current = setTimeout(poll, interval * 2)
    }
  }, [courseId, interval])

  useEffect(() => {
    alive.current = true
    setState({ docs: null, error: null, loading: true })
    fetchNow()
    return () => {
      alive.current = false
      clearTimeout(timer.current)
      ctl.current?.abort()
    }
  }, [fetchNow])

  return { ...state, refresh: fetchNow }
}
