import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { api } from '../../src/api/endpoints'
import * as session from '../../src/api/session'
import { createOutbox, memoryStore } from '../../src/lib/progress-outbox'
import { clearProgressOutbox, drainProgressOutbox } from '../../src/lib/outbox-sync'

vi.mock('../../src/api/endpoints', () => ({ api: { videoProgress: vi.fn(), saveVideoProgress: vi.fn() } }))
vi.mock('../../src/api/session', () => ({ get: vi.fn(), token: vi.fn(), expire: vi.fn() }))
vi.mock('../../src/lib/progress-outbox', async (original) => ({ ...(await original()), outbox: (globalThis.__box ||= (await original()).createOutbox((await original()).memoryStore())) }))

const { useVideoProgress } = await import('../../src/hooks/useVideoProgress')
const box = globalThis.__box
const offline = () => Object.assign(new Error('Sunucuya ulaşılamadı.'), { name: 'ApiError', code: 'NETWORK_ERROR', status: 0 })
const progress = (over = {}) => ({ video_id: 'v1', duration_ms: 600000, position_ms: 0, watched_ms: 0, watched_percent: 0, intervals: [], revision: 1, ...over })
const player = () => ({ current: { currentTime: 0, paused: false, seeking: false, playbackRate: 1, ended: false } })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  session.get.mockReturnValue({ user: { id: 'u1' } })
  api.videoProgress.mockResolvedValue(progress())
  await box.clear('u1'); await box.clear('u2')
})
afterEach(() => vi.useRealTimers())

// The player reports its time about once a second (timeupdate); the hook saves every 5 seconds.
async function watch(p, hook, seconds) {
  for (let i = 0; i < seconds; i++) {
    p.current.currentTime += 1
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); hook.current.observe() })
  }
}

test('a failed save is kept on the device and says so, instead of being lost with the tab', async () => {
  api.saveVideoProgress.mockRejectedValue(offline())
  const p = player()
  const { result, unmount } = renderHook(() => useVideoProgress('c1', 'v1', true, p))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await watch(p, result, 15)
  expect(await box.count('u1')).toBeGreaterThan(0)
  expect(result.current.error).toMatch(/saklandı/)
  unmount()
})

test('when the network is back the stored progress is sent once and the entry is removed', async () => {
  api.saveVideoProgress.mockRejectedValue(offline())
  const p = player()
  const { result, unmount } = renderHook(() => useVideoProgress('c1', 'v1', true, p))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await watch(p, result, 15)
  expect(await box.count('u1')).toBeGreaterThan(0)

  api.saveVideoProgress.mockReset()
  api.saveVideoProgress.mockResolvedValue(progress({ position_ms: 15000, watched_ms: 15000, intervals: [{ start_ms: 0, end_ms: 15000 }] }))
  await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0) })
  expect(await box.count('u1')).toBe(0)
  const sent = api.saveVideoProgress.mock.calls.map((c) => c[2])
  const covered = sent.flatMap((b) => b.intervals)
  expect(covered.length).toBeGreaterThan(0)
  expect(Math.max(...covered.map((i) => i.end_ms))).toBeGreaterThanOrEqual(10000)
  unmount()
})

test('the position the server holds for the open video is not moved back by an old queued one', async () => {
  await box.enqueue({ userId: 'u1', courseId: 'c1', videoId: 'v1', position_ms: 5000, intervals: [{ start_ms: 0, end_ms: 5000 }] })
  await box.enqueue({ userId: 'u1', courseId: 'c1', videoId: 'other', position_ms: 9000, intervals: [{ start_ms: 0, end_ms: 9000 }] })
  api.saveVideoProgress.mockResolvedValue(progress())
  const result = await drainProgressOutbox({ positionFor: (c, v) => (v === 'v1' ? 200000 : null) })
  expect(result).toEqual({ sent: 2, dropped: 0, waiting: 0 })
  const byVideo = Object.fromEntries(api.saveVideoProgress.mock.calls.map((c) => [c[1], c[2]]))
  expect(byVideo.v1.position_ms).toBe(200000)
  expect(byVideo.other.position_ms).toBe(9000)
})

test('server trouble keeps the entries; a removed video drops them; an ended session keeps them', async () => {
  for (const id of ['a', 'b', 'c']) await box.enqueue({ userId: 'u1', courseId: 'c1', videoId: id, position_ms: 1, intervals: [{ start_ms: 0, end_ms: 1000 }] })
  api.saveVideoProgress.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 404, code: 'NOT_FOUND' }))
    .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }))
  const result = await drainProgressOutbox()
  expect(result).toEqual({ sent: 0, dropped: 1, waiting: 2 })
  expect(await box.count('u1')).toBe(2)
})

test('nobody signed in sends nothing, and another user\'s entries are never sent', async () => {
  await box.enqueue({ userId: 'u2', courseId: 'c1', videoId: 'v1', position_ms: 1, intervals: [{ start_ms: 0, end_ms: 1000 }] })
  session.get.mockReturnValue(null)
  expect(await drainProgressOutbox()).toBeNull()
  session.get.mockReturnValue({ user: { id: 'u1' } })
  api.saveVideoProgress.mockResolvedValue(progress())
  expect(await drainProgressOutbox()).toEqual({ sent: 0, dropped: 0, waiting: 0 })
  expect(api.saveVideoProgress).not.toHaveBeenCalled()
  expect(await box.count('u2')).toBe(1)
})

test('signing out clears that user\'s unsent progress only', async () => {
  await box.enqueue({ userId: 'u1', courseId: 'c1', videoId: 'v1', position_ms: 1, intervals: [{ start_ms: 0, end_ms: 1000 }] })
  await box.enqueue({ userId: 'u2', courseId: 'c1', videoId: 'v1', position_ms: 1, intervals: [{ start_ms: 0, end_ms: 1000 }] })
  expect(await clearProgressOutbox('u1')).toBe(1)
  expect(await clearProgressOutbox('')).toBe(0)
  expect(await box.count('u2')).toBe(1)
})
