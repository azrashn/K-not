import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import App from '../../src/App'
import CoverageMap from '../../src/components/CoverageMap'
import { pageRanges, rangesText, daysUntil } from '../../src/lib/coverage'
import * as session from '../../src/api/session'
import { COURSE, doc, fakeApi, signIn } from './fake-api'

const C = COURSE.id
const pages = (count, asked = [], practiced = []) =>
  Array.from({ length: count }, (_, i) => ({ page: i + 1, asked: asked.includes(i + 1), studied: false, practiced: practiced.includes(i + 1) }))
const material = (asked, practiced, count = 14, kind = 'PDF') => {
  const p = pages(count, asked, practiced)
  const untouched = p.filter((x) => !x.asked && !x.practiced).map((x) => x.page)
  return { material_id: 'pdf_m1', source_id: 'm1', kind, title: 'Hafta5_Heap.pdf', page_count: count, touched_count: count - untouched.length, pages: p, untouched_pages: untouched }
}
const coverage = (m) => ({ materials: m ? [m] : [], recorded: { asked: true, studied: false, practiced: true } })
const setExam = (daysFromNow) => {
  const d = new Date(Date.now() + daysFromNow * 86400000)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  localStorage.setItem(session.userScopedKey('knot-exam'), JSON.stringify({ title: 'Vize', date }))
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

describe('coverage helpers', () => {
  test('ardışık sayfalar aralık olur', () => {
    expect(rangesText(pageRanges([12, 4, 7, 9, 10, 11, 4]))).toBe('4, 7, 9–12')
    expect(pageRanges([])).toEqual([])
  })
  test('kalan gün takvim gününe göre hesaplanır', () => {
    expect(daysUntil('2026-11-23', new Date(2026, 10, 20, 23, 30))).toBe(3)
    expect(daysUntil('2026-11-20', new Date(2026, 10, 20, 8))).toBe(0)
  })
})

describe('Kapsam bölümü', () => {
  test('ızgara yalnızca kayıtlı sayfaları işaretler, sayıları gerçek veriden gösterir', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([2, 3], [3, 5])) } })
    render(<CoverageMap courseId={C} />)
    const total = await screen.findByTestId('coverage-total')
    expect(total).toHaveTextContent('3 / 14 sayfaya dokundun')
    const cell = (n) => document.querySelector(`.coverage-cell[data-page="${n}"]`)
    expect(cell(2)).toHaveAccessibleName('Sayfa 2: soruldu')
    expect(cell(3)).toHaveAccessibleName('Sayfa 3: soruldu, alıştırmada çıktı')
    expect(cell(5)).toHaveAccessibleName('Sayfa 5: alıştırmada çıktı')
    expect(cell(1)).toHaveAccessibleName('Sayfa 1: dokunulmadı')
    expect(cell(1)).toHaveAttribute('data-touched', 'false')
    expect(cell(1)).toHaveTextContent('')
    expect(cell(3)).toHaveTextContent('SA')
    expect(document.querySelectorAll('.coverage-cell[data-touched="true"]')).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(/%|hazır(lık|sın)/i)
  })

  test('boş durum: kayıt yoksa yalnızca açıklama', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([], [])) } })
    render(<CoverageMap courseId={C} />)
    expect(await screen.findByText('Henüz kayıtlı bir çalışma yok.')).toBeInTheDocument()
    expect(document.querySelector('.coverage-cell')).toBeNull()
  })

  test('sınav tarihi yokken sınav metni ve dokunulmayan liste görünmez', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([2], [])) } })
    render(<CoverageMap courseId={C} />)
    await screen.findByTestId('coverage-total')
    expect(screen.queryByTestId('coverage-exam')).toBeNull()
    expect(screen.queryByText(/Hiç bakmadığın/)).toBeNull()
    expect(screen.queryByText(/Sınav/)).toBeNull()
  })

  test('tarih varsa kalan gün ve aralıklı dokunulmayan sayfalar; numara tıklanınca sayfa açılır', async () => {
    signIn()
    setExam(3)
    // dokunulan: 1,2,3,5,6,8,13,14  -> dokunulmayan: 4, 7, 9–12
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([1, 2, 3, 5, 6, 8], [13, 14])) } })
    const onOpen = vi.fn()
    render(<CoverageMap courseId={C} onOpenPage={onOpen} />)
    const exam = await screen.findByTestId('coverage-exam')
    expect(exam).toHaveTextContent('Sınava 3 gün var: hiç bakmadığın 6 sayfa var.')
    const list = screen.getByTestId('coverage-untouched')
    expect(list).toHaveTextContent('Hiç bakmadığın sayfalar: 4, 7, 9–12')
    await userEvent.click(within(list).getByRole('button', { name: /sayfa 9 aç/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ source_id: 'm1' }), 9)
    await userEvent.click(document.querySelector('.coverage-cell[data-page="4"]'))
    expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ source_id: 'm1' }), 4)
  })

  test('geçmiş sınav tarihi için geri sayım gösterilmez', async () => {
    signIn()
    setExam(-2)
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([1], [])) } })
    render(<CoverageMap courseId={C} />)
    await screen.findByTestId('coverage-total')
    expect(screen.queryByTestId('coverage-exam')).toBeNull()
  })

  test('klavye: tek tab durağı, ok tuşları kareler arasında gezer', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([1], [])) } })
    render(<CoverageMap courseId={C} />)
    await screen.findByTestId('coverage-total')
    expect(document.querySelectorAll('.coverage-cell[tabindex="0"]')).toHaveLength(1)
    document.querySelector('.coverage-cell[data-page="1"]').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-page', '3'))
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-page', '14'))
  })

  test('300 sayfalık materyal 300 kare çizer', async () => {
    signIn()
    fakeApi({ [`GET /courses/${C}/coverage`]: { body: coverage(material([1, 300], [], 300)) } })
    render(<CoverageMap courseId={C} />)
    await screen.findByTestId('coverage-total')
    expect(document.querySelectorAll('.coverage-cell')).toHaveLength(300)
  })

  test('ders ekranında Kapsam bölümü açılır; sayfa numarası çalışma masasında o sayfayı açar', async () => {
    signIn()
    setExam(5)
    fakeApi({
      [`GET /courses/${C}`]: { body: COURSE },
      [`GET /courses/${C}/documents`]: { body: [doc('m1', 'READY')] },
      [`GET /courses/${C}/coverage`]: { body: coverage(material([1], [], 5)) },
    })
    window.location.hash = `#/dersler/${C}`
    render(<App />)
    const link = await screen.findByRole('button', { name: /sayfa 5 aç/ })
    await userEvent.click(link)
    await waitFor(() => expect(window.location.hash).toBe(`#/dersler/${C}/ogrenme`))
  })
})
