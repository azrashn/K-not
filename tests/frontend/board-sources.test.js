import { describe, expect, test, vi } from 'vitest'
import { isResolved, parseTime, resolveSource, stepSources } from '../../src/lib/board/sources'
import { pendingAudioAt, StepAudioLoader } from '../../src/lib/board/audio'
import { buildTimeline } from '../../src/lib/board/timeline'
import { loadPrefs, savePrefs } from '../../src/lib/board/prefs'
import { stepAudioFetcher } from '../../src/api/tts'

const evidence = [
  { id: 'seg-a', n: 1, title: 'Hafta 3', location: { kind: 'video', start_ms: 290000, end_ms: 300000 } },
  { id: 'seg-b', n: 2, title: 'Notlar', location: { kind: 'page', page: 4 } },
]

describe('source resolution: evidence id → [n] → mm:ss', () => {
  test('evidence id wins', () => {
    expect(resolveSource('seg-b', evidence)).toMatchObject({ evidence: evidence[1], page: 4, label: 'Sayfa 4' })
  })
  test('[n] number', () => {
    expect(resolveSource('[1]', evidence)).toMatchObject({ evidence: evidence[0], ms: 290000, label: '4:50' })
  })
  test('mm:ss, matched to evidence at the same moment when there is one', () => {
    expect(resolveSource('04:50', evidence)).toMatchObject({ evidence: evidence[0], ms: 290000 })
    expect(resolveSource('07:14', evidence)).toEqual({ source: '07:14', ms: 434000, label: '7:14' })
    expect(parseTime('1:02:03')).toBe(3723000)
    expect(parseTime('7:99')).toBeNull()
  })
  test('video page citations ({ n, timestamp_ms })', () => {
    expect(resolveSource('[3]', [{ n: 3, timestamp_ms: 61000 }])).toMatchObject({ ms: 61000, label: '1:01' })
  })
  test('unknown sources are kept as labels but not clickable', () => {
    const r = resolveSource('bilinmeyen', evidence)
    expect(r).toEqual({ source: 'bilinmeyen', label: 'bilinmeyen' })
    expect(isResolved(r)).toBe(false)
  })
  test('rows follow step numbers, steps without sources are left out', () => {
    const rows = stepSources([{ sources: ['[2]'] }, { sources: [] }, { sources: ['07:14'] }], evidence)
    expect(rows.map((r) => r.step)).toEqual([0, 2])
  })
})

describe('step audio', () => {
  test('first step first; when the first fails nothing else is tried', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('x'))
    const seen = []
    await new StepAudioLoader(3, fetch, (s) => seen.push(s)).start()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(seen.at(-1).map((s) => s.state)).toEqual(['failed', 'failed', 'failed'])
  })
  test('the board waits only for audio that is still coming', () => {
    const tl = buildTimeline([{ board: 'a', speech: 'a' }, { board: 'b', speech: 'b' }])
    expect(pendingAudioAt(tl, 0, [{ state: 'loading' }, { state: 'idle' }])).toBe(0)
    expect(pendingAudioAt(tl, 0, [{ state: 'failed' }, { state: 'idle' }])).toBe(-1)
    expect(pendingAudioAt(tl, tl.steps[0].end - 10, [{ state: 'ready' }, { state: 'loading' }])).toBe(1)
  })
  test('/api/tts is off for now: no fetcher, the board is silent', async () => {
    expect(stepAudioFetcher('tr')).toBeNull()
    const say = vi.fn().mockResolvedValue('/api/tts/audio/x.wav')
    const fetchAudio = stepAudioFetcher('en', say, true)
    await expect(fetchAudio(0, { speech: ' Hello ', board: 'x' })).resolves.toBe('/api/tts/audio/x.wav')
    expect(say).toHaveBeenCalledWith('Hello', 'en')
    await expect(stepAudioFetcher('tr', vi.fn().mockResolvedValue(null), true)(0, { speech: 'a' })).rejects.toThrow()
  })
})

test('preferences survive bad storage', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  expect(loadPrefs(true, broken)).toEqual({ fast: true, audio: true, teacher: true })
  expect(() => savePrefs({ fast: false }, broken)).not.toThrow()
  const mem = new Map()
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }
  savePrefs({ fast: true, audio: false, teacher: false }, store)
  expect(loadPrefs(false, store)).toEqual({ fast: true, audio: false, teacher: false })
})
