import { beforeEach, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
const intent = vi.hoisted(() => ({ value: null }))
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => { const v = intent.value; intent.value = null; return v } }) }))

const materials = [
  { id: 'file_a', kind: 'TXT', title: 'graf-notlari.txt', status: 'READY' },
  { id: 'pdf_b', kind: 'PDF', title: 'Veri Yapıları Hafta 4', status: 'READY' },
  { id: 'file_c', kind: 'TXT', title: 'islenmemis', status: 'PROCESSING' },
]
beforeEach(() => {
  vi.resetAllMocks()
  intent.value = null
  api.courses.mockResolvedValue([{ id: 'c', name: 'Algoritma' }])
  api.knowledgeMaterials.mockResolvedValue({ materials })
  api.quizzes.mockResolvedValue([{ id: 'h1', topic: 'BFS kuyruğu', kind: 'MULTIPLE_CHOICE', status: 'ANSWERED', latest_outcome: 'CORRECT' }])
  api.examStyles.mockResolvedValue([])
})

test('the basics and the main action are in view, the rest is folded into advanced settings', async () => {
  render(<CourseQuiz courseId="c" />)
  await screen.findByLabelText('Konu')
  expect(screen.getByRole('button', { name: 'Alıştırma hazırla' })).toBeInTheDocument()
  const details = screen.getByText('Gelişmiş ayarlar').closest('details')
  expect(details).not.toHaveAttribute('open')
  expect(screen.getByText('Tüm ders kaynakları', { selector: 'small' })).toBeInTheDocument()
  // basics: course, topic, kind; everything else lives inside the folded part
  expect(details).toContainElement(screen.getByLabelText('Kaynak kapsamı'))
  expect(details).not.toContainElement(screen.getByLabelText('Soru türü'))
})

test('topic suggestions come from earlier practice and ready materials, and fill the topic', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  const group = await screen.findByRole('group', { name: 'Konu önerileri' })
  const names = Array.from(group.querySelectorAll('button')).map((b) => b.textContent)
  expect(names).toEqual(['BFS kuyruğu', 'graf-notlari', 'Veri Yapıları Hafta 4'])
  expect(names).not.toContain('islenmemis')
  await user.click(screen.getByRole('button', { name: 'graf-notlari' }))
  expect(screen.getByLabelText('Konu')).toHaveValue('graf-notlari')
  expect(screen.queryByRole('button', { name: 'graf-notlari' })).toBeNull()
})

test('while a question is prepared the student sees how long and can stop waiting', async () => {
  const user = userEvent.setup()
  let rejectRequest
  api.createQuiz.mockImplementation((c, body, signal) => new Promise((_, reject) => {
    rejectRequest = reject
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  }))
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'BFS')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(await screen.findByRole('button', { name: /Hazırlanıyor… \d+ sn/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'İptal' }))
  expect(api.createQuiz.mock.calls[0][2].aborted).toBe(true)
  expect(await screen.findByRole('alert')).toHaveTextContent('iptal edildi')
  expect(screen.getByRole('alert')).toHaveTextContent('Önceki alıştırmalar')
  expect(screen.getByRole('button', { name: 'Alıştırma hazırla' })).toBeEnabled()
  expect(rejectRequest).toBeTypeOf('function')
})

test('a failure can be retried with one click and keeps the form', async () => {
  const user = userEvent.setup()
  api.createQuiz
    .mockRejectedValueOnce(Object.assign(new Error('Soru hazırlayan yerel model yanıt veremedi.'), { code: 'AI_SERVICE_UNAVAILABLE' }))
    .mockResolvedValueOnce({ id: 'q', topic: 'BFS', kind: 'MULTIPLE_CHOICE', question: 'Soru?', options: ['a', 'b', 'c', 'd'] })
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'BFS')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('yerel model')
  expect(screen.getByLabelText('Konu')).toHaveValue('BFS')
  await user.click(screen.getByRole('button', { name: 'Yeniden dene' }))
  await waitFor(() => expect(api.createQuiz).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('Soru?')).toBeInTheDocument()
})

test('started from the study screen, the quiz stays on that material and says so', async () => {
  intent.value = { topic: 'Genişlik öncelikli arama', materialId: 'file_a', materialTitle: 'graf-notlari.txt' }
  const user = userEvent.setup()
  api.createQuiz.mockResolvedValue({ id: 'q', topic: 'x', kind: 'MULTIPLE_CHOICE', question: 'S?', options: ['a', 'b', 'c', 'd'] })
  render(<CourseQuiz courseId="c" />)
  expect(await screen.findByText(/Çalışma ekranındaki materyalden başlatıldı: graf-notlari.txt/)).toBeInTheDocument()
  expect(screen.getByLabelText('Konu')).toHaveValue('Genişlik öncelikli arama')
  expect(screen.getByText('Gelişmiş ayarlar').closest('details')).toHaveAttribute('open')
  expect(screen.getByLabelText('Kaynak kapsamı')).toHaveValue('active')
  await waitFor(() => expect(screen.getByLabelText('Quiz materyali')).toHaveValue('file_a'))
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(api.createQuiz.mock.calls[0][1].scope).toEqual({ mode: 'selected', material_ids: ['file_a'] })
})
