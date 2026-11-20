// Offline outbox for video watch progress. A failed save is kept on this device (IndexedDB) under the
// signed-in user, and is sent once when the network is back, even after the tab was closed.
// Replaying is safe: the server unions watched intervals, so a duplicate changes nothing.
// Nothing here decides what counts as watched; it only carries the observations the tracker made.
import { mergeObserved } from './watch-tracker'

export const OUTBOX_MAX_ENTRIES = 200 // per user; the oldest are dropped first
export const OUTBOX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** Worth keeping and retrying: no connection, timeout, server trouble, throttling. */
export function isTransient(error) {
  if (!error) return false
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true
  if (error.code === 'NETWORK_ERROR') return true
  const status = Number(error.status || 0)
  return status === 0 || status === 429 || status >= 500
}

export function memoryStore() {
  let rows = []
  let next = 1
  return {
    async add(row) { rows.push({ ...row, id: next++ }); return next - 1 },
    async all() { return rows.map((r) => ({ ...r })) },
    async remove(ids) { const drop = new Set(ids); rows = rows.filter((r) => !drop.has(r.id)) },
  }
}

const DB = 'knot-progress-outbox'
const STORE = 'entries'

/** IndexedDB store; without IndexedDB (private mode, old browser, tests) it quietly keeps nothing. */
export function indexedDbStore(factory = globalThis.indexedDB) {
  if (!factory) return null
  let opened = null
  const open = () => (opened ||= new Promise((resolve, reject) => {
    const req = factory.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { opened = null; reject(req.error) }
  }))
  const run = async (mode, fn) => {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const out = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(out?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }
  return {
    add: (row) => run('readwrite', (s) => s.add(row)),
    all: () => run('readonly', (s) => s.getAll()),
    remove: (ids) => run('readwrite', (s) => { for (const id of ids) s.delete(id) }),
  }
}

export function createOutbox(store = indexedDbStore(), now = () => Date.now()) {
  const safe = async (fn, fallback) => { try { return store ? await fn() : fallback } catch { return fallback } }
  const mine = async (userId) => (await safe(() => store.all(), [])).filter((r) => r.userId === userId)

  return {
    /** Keep one failed save. Returns true when it was stored. */
    async enqueue({ userId, courseId, videoId, position_ms, intervals }) {
      if (!userId || !courseId || !videoId) return false
      const merged = mergeObserved(intervals || [])
      if (!merged.length && !Number.isFinite(position_ms)) return false
      return safe(async () => {
        await store.add({ userId, courseId, videoId, position_ms: Number.isFinite(position_ms) ? position_ms : null, intervals: merged, createdAt: now() })
        const rows = await mine(userId)
        const stale = rows.filter((r) => now() - r.createdAt > OUTBOX_MAX_AGE_MS).map((r) => r.id)
        const overflow = rows.filter((r) => !stale.includes(r.id)).sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, rows.length - stale.length - OUTBOX_MAX_ENTRIES)).map((r) => r.id)
        if (stale.length || overflow.length) await store.remove([...stale, ...overflow])
        return true
      }, false)
    },

    async count(userId) { return (await mine(userId)).length },

    /**
     * Send what is waiting for this user, oldest first, one request per video (intervals merged, the
     * newest saved position). `send` returns 'ok' | 'drop' (permanent failure) | 'retry' (try later).
     * A transient failure stops the run so order is kept.
     */
    async drain(userId, send) {
      const rows = (await mine(userId)).sort((a, b) => a.createdAt - b.createdAt)
      const groups = new Map()
      for (const r of rows) {
        const key = `${r.courseId}\u0000${r.videoId}`
        const g = groups.get(key) || { courseId: r.courseId, videoId: r.videoId, ids: [], intervals: [], position_ms: null }
        g.ids.push(r.id)
        g.intervals.push(...r.intervals)
        if (r.position_ms !== null) g.position_ms = r.position_ms // later rows win: the newest position
        groups.set(key, g)
      }
      const result = { sent: 0, dropped: 0, waiting: 0 }
      const ordered = [...groups.values()]
      for (const [index, g] of ordered.entries()) {
        const intervals = mergeObserved(g.intervals)
        let outcome = 'retry'
        try { outcome = await send(g.courseId, g.videoId, { position_ms: g.position_ms ?? 0, intervals }) } catch { outcome = 'retry' }
        if (outcome === 'ok') { await safe(() => store.remove(g.ids)); result.sent += g.ids.length }
        else if (outcome === 'drop') { await safe(() => store.remove(g.ids)); result.dropped += g.ids.length }
        else { result.waiting = ordered.slice(index).reduce((n, x) => n + x.ids.length, 0); break }
      }
      return result
    },

    /** Remove everything of one user (explicit logout on a shared device). */
    async clear(userId) {
      const ids = (await mine(userId)).map((r) => r.id)
      if (ids.length) await safe(() => store.remove(ids))
      return ids.length
    },
  }
}

// One outbox for the app.
export const outbox = createOutbox()
