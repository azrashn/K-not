import { describe, expect, test, vi } from 'vitest'
import { createQueuePlayer } from '../../src/lib/local-voice'

function fakeAudio() {
  const made = []
  const makeAudio = (url) => {
    const a = {
      url, playbackRate: 1, paused: false,
      play: vi.fn(() => { queueMicrotask(() => a.onplaying?.()); return Promise.resolve() }),
      pause: vi.fn(() => { a.paused = true }),
      finish() { a.onended?.() },
    }
    made.push(a)
    return a
  }
  return { made, makeAudio }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createQueuePlayer', () => {
  test('plays sentences in order and prepares the next one while the current plays', async () => {
    const { made, makeAudio } = fakeAudio()
    const fetchUrl = vi.fn(async (t) => `blob:${t}`)
    const states = []
    const p = createQueuePlayer({ chunks: ['bir', 'iki', 'üç'], fetchUrl, makeAudio, revoke: () => {}, onState: (s) => states.push(s) })
    const done = p.play()
    await tick()
    expect(made).toHaveLength(1)
    expect(fetchUrl.mock.calls.map((c) => c[0])).toEqual(['bir', 'iki']) // next sentence prefetched
    made[0].finish(); await tick()
    expect(made[1].url).toBe('blob:iki')
    made[1].finish(); await tick()
    made[2].finish(); await done
    expect(states).toContain('playing')
    expect(states.at(-1)).toBe('idle')
  })

  test('speed applies to the playing sentence and the following ones', async () => {
    const { made, makeAudio } = fakeAudio()
    const p = createQueuePlayer({ chunks: ['a', 'b'], rate: 1.25, fetchUrl: async (t) => t, makeAudio, revoke: () => {}, onState: () => {} })
    void p.play(); await tick()
    expect(made[0].playbackRate).toBe(1.25)
    p.setRate(0.8)
    expect(made[0].playbackRate).toBe(0.8)
    made[0].finish(); await tick()
    expect(made[1].playbackRate).toBe(0.8)
  })

  test('pause and resume act on the current sentence; stop ends the queue and frees the audio', async () => {
    const { made, makeAudio } = fakeAudio()
    const revoke = vi.fn()
    const states = []
    const p = createQueuePlayer({ chunks: ['a', 'b'], fetchUrl: async (t) => `u:${t}`, makeAudio, revoke, onState: (s) => states.push(s) })
    void p.play(); await tick()
    p.pause(); expect(made[0].pause).toHaveBeenCalled(); expect(states.at(-1)).toBe('paused')
    p.resume(); expect(states.at(-1)).toBe('playing')
    p.stop(); await tick()
    expect(states.at(-1)).toBe('idle')
    expect(made).toHaveLength(1) // the second sentence never starts
    expect(revoke).toHaveBeenCalledWith('u:a')
  })

  test('a failed request reports an error instead of hanging', async () => {
    const { makeAudio } = fakeAudio()
    const states = []
    const p = createQueuePlayer({ chunks: ['a'], fetchUrl: async () => { throw new Error('503') }, makeAudio, revoke: () => {}, onState: (s) => states.push(s) })
    await p.play()
    expect(states.at(-1)).toBe('error')
  })

  test('an autoplay block is reported as blocked, not as a failure', async () => {
    const states = []
    const makeAudio = (url) => ({ url, play: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })), pause() {} })
    const p = createQueuePlayer({ chunks: ['a'], fetchUrl: async (t) => t, makeAudio, revoke: () => {}, onState: (s) => states.push(s) })
    await p.play()
    expect(states.at(-1)).toBe('blocked')
  })
})
