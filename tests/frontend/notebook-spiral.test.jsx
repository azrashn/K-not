import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const css = readFileSync('src/product.css', 'utf8')
const start = css.indexOf('/* ── Spiral defter teli')
const block = css.slice(start, css.indexOf('\n/* ── ', start + 10)) // up to the next section of the stylesheet
const wire = block.slice(block.indexOf('.card-wire {'), block.indexOf('@media'))
const motion = block.slice(block.indexOf('@media'))

test('one wire ring per binding hole: the ring rhythm equals the hole rhythm of the card spine', () => {
  const holes = css.match(/\.course-card::before \{[^}]*background-size: 26px (\d+)px/)[1]
  expect(wire).toMatch(new RegExp(`height: ${holes}px`)) // each ring is one hole tall
  expect(wire).toMatch(new RegExp(`/ 100% ${holes}px no-repeat`))
  expect(wire).toMatch(/viewBox='0 0 40 34'/)
  expect(holes).toBe('34')
})

test('the wire is grey, taken from the palette tokens, with no hard-coded colour', () => {
  expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  expect(block).toMatch(/--wire: color-mix\(in srgb, var\(--color-ink-3\)/)
  expect(wire).toMatch(/linear-gradient\(165deg, var\(--wire-hi\) 0%, var\(--wire\) 42%, var\(--wire-lo\) 100%\)/)
  expect(block).toMatch(/:root\[data-theme='dark'\] \{[^}]*--wire:/) // and it adapts to the night desk
})

test('hover turns the rings one after another: transform only, at most 300 ms, only for fine pointers and no reduced motion', () => {
  expect(motion).toMatch(/\(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\)/)
  expect(motion).toMatch(/transition: transform (\d+)ms ease-out calc\(var\(--i\) \* (\d+)ms\)/)
  const [, ms, step] = motion.match(/transform (\d+)ms ease-out calc\(var\(--i\) \* (\d+)ms\)/)
  expect(Number(ms)).toBeLessThanOrEqual(300)
  expect(Number(ms) + 12 * Number(step)).toBeLessThanOrEqual(400) // stagger is capped at --i 12
  expect(motion).toMatch(/\.course-card:hover \.card-wire i/)
  expect(motion).toMatch(/\.course-card:focus-within \.card-wire i/)
  expect(block).not.toMatch(/@keyframes|animation:|infinite/) // nothing moves on its own
  expect(wire).not.toMatch(/transition|:hover/) // the resting state is static
})

test('the wire never catches a click and is hidden from assistive technology', () => {
  expect(wire).toMatch(/pointer-events: none/)
  expect(readFileSync('src/pages/Courses.jsx', 'utf8')).toMatch(/className="card-wire" aria-hidden="true"/)
})

test('the spine keeps its original corners now that the card no longer clips its overflow', () => {
  expect(block).toMatch(/\.course-card \{ overflow: visible; \}/)
  expect(block).toMatch(/\.course-card::before \{ border-radius: 3px 0 0 3px; \}/)
})

test('the wire sticks out less than the grid gap, so it never overlaps the neighbouring card', () => {
  const gap = Number(css.match(/\.course-grid \{[^}]*gap: (\d+)px/)[1])
  const left = Number(wire.match(/left: -(\d+)px/)[1])
  expect(left - 1).toBeLessThan(gap) // 1 px card border
})
