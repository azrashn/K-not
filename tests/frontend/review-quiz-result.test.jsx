import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { api } from '../../src/api/endpoints'
vi.mock('../../src/api/endpoints')
const nav = vi.hoisted(() => vi.fn())
vi.mock('../../src/app/store', () => ({
  useApp: () => ({ navigate: nav, takeIntent: () => null }),
}))
vi.mock('../../src/app/auth', () => ({
  useAuth: () => ({ user: { display_name: 'Ada' } }),
}))
beforeAll(() => {
  for (const method of ['showModal', 'close'])
    if (!HTMLDialogElement.prototype[method])
      Object.defineProperty(HTMLDialogElement.prototype, method, { configurable: true, writable: true, value() {} })
})
beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Physics', documents: { total: 0 }, material_count: 0 }])
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
})
afterEach(() => vi.restoreAllMocks())

async function solve(result) {
  const user = userEvent.setup()
  api.createQuiz.mockResolvedValue({ id: 'q', kind: 'CLOZE', question: 'Water _____', options: [] })
  api.answerQuiz.mockResolvedValue({ message: 'Geri bildirim', expected: 'evaporates', quote: 'Water evaporates', ...result })
  render(<CourseQuiz courseId="c" />)
  await user.type(screen.getByLabelText('Konu'), 'Water')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  await user.type(await screen.findByLabelText('Yanıtın'), 'x')
  await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
  await screen.findByText('Geri bildirim')
  return user
}
const pdf = { id: 's', material_id: 'pdf_a', title: 'Chapter_3', kind: 'PDF', location: { kind: 'page', page: 4 } }

test('yanlış cevapta kaynak rozeti ve "Sayfaya bak"; tıklayınca o kaynak açılır', async () => {
  const user = await solve({ score: 0, source: pdf })
  expect(screen.getByText('Kaynak: Chapter_3 · Sayfa 4')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Sayfaya bak' }))
  expect(nav).toHaveBeenCalledWith('/dersler/c/ogrenme', expect.objectContaining({ openSource: expect.objectContaining(pdf) }))
})

test('doğru cevapta rozet yok; küçük kaynak bağlantısı kalır', async () => {
  await solve({ score: 1, source: pdf })
  expect(screen.queryByText(/^Kaynak: /)).toBeNull()
  expect(screen.queryByRole('button', { name: 'Sayfaya bak' })).toBeNull()
  expect(screen.getByRole('button', { name: 'İlgili kaynağı aç →' })).toBeInTheDocument()
})

test('alıntısı/kaynağı olmayan yanlış soruda bağlantı ve rozet gösterilmez', async () => {
  await solve({ score: 0, source: null })
  expect(screen.queryByText(/^Kaynak: /)).toBeNull()
  expect(screen.queryByRole('button', { name: /Sayfaya bak|Bölüme git|İlgili kaynağı aç/ })).toBeNull()
})

test('konumu olmayan kaynakta sayfa uydurulmaz; video kaynağı "Bölüme git" olur', async () => {
  await solve({ score: 0, source: { ...pdf, location: undefined } })
  expect(screen.queryByText(/Sayfa \d/)).toBeNull()
  expect(screen.getByRole('button', { name: 'İlgili kaynağı aç →' })).toBeInTheDocument()
})

test('video kaynağında rozet zaman gösterir', async () => {
  await solve({ score: 0, source: { id: 's', material_id: 'video_v', title: 'Ders 1', kind: 'VIDEO', location: { start_ms: 65000 } } })
  expect(screen.getByText('Kaynak: Ders 1 · 1:05')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bölüme git' })).toBeInTheDocument()
})
