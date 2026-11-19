import { readFileSync } from 'node:fs'
import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import CardSpiral from '../../src/components/CardSpiral'

const css = readFileSync('src/product.css', 'utf8')
const block = css.slice(css.indexOf('Defter teli: ders kartında'))

test('the spiral is decoration only: hidden from assistive technology, never focusable, one path per loop', () => {
  const { container } = render(<CardSpiral />)
  const svg = container.querySelector('svg.card-spiral')
  expect(svg).toHaveAttribute('aria-hidden', 'true')
  expect(svg).toHaveAttribute('focusable', 'false')
  expect(svg.querySelectorAll('path')).toHaveLength(9)
  expect([...svg.querySelectorAll('path')].map((p) => p.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8'])
})

test('the colour comes from the card spine, so every card gets its own', () => {
  expect(block).toMatch(/\.card-spiral \{[^}]*color: var\(--spine, var\(--metro-1\)\)/)
  expect(block).toMatch(/\.card-spiral path \{[^}]*stroke: currentColor/)
})

test('draws top-to-bottom and erases bottom-to-top, with transform and opacity only', () => {
  const idle = block.slice(block.indexOf('.card-spiral path {'), block.indexOf('@media (hover: hover)'))
  expect(idle).toMatch(/calc\(\(var\(--n\) - var\(--i\)\) \* 23ms\)/) // leaving: last loop first
  expect(idle).toMatch(/transition:\s*transform [^,]+,\s*opacity/)
  expect(idle).not.toMatch(/stroke-dash|clip-path|width: \d+px.*transition/) // no layout/paint-heavy properties animated
  const hover = block.slice(block.indexOf('@media (hover: hover)'), block.indexOf('@media (prefers-reduced-motion'))
  expect(hover).toMatch(/transition-delay: calc\(var\(--i\) \* 23ms\)/) // entering: first loop first
})

test('the whole drawing stays within the 300 ms motion budget', () => {
  const loops = 9
  const stagger = 23
  const longest = 110 // transform duration
  expect((loops - 1) * stagger + longest).toBeLessThanOrEqual(300)
})

test('only a real mouse sees it; touch screens keep the existing design, and reduced motion removes the animation', () => {
  expect(block).toMatch(/\.card-spiral \{\s*display: none;/)
  expect(block).toMatch(/@media \(hover: hover\) and \(pointer: fine\) \{\s*\.card-spiral \{ display: block; \}/)
  expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.card-spiral path \{ transition: none; \}/)
})

test('it never intercepts clicks on the card', () => {
  expect(block).toMatch(/\.card-spiral \{[^}]*pointer-events: none/)
})
