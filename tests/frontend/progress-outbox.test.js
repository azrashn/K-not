import { describe, expect, test, vi } from 'vitest'
import { createOutbox, isTransient, memoryStore, OUTBOX_MAX_AGE_MS, OUTBOX_MAX_ENTRIES } from '../../src/lib/progress-outbox'

const entry = (over = {}) => ({ userId: 'u1', courseId: 'c1', videoId: 'v1', position_ms: 1000, intervals: [{ start_ms: 0, end_ms: 1000 }], ...over })

describe('what is worth retrying', () => {
  test.each([
    [{ code: 'NETWORK_ERROR', status: 0 }, true],
    [{ status: 503, code: 'AI_SERVICE_UNAVAILABLE' }, true],
    [{ status: 500 }, true],
    [{ status: 429 }, true],
    [{ name: 'TimeoutError' }, true],
    [{ name: 'AbortError' }, true],
    [{ status: 404, code: 'NOT_FOUND' }, false],
    [{ status: 403 }, false],
    [{ status: 422, code: 'VALIDATION_ERROR' }, false],
    [null, false],
  ])('%j → %s', (error, expected) => expect(isTransient(error)).toBe(expected))
})

describe('the outbox keeps failed saves per user', () => {
  test('an entry survives until it is sent, then it is removed', async () => {
    const box = createOutbox(memoryStore())
    expect(await box.enqueue(entry())).toBe(true)
    expect(await box.count('u1')).toBe(1)
    const send = vi.fn().mockResolvedValue('ok')
    expect(await box.drain('u1', send)).toEqual({ sent: 1, dropped: 0, waiting: 0 })
    expect(send).toHaveBeenCalledWith('c1', 'v1', { position_ms: 1000, intervals: [{ start_ms: 0, end_ms: 1000 }] })
    expect(await box.count('u1')).toBe(0)
  })

  test('another user never sees or sends these entries', async () => {
    const box = createOutbox(memoryStore())
    await box.enqueue(entry())
    const send = vi.fn().mockResolvedValue('ok')
    expect(await box.drain('u2', send)).toEqual({ sent: 0, dropped: 0, waiting: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(await box.count('u1')).toBe(1)
  })

  test('entries of one video are merged into one request with the newest position', async () => {
    let t = 1000
    const box = createOutbox(memoryStore(), () => (t += 10))
    await box.enqueue(entry({ position_ms: 5000, intervals: [{ start_ms: 0, end_ms: 5000 }] }))
    await box.enqueue(entry({ position_ms: 12000, intervals: [{ start_ms: 4000, end_ms: 12000 }] }))
    await box.enqueue(entry({ videoId: 'v2', position_ms: 300, intervals: [{ start_ms: 0, end_ms: 300 }] }))
    const send = vi.fn().mockResolvedValue('ok')
    await box.drain('u1', send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, 'c1', 'v1', { position_ms: 12000, intervals: [{ start_ms: 0, end_ms: 12000 }] })
    expect(send).toHaveBeenNthCalledWith(2, 'c1', 'v2', { position_ms: 300, intervals: [{ start_ms: 0, end_ms: 300 }] })
  })

  test('a transient failure keeps the entries and stops the run; a permanent one drops them', async () => {
    let t = 0
    const box = createOutbox(memoryStore(), () => (t += 1))
    await box.enqueue(entry({ videoId: 'gone' }))
    await box.enqueue(entry({ videoId: 'later' }))
    await box.enqueue(entry({ videoId: 'after' }))
    const send = vi.fn(async (c, v) => (v === 'gone' ? 'drop' : 'retry'))
    expect(await box.drain('u1', send)).toEqual({ sent: 0, dropped: 1, waiting: 2 })
    expect(send).toHaveBeenCalledTimes(2) // stopped at the first retry
    expect(await box.count('u1')).toBe(2)
    expect(await box.drain('u1', async () => { throw new Error('offline') })).toMatchObject({ waiting: 2 })
    expect(await box.count('u1')).toBe(2)
  })

  test('replaying the same save twice is safe: intervals are merged, never added up', async () => {
    const box = createOutbox(memoryStore())
    await box.enqueue(entry({ intervals: [{ start_ms: 0, end_ms: 1000 }] }))
    await box.enqueue(entry({ intervals: [{ start_ms: 0, end_ms: 1000 }] }))
    const send = vi.fn().mockResolvedValue('ok')
    await box.drain('u1', send)
    expect(send.mock.calls[0][2].intervals).toEqual([{ start_ms: 0, end_ms: 1000 }])
  })

  test('logout clears only that user', async () => {
    const box = createOutbox(memoryStore())
    await box.enqueue(entry())
    await box.enqueue(entry({ userId: 'u2' }))
    expect(await box.clear('u1')).toBe(1)
    expect(await box.count('u1')).toBe(0)
    expect(await box.count('u2')).toBe(1)
  })

  test('bounded: old entries expire and the oldest go first when full', async () => {
    let t = 0
    const box = createOutbox(memoryStore(), () => t)
    await box.enqueue(entry({ videoId: 'old' }))
    t = OUTBOX_MAX_AGE_MS + 5
    await box.enqueue(entry({ videoId: 'new' }))
    expect(await box.count('u1')).toBe(1)
    const full = createOutbox(memoryStore(), () => (t += 1))
    for (let i = 0; i < OUTBOX_MAX_ENTRIES + 5; i++) await full.enqueue(entry({ videoId: `v${i}` }))
    expect(await full.count('u1')).toBe(OUTBOX_MAX_ENTRIES)
  })

  test('nothing useful is not stored, and a missing store is harmless', async () => {
    const box = createOutbox(memoryStore())
    expect(await box.enqueue(entry({ intervals: [], position_ms: undefined }))).toBe(false)
    expect(await box.enqueue(entry({ userId: '' }))).toBe(false)
    const none = createOutbox(null)
    expect(await none.enqueue(entry())).toBe(false)
    expect(await none.drain('u1', vi.fn())).toEqual({ sent: 0, dropped: 0, waiting: 0 })
    expect(await none.clear('u1')).toBe(0)
  })

  test('a broken store never throws into the player', async () => {
    const broken = { add: async () => { throw new Error('quota') }, all: async () => { throw new Error('quota') }, remove: async () => { throw new Error('quota') } }
    const box = createOutbox(broken)
    expect(await box.enqueue(entry())).toBe(false)
    expect(await box.count('u1')).toBe(0)
  })
})
