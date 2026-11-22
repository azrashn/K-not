import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import WrongNotebook from '../../src/components/WrongNotebook'
import { locatorOf, locatorText, openLabel, sourceBadgeText } from '../../src/lib/review'
import { COURSE, fakeApi, signIn } from './fake-api'

const C = COURSE.id
const src = (over = {}) => ({ id: 's'.repeat(64), material_id: 'pdf_a', title: 'Chapter_3', kind: 'PDF', location: { kind: 'page', page: 4 }, ...over })
const item = (id, over = {}) => ({
  quiz_id: id, purpose: 'PRACTICE', topic: 'konu', kind: 'MULTIPLE_CHOICE', question: `Soru ${id}?`, your_answer: 'a', correct_answer: 'c',
  status: 'OPEN', wrong_count: 1, last_answered_at: '2026-11-22T10:00:00Z', source: src(), locator: { type: 'page', page: 4 }, ...over,
})
const group = (items, over = {}) => ({ key: 'pdf_a:p4', material_id: 'pdf_a', title: 'Chapter_3', kind: 'PDF', locator: { type: 'page', page: 4 }, items, ...over })
const review = (groups, unlinked = [], counts) => ({
  groups, unlinked, counts: counts || { open: groups.flatMap((g) => g.items).concat(unlinked).filter((i) => i.status === 'OPEN').length, last_correct: 0 }, mastery_estimated: false,
})
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe('yanlış defteri yardımcıları', () => {
  test('konum: PDF/PPTX sayfa, video zaman, diğerleri ve geçersiz değerler konumsuz', () => {
    expect(locatorOf('PDF', { page: 4 })).toEqual({ type: 'page', page: 4 })
    expect(locatorOf('PPTX', { slide: 2 })).toEqual({ type: 'page', page: 2 })
    expect(locatorOf('VIDEO', { start_ms: 65000 })).toEqual({ type: 'time', start_ms: 65000 })
    expect(locatorOf('PDF', { page: 0 })).toBeNull()
    expect(locatorOf('TEXT', { page: 3 })).toBeNull()
    expect(locatorOf('PDF', undefined)).toBeNull()
  })
  test('etiketler', () => {
    expect(locatorText({ type: 'time', start_ms: 3725000 })).toBe('1:02:05')
    expect(sourceBadgeText('Chapter_3', { type: 'page', page: 4 })).toBe('Kaynak: Chapter_3 · Sayfa 4')
    expect(sourceBadgeText('Ders 1', null)).toBe('Kaynak: Ders 1')
    expect(openLabel({ type: 'page', page: 1 })).toBe('Sayfaya bak')
    expect(openLabel({ type: 'time', start_ms: 0 })).toBe('Bölüme git')
  })
})

describe('Yanlış defteri bileşeni', () => {
  test('son denemede doğru kayıtta eski yanlış cevap "Verdiğin cevap" diye gösterilmez', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/review`]: { body: review([group([item('q1', { status: 'LAST_CORRECT' }), item('q2')])], [], { open: 1, last_correct: 1 }) } })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    await screen.findByText('Soru q1?')
    expect(screen.getByText('Önceki yanlış cevabın: a')).toBeInTheDocument()
    expect(screen.getAllByText(/Verdiğin cevap/)).toHaveLength(1)
  })
  test('boş durum sade metindir', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/review`]: { body: review([]) } })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    expect(await screen.findByText('Yanlış defterin boş.')).toBeInTheDocument()
  })

  test('kaynak sayfaya göre gruplanır; her grupta Sayfaya bak, her satırda Tekrar çöz', async () => {
    signIn()
    const onOpenSource = vi.fn(), onRetry = vi.fn()
    fakeApi({
      [`GET /courses/${C}/review`]: {
        body: review([
          group([item('q1'), item('q2')]),
          group([item('q3', { source: src({ location: { kind: 'page', page: 9 } }), locator: { type: 'page', page: 9 } })], { key: 'pdf_a:p9', locator: { type: 'page', page: 9 } }),
        ]),
      },
    })
    render(<WrongNotebook courseId={C} onOpenSource={onOpenSource} onRetry={onRetry} />)
    const g4 = await screen.findByRole('region', { name: 'Kaynak: Chapter_3 · Sayfa 4' })
    expect(within(g4).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Kaynak: Chapter_3 · Sayfa 9' })).toBeInTheDocument()
    expect(screen.getByTestId('review-counts')).toHaveTextContent('3 bekleyen · 0 son denemede doğru')
    await userEvent.click(within(g4).getByRole('button', { name: 'Sayfaya bak' }))
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ material_id: 'pdf_a', id: 's'.repeat(64) }), 'Kaynak: Chapter_3 · Sayfa 4')
    await userEvent.click(within(g4).getAllByRole('button', { name: 'Tekrar çöz' })[1])
    expect(onRetry).toHaveBeenCalledWith('q2')
  })

  test('doğru cevap varsayılan olarak kapalıdır (tekrar çözmeden önce görünmez)', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/review`]: { body: review([group([item('q1')])]) } })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    const summary = await screen.findByText('Doğru cevabı göster')
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })

  test('video kaynağında Bölüme git; alıntısız soruda kaynak bağlantısı yoktur', async () => {
    signIn()
    fakeApi({
      [`GET /courses/${C}/review`]: {
        body: review(
          [group([item('v1', { source: src({ kind: 'VIDEO', material_id: 'video_v', title: 'Ders 1', location: { start_ms: 65000 } }), locator: { type: 'time', start_ms: 65000 } })],
            { key: 'video_v:t65000', material_id: 'video_v', title: 'Ders 1', kind: 'VIDEO', locator: { type: 'time', start_ms: 65000 } })],
          [item('u1', { source: null, locator: null })],
        ),
      },
    })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    expect(await screen.findByRole('button', { name: 'Bölüme git' })).toBeInTheDocument()
    const unlinked = screen.getByRole('region', { name: 'Kaynak bağlantısı olmayan sorular' })
    expect(within(unlinked).queryByRole('button', { name: /Sayfaya bak|Bölüme git/ })).toBeNull()
    expect(within(unlinked).getByRole('button', { name: 'Tekrar çöz' })).toBeInTheDocument()
  })

  test('son denemede doğru olan soru silinmez, etiketle görünür', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/review`]: { body: review([group([item('q1', { status: 'LAST_CORRECT' })])], [], { open: 0, last_correct: 1 }) } })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    expect(await screen.findByText('Son denemede doğru', { selector: '.source-badge' })).toBeInTheDocument()
    expect(screen.getByTestId('review-counts')).toHaveTextContent('0 bekleyen · 1 son denemede doğru')
  })

  test('hata durumunda yeniden dene çalışır', async () => {
    signIn()
    let calls = 0
    fakeApi({ [`GET /courses/${C}/review`]: () => (++calls === 1 ? { status: 500, body: { error: { code: 'X', message: 'x' } } } : { body: review([]) }) })
    render(<WrongNotebook courseId={C} onOpenSource={() => {}} onRetry={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Yeniden dene' }))
    await waitFor(() => expect(screen.getByText('Yanlış defterin boş.')).toBeInTheDocument())
  })
})
