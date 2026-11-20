import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TranscriptChunk from '../../src/components/TranscriptChunk'

const chunk = { index: 2, text: 'bfs bir kuyruk kullanir', start_seconds: 65, end_seconds: 70, corrected: false }
const props = () => ({ chunk, active: false, onSeek: vi.fn(), onSave: vi.fn().mockResolvedValue({}), onRevert: vi.fn().mockResolvedValue({}) })
beforeEach(() => vi.resetAllMocks())

test('the line seeks to its time and offers a fix', async () => {
  const user = userEvent.setup(), p = props()
  render(<TranscriptChunk {...p} />)
  expect(screen.getByText('1:05')).toBeInTheDocument()
  await user.click(screen.getByText('bfs bir kuyruk kullanir'))
  expect(p.onSeek).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Düzeltildi')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Düzeltmeyi geri al' })).toBeNull()
})

test('a fix starts from the current text, is saved by index and closes the editor', async () => {
  const user = userEvent.setup(), p = props()
  render(<TranscriptChunk {...p} />)
  await user.click(screen.getByRole('button', { name: 'Düzelt' }))
  const box = screen.getByLabelText('Düzeltilmiş metin')
  expect(box).toHaveValue('bfs bir kuyruk kullanir')
  await user.clear(box)
  await user.type(box, 'BFS bir kuyruk kullanır')
  await user.click(screen.getByRole('button', { name: 'Kaydet' }))
  expect(p.onSave).toHaveBeenCalledWith(2, 'BFS bir kuyruk kullanır')
  expect(screen.queryByLabelText('Düzeltilmiş metin')).toBeNull()
})

test('cancel discards the edit, an empty text cannot be saved', async () => {
  const user = userEvent.setup(), p = props()
  render(<TranscriptChunk {...p} />)
  await user.click(screen.getByRole('button', { name: 'Düzelt' }))
  await user.clear(screen.getByLabelText('Düzeltilmiş metin'))
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
  await user.type(screen.getByLabelText('Düzeltilmiş metin'), 'başka')
  await user.click(screen.getByRole('button', { name: 'Vazgeç' }))
  expect(p.onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Düzelt' }))
  expect(screen.getByLabelText('Düzeltilmiş metin')).toHaveValue('bfs bir kuyruk kullanir')
})

test('a corrected line says so, keeps the original readable and can be undone', async () => {
  const user = userEvent.setup(), p = props()
  render(<TranscriptChunk {...p} chunk={{ ...chunk, text: 'BFS bir kuyruk kullanır', corrected: true, original_text: 'bfs bir kuyruk kullanir' }} />)
  expect(screen.getByText('Düzeltildi')).toBeInTheDocument()
  expect(screen.getByText('bfs bir kuyruk kullanir')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Düzeltmeyi geri al' }))
  expect(p.onRevert).toHaveBeenCalledWith(2)
})

test('a server refusal is shown and the editor stays open for another try', async () => {
  const user = userEvent.setup(), p = props()
  p.onSave.mockRejectedValue(Object.assign(new Error('Düzeltme 1-3000 karakter arasında bir metin olmalı.'), { code: 'VALIDATION_ERROR' }))
  render(<TranscriptChunk {...p} />)
  await user.click(screen.getByRole('button', { name: 'Düzelt' }))
  await user.type(screen.getByLabelText('Düzeltilmiş metin'), ' x')
  await user.click(screen.getByRole('button', { name: 'Kaydet' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('1-3000 karakter')
  expect(screen.getByLabelText('Düzeltilmiş metin')).toBeInTheDocument()
})

test('a line mixed with characters of other alphabets is replaced by a notice, the raw text is one click away and the line still seeks', async () => {
  const user = userEvent.setup(), p = props()
  const garbledChunk = { ...chunk, text: 'Hocada bu実 retaliту. Pakat kastanın 只有一 haklı' }
  render(<TranscriptChunk {...p} chunk={garbledChunk} />)
  expect(screen.queryByText(/只有一/)).toBeNull()
  expect(screen.getByText(/otomatik metni güvenilir görünmüyor/)).toBeInTheDocument()
  await user.click(screen.getByText(/otomatik metni güvenilir görünmüyor/))
  expect(p.onSeek).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Yine de göster' }))
  expect(screen.getByText(/只有一/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Düzelt' })).toBeInTheDocument()
})

test('ordinary Turkish and English lines, and corrected lines, are shown as they are', () => {
  const p = props()
  const { rerender } = render(<TranscriptChunk {...p} chunk={{ ...chunk, text: 'Çok güzel bir ağaç şeması: öğrenci şöyle yazdı' }} />)
  expect(screen.getByText(/Çok güzel bir ağaç/)).toBeInTheDocument()
  rerender(<TranscriptChunk {...p} chunk={{ ...chunk, text: 'routers, switches and end devices' }} />)
  expect(screen.getByText(/routers, switches/)).toBeInTheDocument()
  rerender(<TranscriptChunk {...p} chunk={{ ...chunk, text: 'düzeltilmiş 只有 метин', original_text: 'x', corrected: true }} />)
  expect(screen.getByText(/düzeltilmiş/)).toBeInTheDocument()
})
