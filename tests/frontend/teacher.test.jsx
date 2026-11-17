import { createRef } from 'react'
import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { cueFor, POINT_SOURCES_MS } from '../../src/lib/teacher/director'
import { flapAt, levelFromWaveform, smoothMouth } from '../../src/lib/teacher/mouth'
import { handAt, reachFor, toViewBox } from '../../src/lib/teacher/pose'
import { IDLE_ACTIVITY } from '../../src/lib/board/activity'
import Teacher from '../../src/components/board/Teacher'

const running = { ...IDLE_ACTIVITY, playing: true, step: 0 }

describe('director: board activity → teacher state', () => {
  test('waits, thinks, writes, points, talks', () => {
    expect(cueFor(IDLE_ACTIVITY).state).toBe('idle')
    expect(cueFor({ ...running, waiting: true }).state).toBe('thinking')
    expect(cueFor({ ...running, phase: 'writing', pen: { x: 1, y: 2 } })).toMatchObject({ state: 'writing', aim: { x: 1, y: 2 } })
    expect(cueFor({ ...running, phase: 'marking', mark: { x: 3, y: 4 } }).state).toBe('pointing')
    const sources = { ...running, phase: 'done', sources: { x: 5, y: 6 } }
    expect(cueFor({ ...sources, sinceSourcesMs: 10 }).state).toBe('pointing')
    expect(cueFor({ ...sources, sinceSourcesMs: POINT_SOURCES_MS + 1 }).state).toBe('talking')
  })

  test('the mouth moves from the audio when sound is on, otherwise while a step runs', () => {
    expect(cueFor({ ...running, phase: 'done' })).toMatchObject({ speaking: true, mouthFromAudio: false })
    expect(cueFor({ ...running, phase: 'done', soundOn: true, audio: { paused: true } }).speaking).toBe(false)
    expect(cueFor({ ...running, phase: 'done', soundOn: true, audio: { paused: false, ended: false } })).toMatchObject({ speaking: true, mouthFromAudio: true })
  })
})

describe('mouth', () => {
  test('silence closes, loud opens fully', () => {
    expect(levelFromWaveform(new Uint8Array(64).fill(128))).toBe(0)
    expect(levelFromWaveform(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 0 : 255)))).toBe(1)
  })
  test('flap alternates, smoothing approaches the target', () => {
    expect(flapAt(0)).toBeGreaterThan(0.5)
    expect(flapAt(160)).toBeLessThan(0.1)
    const m = smoothMouth(0, 1, 40)
    expect(m).toBeGreaterThan(0.5)
    expect(m).toBeLessThan(1)
  })
})

describe('pose', () => {
  test('the hand reaches a point within reach', () => {
    const shoulder = { x: 0, y: 0 }
    const target = { x: -30, y: 20 }
    const hand = handAt(shoulder, reachFor(shoulder, target, 30, 28, { reach: 1 }), 30, 28)
    expect(hand.x).toBeCloseTo(target.x, 3)
    expect(hand.y).toBeCloseTo(target.y, 3)
  })
  test('screen → viewBox keeps the aspect ratio', () => {
    expect(toViewBox({ x: 60, y: 120 }, { left: 0, top: 0, width: 120, height: 240 }, { w: 120, h: 240 })).toEqual({ x: 60, y: 120 })
    expect(toViewBox({ x: 100, y: 0 }, { left: 0, top: 0, width: 240, height: 240 }, { w: 120, h: 240 })).toEqual({ x: 40, y: 0 })
  })
})

test('the figure exposes only setState / aimAt / setMouthOpen', () => {
  const ref = createRef()
  const { container } = render(<Teacher ref={ref} />)
  expect(Object.keys(ref.current).sort()).toEqual(['aimAt', 'setMouthOpen', 'setState'])
  expect(() => {
    ref.current.setState('writing')
    ref.current.aimAt(10, 10)
    ref.current.setMouthOpen(Number.NaN)
  }).not.toThrow()
  expect(container.querySelector('[data-teacher]')).toHaveAttribute('aria-hidden')
})
