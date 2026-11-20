import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MaterialFind from '../../src/components/MaterialFind'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
const material = { id: 'pdf_a', title: 'Notlar' }
const result = {
  query: 'kuyruk', segments_searched: 4,
  hits: [
    { segment_id: 's1', location: { kind: 'page', page: 3 }, count: 2, snippet: '…bir kuyruk kullanır ve kuyruk…', match_start: 5, match_end: 11 },
    { segment_id: 's2', location: { kind: 'page', page: 7 }, count: 1, snippet: 'Kuyruk FIFO çalışır.', match_start: 0, match_end: 6 },
  ],
}
beforeEach(() => { vi.resetAllMocks() })

test('a search lists the sections with the match highlighted and opens the chosen one', async () => {
  const user = userEvent.setup()
  api.materialFind.mockResolvedValue(result)
  const open = vi.fn()
  render(<MaterialFind courseId="c" material={material} labelOf={(l) => `Sayfa ${l.page}`} onOpenSource={open} />)
  await user.type(screen.getByLabelText('Belge içinde ara', { selector: 'input' }), 'kuyruk')
  await user.click(screen.getByRole('button', { name: 'Ara' }))
  expect(api.materialFind).toHaveBeenCalledWith('c', 'pdf_a', 'kuyruk')
  expect(await screen.findByText('2 bölümde bulundu')).toBeInTheDocument()
  const items = screen.getAllByRole('listitem')
  expect(within(items[0]).getByText('kuyruk', { selector: 'mark' })).toBeInTheDocument()
  expect(within(items[0]).getByText('Sayfa 3 · 2×')).toBeInTheDocument()
  await user.click(within(items[1]).getByRole('button'))
  expect(open).toHaveBeenCalledWith({ id: 's2', location: { kind: 'page', page: 7 } })
})

test('no hit is said plainly and a too short query is not sent', async () => {
  const user = userEvent.setup()
  api.materialFind.mockResolvedValue({ query: 'zzz', hits: [], segments_searched: 4 })
  render(<MaterialFind courseId="c" material={material} onOpenSource={vi.fn()} />)
  const box = screen.getByLabelText('Belge içinde ara', { selector: 'input' })
  await user.type(box, 'a')
  expect(screen.getByRole('button', { name: 'Ara' })).toBeDisabled()
  await user.type(box, 'zz')
  await user.click(screen.getByRole('button', { name: 'Ara' }))
  expect(await screen.findByText('“azz” bu materyalde bulunamadı.')).toBeInTheDocument()
})

test('a server error is shown and a different material does not inherit the old results', async () => {
  const user = userEvent.setup()
  api.materialFind.mockRejectedValue(Object.assign(new Error('Arama en az 2 karakter olmalı.'), { code: 'VALIDATION_ERROR' }))
  const { rerender } = render(<MaterialFind courseId="c" material={material} onOpenSource={vi.fn()} />)
  await user.type(screen.getByLabelText('Belge içinde ara', { selector: 'input' }), 'kuyruk')
  await user.click(screen.getByRole('button', { name: 'Ara' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('en az 2')
  rerender(<MaterialFind courseId="c" material={{ id: 'pdf_b' }} onOpenSource={vi.fn()} />)
  expect(screen.queryByRole('alert')).toBeNull()
})
