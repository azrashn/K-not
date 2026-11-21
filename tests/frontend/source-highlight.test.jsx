import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DocumentCanvas from '../../src/components/DocumentCanvas'
import MarkedText from '../../src/components/MarkedText'
import LearningWorkspace from '../../src/pages/LearningWorkspace'
import { api } from '../../src/api/endpoints'
import { foldWithMap, highlightBoxes, matchQuote, sentenceSpans } from '../../src/lib/quote-match'

vi.mock('../../src/api/endpoints')
const intent = vi.hoisted(() => ({ current: null }))
const nav = vi.hoisted(() => vi.fn())
vi.mock('../../src/app/store', () => ({
  useApp: () => ({ navigate: nav, takeIntent: () => { const i = intent.current; intent.current = null; return i } }),
}))
vi.mock('../../src/hooks/useVideoProgress', () => ({ useVideoProgress: () => ({ flushForQuestion: vi.fn().mockResolvedValue(true) }) }))

const scrolled = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  intent.current = null
  Element.prototype.scrollIntoView = scrolled
})

describe('matching a quote in source text', () => {
  test('line breaks, extra spaces, a line-end hyphen and case do not prevent an exact match', () => {
    const text = 'Giriş.\nİlkel  VERİ tipleri bel-\nlekte doğrudan\n tutulur. Son.'
    const found = matchQuote(text, 'İlkel veri tipleri bellekte doğrudan tutulur.')
    expect(found).toMatchObject({ exact: true })
    expect(text.slice(found.start, found.end)).toBe('İlkel  VERİ tipleri bel-\nlekte doğrudan\n tutulur')
  })

  test('Turkish dotted and dotless i meet, and typographic quotes are plain', () => {
    expect(matchQuote('IŞIK hızı “sabittir”.', 'ışık hızı "sabittir"')).toMatchObject({ exact: true, start: 0 })
    expect(foldWithMap('TİP').norm).toBe('tip')
  })

  test('without an exact match the closest sentence is marked, not an invented span', () => {
    const text = 'Java 1995 yılında çıktı. Kalıtım bir sınıfın özelliklerini başka bir sınıfa aktarır. Son cümle.'
    const found = matchQuote(text, 'Kalıtım, bir sınıfın özelliklerini diğer sınıfa aktarmasıdır')
    expect(found.exact).toBe(false)
    expect(text.slice(found.start, found.end)).toBe('Kalıtım bir sınıfın özelliklerini başka bir sınıfa aktarır.')
  })

  test('nothing close enough: no mark at all', () => {
    expect(matchQuote('Java 1995 yılında çıktı.', 'Çöp toplayıcı belleği geri kazanır')).toBeNull()
    expect(matchQuote('Metin', '')).toBeNull()
  })

  test('a sentence broken over lines stays one sentence', () => {
    const text = 'Bir cümle\nikinci satırda biter. Yeni.'
    expect(sentenceSpans(text).map((s) => text.slice(s.start, s.end))).toEqual(['Bir cümle\nikinci satırda biter.', 'Yeni.'])
  })

  test('word boxes: the matched words, one box per line, across a line-end hyphen', () => {
    const lines = [
      [['Önce', 0.1, 0.1, 0.2, 0.12], ['ilkel', 0.21, 0.1, 0.3, 0.12], ['tip-', 0.31, 0.1, 0.4, 0.12]],
      [['ler', 0.1, 0.13, 0.15, 0.15], ['sekizdir.', 0.16, 0.13, 0.3, 0.15], ['Sonra', 0.31, 0.13, 0.4, 0.15]],
    ]
    const r = highlightBoxes(lines, 'İlkel tipler sekizdir')
    expect(r.exact).toBe(true)
    expect(r.boxes).toHaveLength(2)
    expect(r.boxes[0]).toMatchObject({ x: 0.21, y: 0.1 })
    expect(r.boxes[0].width).toBeCloseTo(0.19)
    expect(r.boxes[1]).toMatchObject({ x: 0.1, y: 0.13 })
    expect(r.boxes[1].width).toBeCloseTo(0.2)
    expect(highlightBoxes([], 'x y z')).toBeNull()
  })
})

describe('the page view marks the quote from the text layer', () => {
  const material = { id: 'pdf_a', kind: 'PDF', title: 'Notlar', page_count: 3 }
  const source = { id: 's2', location: { kind: 'page', page: 2 } }
  const props = (over = {}) => ({
    courseId: 'c', material, source, segments: [source], onSource: vi.fn(), onViewportChange: vi.fn(), onShowText: vi.fn(),
    highlight: { page: 2, quote: 'İlkel veri tipleri sekiz tanedir' }, ...over,
  })

  test('the words of the quote get highlighter boxes, the view scrolls to them', async () => {
    api.knowledgeVisual.mockResolvedValue(new Blob(['png']))
    api.knowledgeVisualText.mockResolvedValue({ lines: [[['İlkel', 0.1, 0.2, 0.2, 0.22], ['veri', 0.21, 0.2, 0.3, 0.22], ['tipleri', 0.31, 0.2, 0.4, 0.22]], [['sekiz', 0.1, 0.23, 0.2, 0.25], ['tanedir.', 0.21, 0.23, 0.3, 0.25]]] })
    const { container } = render(<DocumentCanvas {...props()} />)
    expect(await screen.findByText('Sorunun dayandığı cümle sayfada işaretlendi.')).toBeInTheDocument()
    expect(api.knowledgeVisualText).toHaveBeenCalledWith('c', 'pdf_a', 2, expect.any(AbortSignal))
    const marks = container.querySelectorAll('.page-highlight')
    expect(marks).toHaveLength(2)
    expect(marks[0].style.left).toBe('10%')
    expect(marks[0].dataset.strength).toBeUndefined()
    await waitFor(() => expect(scrolled).toHaveBeenCalled())
  })

  test('no text layer on the page (scanned): says so and offers the marked text', async () => {
    const user = userEvent.setup()
    const p = props()
    api.knowledgeVisual.mockResolvedValue(new Blob(['png']))
    api.knowledgeVisualText.mockResolvedValue({ lines: [] })
    const { container } = render(<DocumentCanvas {...p} />)
    await user.click(await screen.findByRole('button', { name: 'Metinde işaretli göster →' }))
    expect(p.onShowText).toHaveBeenCalled()
    expect(container.querySelector('.page-highlight')).toBeNull()
  })

  test('a page image that cannot be shown switches to the text view by itself', async () => {
    const p = props()
    api.knowledgeVisual.mockRejectedValue(new Error('renderer down'))
    render(<DocumentCanvas {...p} />)
    await waitFor(() => expect(p.onShowText).toHaveBeenCalled())
    expect(api.knowledgeVisualText).not.toHaveBeenCalled()
  })

  test('on another page nothing is asked or marked', async () => {
    api.knowledgeVisual.mockResolvedValue(new Blob(['png']))
    render(<DocumentCanvas {...props({ highlight: { page: 3, quote: 'x y z' } })} />)
    await screen.findByRole('img')
    expect(api.knowledgeVisualText).not.toHaveBeenCalled()
  })
})

