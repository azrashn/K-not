import { describe, expect, test } from 'vitest'
import { render } from '@testing-library/react'
import { boardSegments, boardSteps, formulaView, plainMath, shownFormula, stripStepNumber, stripTex, texToHandwriting } from '../../src/lib/board/content'
import Board from '../../src/components/board/Board'

describe('LaTeX → handwriting', () => {
  test.each([
    ['x^{2} \\le 4', 'x² ≤ 4'],
    ['x_n + 1', 'xₙ + 1'],
    ['\\pi r^2', 'πr²'],
    ['a \\le b', 'a ≤ b'],
    ['\\text{için } n < 0', 'için n < 0'],
    ['snake_case', 'snake_case'],
  ])('%s → %s', (tex, out) => expect(texToHandwriting(tex)).toBe(out))

  test('fractions, sums and roots cannot be written by hand', () => {
    expect(texToHandwriting('\\frac{1}{2}')).toBeNull()
    expect(texToHandwriting('\\sum_{k=0}^{3} k')).toBeNull()
    expect(texToHandwriting('\\sqrt{x}')).toBeNull()
  })

  test('stripTex never leaves a backslash', () => {
    expect(stripTex('\\frac{a}{b} + \\sum x + \\unknown{y}')).not.toMatch(/\\/)
  })
})

describe('board segments', () => {
  test('simple math stays handwriting, Σ goes to KaTeX', () => {
    expect(boardSegments('x(n) = 0 , n < 0 için')).toEqual([{ kind: 'text', text: 'x(n) = 0 , n < 0 için' }])
    const segs = boardSegments('Toplam $\\sum_{k=0}^{3} k$ = 6')
    expect(segs.some((s) => s.kind === 'tex' && s.tex.startsWith('\\sum'))).toBe(true)
  })

  test('plainMath shows no raw LaTeX', () => {
    expect(plainMath('Sonuç $\\frac{1}{2}$ ve $x^2$')).toBe('Sonuç (1)/(2) ve x²')
  })
})

describe('formula vs board text', () => {
  test('a formula that repeats the board is not shown', () => {
    expect(shownFormula('x(n) = 0 , n < 0 için', 'x(n) = 0 \\quad (n < 0)')).toBeNull()
    expect(shownFormula('y(0) = x(0)', 'y(0) = x(0)')).toBeNull()
  })

  test('a formula that adds something is shown', () => {
    const board = 'y(n) = x(n) + 2x(n-1) + 4x(n-2) + 8x(n-3)'
    expect(shownFormula(board, 'y(0) = x(0) + 2x(-1) + 4x(-2) + 8x(-3)')).not.toBeNull()
    expect(formulaView('Toplam', '\\sum_{k=0}^{3} k')).toEqual({ kind: 'tex', tex: '\\sum_{k=0}^{3} k' })
  })

  test('empty or missing formula is nothing', () => {
    expect(shownFormula('a', null)).toBeNull()
    expect(shownFormula('a', '  ')).toBeNull()
  })
})

test('a repeated step number is removed', () => {
  expect(stripStepNumber('1. Tanım', 0)).toBe('Tanım')
  expect(stripStepNumber('Adım 2: Kural', 1)).toBe('Kural')
  expect(stripStepNumber('2. Tanım', 0)).toBe('2. Tanım')
  expect(boardSteps([{ board: '1) x', speech: null }])).toEqual([{ board: 'x', speech: '', sources: [] }])
})

test('the board draws handwriting and KaTeX without raw LaTeX', () => {
  const steps = boardSteps([
    { board: 'Toplam $\\sum_{k=0}^{3} k$', speech: 'Toplam', formula: '\\frac{1}{2}', mark: 'underline', sources: ['04:50'] },
    { board: 'x^{2} \\le 4', speech: 'Kural', formula: null, mark: null, sources: [] },
  ])
  const { container } = render(<Board steps={steps} />)
  expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2)
  const visible = Array.from(container.querySelectorAll('.board-hand')).map((el) => {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('.katex').forEach((k) => k.remove())
    return clone.textContent
  }).join(' ')
  expect(visible).toContain('x² ≤ 4')
  expect(visible).not.toMatch(/\\[a-z]/)
  expect(container.querySelectorAll('li')).toHaveLength(2)
})
