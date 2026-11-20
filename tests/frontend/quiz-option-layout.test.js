import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const css = readFileSync('src/product.css', 'utf8')

test('a quiz option radio is not stretched by the generic form input rule', () => {
  expect(css).toMatch(/\.product-form input,[^{]*\{[^}]*width: 100%/) // the generic rule this guards against
  const rule = css.match(/\.product-form \.quiz-option input \{([^}]*)\}/)[1]
  expect(rule).toMatch(/width: auto/)
  expect(rule).toMatch(/flex: none/)
  expect(rule).toMatch(/padding: 0/)
  expect(rule).toMatch(/accent-color: var\(--color-accent\)/) // the one accent colour, not the browser blue
  // it must beat `.product-form input` (0,1,1) in specificity, whatever the source order
  expect('.product-form .quiz-option input'.split('.').length - 1).toBeGreaterThan('.product-form input'.split('.').length - 1)
})

test('exam questions are numbered by a counter, because the grid layout drops the list numbers', () => {
  const list = css.match(/\.exam-questions \{([^}]*)\}/)[1]
  expect(list).toMatch(/counter-reset: exam-q/)
  expect(list).toMatch(/list-style: none/)
  expect(css).toMatch(/\.exam-questions > li \{[^}]*counter-increment: exam-q/)
  expect(css).toMatch(/\.exam-questions > li::before \{[^}]*content: counter\(exam-q\) "\."/)
})