test('the text view marks the quote with <mark>; the closest sentence is marked as partial', () => {
  const { container, rerender } = render(<p><MarkedText text={'Önce. İlkel veri\ntipleri sekizdir. Son.'} quote="ilkel veri tipleri sekizdir" /></p>)
  const mark = container.querySelector('mark.evidence')
  expect(mark.textContent).toBe('İlkel veri\ntipleri sekizdir')
  expect(mark.dataset.strength).toBeUndefined()
  expect(scrolled).toHaveBeenCalled()
  rerender(<p><MarkedText text="Önce. İlkel veri tipleri tam sekiz tanedir. Son." quote="ilkel veri tipleri sekizdir" /></p>)
  expect(container.querySelector('mark.evidence').dataset.strength).toBe('partial')
  rerender(<p><MarkedText text="Hiç ilgisiz." quote="ilkel veri tipleri sekizdir" /></p>)
  expect(container.querySelector('mark')).toBeNull()
})

test('"İlgili kaynağı aç" from a quiz opens the source with its sentence marked in the text', async () => {
  const txt = { id: 'file_notes', kind: 'TXT', source_id: 'notes', title: 'Notlar', status: 'READY' }
  const seg = { id: 'seg2', material_id: txt.id, text: 'Java 1995te çıktı. İlkel veri tipleri sekiz tanedir. Son.', location: { kind: 'text' } }
  intent.current = { openSource: { id: 'seg2', material_id: txt.id, quote: 'İlkel veri tipleri sekiz tanedir.' } }
  api.conversations.mockResolvedValue([])
  api.activity.mockResolvedValue({})
  api.course.mockResolvedValue({ name: 'Java' })
  api.knowledgeMaterials.mockResolvedValue({ materials: [txt] })
  api.knowledgeSource.mockResolvedValue(seg)
  api.knowledgePreview.mockResolvedValue({ material: txt, segments: [seg] })
  const { container } = render(<LearningWorkspace courseId="c" />)
  await waitFor(() => expect(container.querySelector('mark.evidence')).not.toBeNull())
  expect(container.querySelector('mark.evidence').textContent).toBe('İlkel veri tipleri sekiz tanedir')
  expect(screen.getByRole('tab', { name: 'Metin' })).toHaveAttribute('aria-selected', 'true')
})

describe('"← Soruya dön" on a source opened from a question', () => {
  const txt = { id: 'file_notes', kind: 'TXT', source_id: 'notes', title: 'Notlar', status: 'READY' }
  const seg = { id: 'seg2', material_id: txt.id, text: 'İlkel veri tipleri sekiz tanedir.', location: { kind: 'text' } }
  const open = (returnTo) => {
    intent.current = { openSource: { id: 'seg2', material_id: txt.id, quote: 'İlkel veri tipleri sekiz tanedir.' }, returnTo }
    api.conversations.mockResolvedValue([])
    api.activity.mockResolvedValue({})
    api.course.mockResolvedValue({ name: 'Java' })
    api.knowledgeMaterials.mockResolvedValue({ materials: [txt] })
    api.knowledgeSource.mockResolvedValue(seg)
    api.knowledgePreview.mockResolvedValue({ material: txt, segments: [seg] })
    return render(<LearningWorkspace courseId="c" />)
  }

  test('goes back to the same question (the address holds the exam, mode and question)', async () => {
    const user = userEvent.setup()
    open('/dersler/c/sinavlar?exam=x1&mode=solve&q=2')
    await user.click(await screen.findByRole('button', { name: '← Soruya dön' }))
    expect(nav).toHaveBeenCalledWith('/dersler/c/sinavlar?exam=x1&mode=solve&q=2')
    expect(screen.queryByRole('button', { name: '← Derslerin' })).toBeNull()
  })

  test('only a quiz or exam page of the app is a way back; otherwise the usual "← Derslerin"', async () => {
    const { container } = open('https://example.com/x')
    await waitFor(() => expect(container.querySelector('mark.evidence')).not.toBeNull())
    expect(screen.queryByRole('button', { name: '← Soruya dön' })).toBeNull()
    expect(screen.getByRole('button', { name: '← Derslerin' })).toBeInTheDocument()
  })
})
