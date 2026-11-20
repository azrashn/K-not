import { describe, expect, test } from 'vitest'
import { activeStepAt, buildTimeline, frameAt, MIN_STEP_MS, readingTimeMs, TimelinePlayer } from '../../src/lib/board/timeline'
import { drawStrokes, markStrokes, mergeLineRects, revealAt } from '../../src/lib/board/geometry'

const steps = [
  { board: 'y(0) = x(0)', speech: 'Kısa.', formula: null, mark: 'underline' },
  { board: 'x(0) = 1', speech: 'a'.repeat(150), formula: null, mark: null },
]

describe('timeline', () => {
  test('reading time has a floor', () => {
    expect(readingTimeMs('Kısa.')).toBe(MIN_STEP_MS)
    expect(readingTimeMs('a'.repeat(150))).toBe(10000)
  })

  test('steps follow each other; audio length wins over reading time', () => {
    const tl = buildTimeline(steps)
    expect(tl.steps[1].start).toBe(tl.steps[0].end)
    expect(tl.events.map((e) => e.type)).toEqual(['start', 'write', 'mark', 'sources', 'end', 'start', 'write', 'sources', 'end'])
    const withAudio = buildTimeline(steps, { durationsMs: [8000, null] })
    expect(withAudio.steps[0].end).toBe(8000)
  })

  test('frames: hidden before, writing, then done; the last step stays active', () => {
    const tl = buildTimeline(steps)
    expect(frameAt(tl, 0)[1].phase).toBe('hidden')
    const s = tl.steps[0]
    expect(frameAt(tl, (s.writeStart + s.writeEnd) / 2)[0].phase).toBe('writing')
    const end = frameAt(tl, tl.totalMs)
    expect(end.map((f) => f.phase)).toEqual(['done', 'done'])
    expect(end.map((f) => f.active)).toEqual([false, true])
    expect(activeStepAt(tl, tl.steps[1].start)).toBe(1)
  })

  test('player reports crossed events but not the ones a seek jumps over', () => {
    const tl = buildTimeline(steps)
    let now = 0
    const seen = []
    const player = new TimelinePlayer(tl, () => now, (e) => seen.push(`${e.step}:${e.type}`))
    player.play()
    now = tl.steps[0].writeStart
    player.tick()
    expect(seen).toEqual(['0:start', '0:write'])
    player.seek(tl.steps[1].start + 1)
    now += 0
    player.tick()
    expect(seen).toHaveLength(2)
    now = 1e9
    player.tick()
    expect(player.finished).toBe(true)
    expect(player.playing).toBe(false)
  })
})

describe('geometry', () => {
  const lines = mergeLineRects([
    { left: 0, top: 0, right: 50, bottom: 20 },
    { left: 50, top: 2, right: 100, bottom: 20 },
    { left: 0, top: 30, right: 80, bottom: 50 },
  ])

  test('line fragments merge into visual lines', () => {
    expect(lines).toEqual([{ left: 0, top: 0, right: 100, bottom: 20 }, { left: 0, top: 30, right: 80, bottom: 50 }])
  })

  test('reveal moves the pen along the lines', () => {
    expect(revealAt(lines, 1)).toEqual({ clip: null, pen: null })
    expect(revealAt(lines, 0.25).pen.x).toBeCloseTo(45)
    expect(revealAt(lines, 0.9).pen.y).toBeGreaterThan(30)
  })

  test('marks are drawn stroke after stroke', () => {
    expect(markStrokes('underline', lines)).toHaveLength(1)
    expect(markStrokes('arrow', lines)).toHaveLength(3)
    const half = drawStrokes(markStrokes('arrow', lines), 0.5)
    expect(half.each[0]).toBeGreaterThan(0)
    expect(half.pen).not.toBeNull()
    expect(drawStrokes(markStrokes('circle', lines), 1)).toEqual({ each: [1], pen: null })
  })
})
