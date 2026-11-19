import { describe, expect, test } from 'vitest'
import { SPIRAL_BAR_RIGHT, SPIRAL_LOOPS, SPIRAL_PITCH, SPIRAL_WIDTH, loopPath, spiralPaths, spiralViewBox } from '../../src/lib/spiral'

const numbers = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number)

describe('spiral geometry', () => {
  test('is deterministic: the same hand-drawn irregularity on every render and every card', () => {
    expect(spiralPaths()).toEqual(spiralPaths())
    expect(loopPath(3)).toBe(loopPath(3))
  })

  test('draws one path per loop and no two loops are identical (organic, not a stamped pattern)', () => {
    const paths = spiralPaths()
    expect(paths).toHaveLength(SPIRAL_LOOPS)
    expect(new Set(paths).size).toBe(SPIRAL_LOOPS)
    for (const d of paths) expect(d).toMatch(/^M[\d. -]+C[\d. -]+C[\d. -]+C[\d. -]+$/)
  })

  test('every loop sticks out to the left of the bar and ends inside it', () => {
    for (let i = 0; i < SPIRAL_LOOPS; i++) {
      const xs = numbers(loopPath(i)).filter((_, k) => k % 2 === 0)
      expect(Math.min(...xs)).toBeLessThan(18) // reaches well left of the card edge (bar starts at x = 46)
      expect(Math.max(...xs)).toBeLessThanOrEqual(SPIRAL_BAR_RIGHT) // never past the bar's right edge
      expect(xs[0]).toBeGreaterThan(46) // starts on the coloured bar
    }
  })

  test('the coil is continuous from top to bottom and stays inside the viewBox height', () => {
    const height = SPIRAL_LOOPS * SPIRAL_PITCH
    expect(spiralViewBox()).toBe(`0 0 ${SPIRAL_WIDTH} ${height}`)
    const ends = spiralPaths().map((d) => {
      const n = numbers(d)
      return { startY: n[1], endY: n.at(-1) }
    })
    for (let i = 1; i < ends.length; i++) expect(Math.abs(ends[i].startY - ends[i - 1].endY)).toBeLessThan(10) // next loop starts where the last ended
    expect(ends[0].startY).toBeLessThan(15) // begins at the top-left of the card
    expect(ends.at(-1).endY).toBeGreaterThan(height - 12) // reaches the bottom
    expect(ends.at(-1).endY).toBeLessThan(height + 6)
  })
})
