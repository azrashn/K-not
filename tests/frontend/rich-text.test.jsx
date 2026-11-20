import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import RichText from '../../src/components/RichText'
import { parseBlocks, parseInline, parseMath } from '../../src/lib/rich-text'

test('fenced code becomes a block, an unclosed fence stays text', () => {
  expect(parseBlocks('Önce:\n```python\nfor i in range(3):\n    print(i)\n```\nSonra.')).toEqual([
    { type: 'paragraph', text: 'Önce:' },
    { type: 'code', lang: 'python', text: 'for i in range(3):\n    print(i)' },
    { type: 'paragraph', text: 'Sonra.' },
  ])
  expect(parseBlocks('```js\nconsole.log(1)')[0].type).toBe('paragraph')
  expect(parseBlocks('a\n\nb')).toHaveLength(2)
  expect(parseBlocks('')).toEqual([])
})

test('inline code and formulas are found, money and plain dollars are not formulas', () => {
  expect(parseInline('`queue.pop()` çağrılır').map((p) => p.type)).toEqual(['code', 'text'])
  expect(parseInline('Karmaşıklık $O(n^2)$ olur.').map((p) => p.type)).toEqual(['text', 'math', 'text'])
  expect(parseInline('Bunun \\(x_i\\) değeri').map((p) => p.type)).toEqual(['text', 'math', 'text'])
  expect(parseInline('Fiyat $5 ve $6 olur').map((p) => p.type)).toEqual(['text'])
  expect(parseInline('$ boş $ değil').map((p) => p.type)).toEqual(['text'])
})

test('a small LaTeX subset is understood and the rest stays as typed', () => {
  expect(parseMath('x^2 + y_{i+1}')).toEqual([
    { t: 'text', v: 'x' }, { t: 'sup', v: [{ t: 'text', v: '2' }] }, { t: 'text', v: ' + y' }, { t: 'sub', v: [{ t: 'text', v: 'i+1' }] },
  ])
  expect(parseMath('\\alpha \\leq \\infty')[0]).toEqual({ t: 'text', v: 'α ≤ ∞' })
  expect(parseMath('\\sqrt{a}')[0]).toMatchObject({ t: 'sqrt' })
  expect(parseMath('\\frac{a}{b}')[0]).toMatchObject({ t: 'frac' })
  expect(parseMath('\\unknowncmd')[0]).toEqual({ t: 'text', v: '\\unknowncmd' })
})

test('it renders elements, never HTML: markup in the text is shown, not run', () => {
  const { container } = render(<RichText text={'<img src=x onerror=alert(1)> ve $a^2$\n```\n<script>alert(1)</script>\n```'} />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
  expect(container.querySelector('pre code').textContent).toBe('<script>alert(1)</script>')
})

test('code is a focusable labelled block and a formula has a readable name', () => {
  render(<RichText text={'```python\nprint(1)\n```\nKarmaşıklık $O(n^2)$'} />)
  expect(screen.getByLabelText('python kod')).toHaveAttribute('tabindex', '0')
  const math = screen.getByRole('math')
  expect(math).toHaveAttribute('aria-label', 'O(n^2)')
  expect(math.querySelector('sup').textContent).toBe('2')
})

test('plain answers with citation markers render unchanged', () => {
  render(<RichText text={'Kuyruk FIFO çalışır. [1]'} />)
  expect(screen.getByText('Kuyruk FIFO çalışır. [1]')).toBeInTheDocument()
})
