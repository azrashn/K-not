import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { describeExamStyle, examStyleProblem } from '../../src/lib/exam-style'
import { api } from '../../src/api/endpoints'
import { ApiError } from '../../src/api/client'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => null }) }))

const EXAM = '1. Hangisi FIFO çalışır?\nA) Yığın\nB) Kuyruk\nC) Ağaç\n2. Dijkstra negatif kenarla çalışır mı? Doğru veya yanlış yazınız.'
const style = { id: 'e1', name: 'Final 2025', profile: { question_count: 2, formats: { MULTIPLE_CHOICE: 1, TRUE_FALSE: 1, CALCULATION: 0, OPEN: 0 } } }

beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Algoritma' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([style])
})

test('exam-style helpers describe the profile and refuse an empty or too-short exam', () => {
  expect(describeExamStyle(style.profile)).toBe('2 soru · çoktan seçmeli 1 · doğru/yanlış 1')
  expect(examStyleProblem({ name: '', text: EXAM })).toBe('Sınava bir ad verin.')
  expect(examStyleProblem({ name: 'x', text: 'kısa' })).toMatch(/en az 20/)
  expect(examStyleProblem({ name: 'x', text: EXAM })).toBe('')
})

test('a saved exam style is saved, selected, and sent with the next practice request', async () => {
  const user = userEvent.setup()
  api.createExamStyle.mockResolvedValue({ ...style, id: 'e2', name: 'Vize 2026', profile: style.profile })
  api.createQuiz.mockResolvedValue({ id: 'q', topic: 'FIFO', kind: 'MULTIPLE_CHOICE', question: 'Soru?', options: ['a', 'b', 'c', 'd'] })
  render(<CourseQuiz courseId="c" />)

  await screen.findByRole('heading', { name: 'Sınav stilleri' })
  await user.type(screen.getByLabelText('Sınav adı'), 'Vize 2026')
  await user.type(screen.getByLabelText('Sınav metni'), EXAM)
  await user.click(screen.getByRole('button', { name: 'Stili kaydet' }))
  expect(api.createExamStyle).toHaveBeenCalledWith('c', { name: 'Vize 2026', text: EXAM })

  const select = await screen.findByLabelText('Sınav stili')
  expect(select).toHaveValue('e2')
  await user.type(screen.getByLabelText('Konu'), 'FIFO')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(api.createQuiz.mock.calls[0][1]).toMatchObject({ kind: 'MULTIPLE_CHOICE', exam_style_id: 'e2' })
})

test('without a chosen style the request carries no style, and an unnumbered exam is refused by the server message', async () => {
  const user = userEvent.setup()
  api.createExamStyle.mockRejectedValue(new ApiError({ status: 422, code: 'VALIDATION_ERROR', message: 'Sınav soruları numaralandırılmış olmalı (1. … 2. …).' }))
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Sınav adı'), 'Düz')
  await user.type(screen.getByLabelText('Sınav metni'), 'Bu düz bir metin, numarasız ve yeterince uzun olsun.')
  await user.click(screen.getByRole('button', { name: 'Stili kaydet' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('numaralandırılmış')
  expect(screen.getByLabelText('Sınav stili')).toHaveValue('')
})

test('a saved style can be removed from the list', async () => {
  const user = userEvent.setup()
  api.deleteExamStyle.mockResolvedValue({ deleted: true })
  render(<CourseQuiz courseId="c" />)
  await screen.findByRole('option', { name: 'Final 2025' })
  const row = screen.getByText('Final 2025', { selector: 'strong' }).closest('.resume-row')
  await user.click(within(row).getByRole('button', { name: 'Sil' }))
  expect(api.deleteExamStyle).toHaveBeenCalledWith('c', 'e1')
})
