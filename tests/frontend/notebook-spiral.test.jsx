import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const css = readFileSync('src/product.css', 'utf8')
const start = css.indexOf('/* ── Spiral defter teli')
const block = css.slice(start, css.indexOf('\n/* ── ', start + 10)) // up to the next section of the stylesheet
const after = block.slice(block.indexOf('.course-card::after {'))

test('one wire ring per binding hole: the ring rhythm equals the hole rhythm of the card spine', () => {
  const holes = css.match(/\.course-card::before \{[^}]*background-size: 26px (\d+)px/)[1]
  expect(after).toMatch(new RegExp(`background-size: 100% ${holes}px`))
  expect(after).toMatch(new RegExp(`/ 100% ${holes}px repeat-y`)) // the mask tile has the same height
  expect(after).toMatch(/viewBox='0 0 40 34'/)
  expect(holes).toBe('34')
})

test('the wire is grey, taken from the palette tokens, with no hard-coded colour', () => {
  expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  expect(block).toMatch(/--wire: color-mix\(in srgb, var\(--color-ink-3\)/)
  expect(after).toMatch(/linear-gradient\(165deg, var\(--wire-hi\) 0%, var\(--wire\) 42%, var\(--wire-lo\) 100%\)/)
  expect(block).toMatch(/:root\[data-theme='dark'\] \{[^}]*--wire:/) // and it adapts to the night desk
})

test('it is a static decoration: no animation, no transition, never in the way of a click', () => {
  expect(block).not.toMatch(/animation|transition|@keyframes|:hover/)
  expect(after).toMatch(/pointer-events: none/)
  expect(after).toMatch(/content: ''/)
})

test('the spine keeps its original corners now that the card no longer clips its overflow', () => {
  expect(block).toMatch(/\.course-card \{ overflow: visible; \}/)
  expect(block).toMatch(/\.course-card::before \{ border-radius: 3px 0 0 3px; \}/)
})

test('the wire sticks out less than the grid gap, so it never overlaps the neighbouring card', () => {
  const gap = Number(css.match(/\.course-grid \{[^}]*gap: (\d+)px/)[1])
  const left = Number(after.match(/left: -(\d+)px/)[1])
  const outside = left - 1 // 1 px card border
  expect(outside).toBeLessThan(gap)
})
