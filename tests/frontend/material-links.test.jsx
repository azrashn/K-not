import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaterialLinks, { clock } from '../../src/components/MaterialLinks'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
const videoLink = {
  source_id: 'a'.repeat(64), material_id: 'video_v', title: 'Hafta 3 dersi', kind: 'VIDEO',
  location: { kind: 'video', start_ms: 312000, end_ms: 340000 }, shared_terms: ['TCP', 'SYN'], estimated: true, basis: 'screen',
}
const pageLink = {
  source_id: 'b'.repeat(64), material_id: 'pdf_c', title: 'Chapter_3', kind: 'PDF',
  location: { kind: 'page', page: 4 }, shared_terms: [], estimated: true,
}
beforeEach(() => { vi.resetAllMocks() })

const videoPanel = (props = {}) =>
  render(<MaterialLinks mode="video" courseId="c" materialId="pdf_n" page={4} onOpen={vi.fn()} {...props} />)

test('the button is collapsed until clicked, then asks for the current page', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [videoLink] })
  videoPanel()
  const button = screen.getByRole('button', { name: 'Videoda anlatılışı' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(api.materialLinks).not.toHaveBeenCalled()
  await user.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(api.materialLinks).toHaveBeenCalledWith('c', 'pdf_n', { page: 4 }, expect.any(AbortSignal))
  const region = await screen.findByRole('region', { name: 'Videoda benzer anlatımlar' })
  expect(within(region).getByText('Benzer anlatım · tahmini eşleşme')).toBeInTheDocument()
  expect(within(region).getByText('05:12')).toBeInTheDocument()
  expect(within(region).getByText('TCP')).toBeInTheDocument()
  expect(region.textContent).not.toMatch(/%/)
})

test('an empty result says so plainly and invents nothing', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [] })
  videoPanel()
  await user.click(screen.getByRole('button', { name: 'Videoda anlatılışı' }))
  expect(await screen.findByText('Bu sayfa için videoda belirgin bir benzer anlatım bulunamadı.')).toBeInTheDocument()
  expect(screen.queryAllByRole('listitem')).toHaveLength(0)
})

test('choosing a row opens it and closes the panel; at most three rows show', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [videoLink, { ...videoLink, source_id: 'c'.repeat(64) }, { ...videoLink, source_id: 'd'.repeat(64) }, { ...videoLink, source_id: 'e'.repeat(64) }] })
  const onOpen = vi.fn()
  videoPanel({ onOpen })
  await user.click(screen.getByRole('button', { name: 'Videoda anlatılışı' }))
  const rows = await screen.findAllByRole('listitem')
  expect(rows).toHaveLength(3)
  await user.click(within(rows[0]).getByRole('button'))
  expect(onOpen).toHaveBeenCalledWith(videoLink)
  expect(screen.queryByRole('region')).toBeNull()
})

test('Escape closes the panel and returns focus to the button', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [videoLink] })
  videoPanel()
  const button = screen.getByRole('button', { name: 'Videoda anlatılışı' })
  await user.click(button)
  const row = await screen.findByRole('button', { name: /Hafta 3 dersi/ })
  row.focus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('region')).toBeNull()
  expect(button).toHaveFocus()
  expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('an error shows a short message and retry asks again', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockRejectedValueOnce(new Error('Sunucuya ulaşılamadı.')).mockResolvedValueOnce({ links: [videoLink] })
  videoPanel()
  await user.click(screen.getByRole('button', { name: 'Videoda anlatılışı' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Eşleşmeler alınamadı')
  await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))
  expect(await screen.findByText('Hafta 3 dersi')).toBeInTheDocument()
  expect(api.materialLinks).toHaveBeenCalledTimes(2)
})

test('video mode asks with the playback time and lists pages', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [pageLink] })
  const onOpen = vi.fn()
  render(<MaterialLinks mode="page" courseId="c" materialId="video_v" getTimeMs={() => 61500} onOpen={onOpen} />)
  await user.click(screen.getByRole('button', { name: 'Bu anın slaydı' }))
  expect(api.materialLinks).toHaveBeenCalledWith('c', 'video_v', { timeMs: 61500 }, expect.any(AbortSignal))
  await user.click(await screen.findByRole('button', { name: /Chapter_3/ }))
  expect(screen.queryByText('Chapter_3')).toBeNull()
  expect(onOpen).toHaveBeenCalledWith(pageLink)
})

test('clock pads minutes and seconds', () => {
  expect(clock(0)).toBe('00:00')
  expect(clock(312000)).toBe('05:12')
  expect(clock(3_725_000)).toBe('62:05')
})

test('the basis of a match is stated: text on screen or similar speech', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [videoLink, { ...pageLink, basis: 'speech' }] })
  videoPanel()
  await user.click(screen.getByRole('button', { name: 'Videoda anlatılışı' }))
  expect(await screen.findByText('Ekranda benzer yazı')).toBeInTheDocument()
  expect(screen.getByText('Benzer konuşma')).toBeInTheDocument()
})

test('while the video screen text is still being read it says so instead of claiming no match', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValueOnce({ links: [], preparing: true }).mockResolvedValueOnce({ links: [videoLink], preparing: false })
  videoPanel()
  await user.click(screen.getByRole('button', { name: 'Videoda anlatılışı' }))
  expect(await screen.findByText(/ilk kez okunuyor/)).toBeInTheDocument()
  expect(screen.queryByText(/belirgin bir benzer anlatım bulunamadı/)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))
  expect(await screen.findByText('Hafta 3 dersi')).toBeInTheDocument()
})

test('the panel is placed against the window: never wider than the screen, never cut off at the left or right edge', async () => {
  const user = userEvent.setup()
  api.materialLinks.mockResolvedValue({ links: [videoLink] })
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
  window.innerWidth = 1000
  videoPanel()
  const button = screen.getByRole('button', { name: 'Videoda anlatılışı' })
  // a button at the far left of a narrow pane, and one at the far right
  for (const [left, expected] of [[2, 8], [980, 1000 - 352 - 8]]) {
    spy.mockReturnValue({ left, right: left + 120, top: 100, bottom: 130, width: 120, height: 30, x: left, y: 100, toJSON() {} })
    await user.click(button)
    const region = await screen.findByRole('region', { name: 'Videoda benzer anlatımlar' })
    expect(region.style.position).toBe('fixed')
    expect(parseInt(region.style.left, 10)).toBe(expected)
    expect(parseInt(region.style.width, 10)).toBeLessThanOrEqual(352)
    await user.click(button) // close
  }
  window.innerWidth = 300
  spy.mockReturnValue({ left: 10, right: 130, top: 100, bottom: 130, width: 120, height: 30, x: 10, y: 100, toJSON() {} })
  await user.click(button)
  const narrow = await screen.findByRole('region', { name: 'Videoda benzer anlatımlar' })
  expect(parseInt(narrow.style.width, 10)).toBe(300 - 16)
  spy.mockRestore()
})
