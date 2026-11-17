import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { describeExamStyle, examStyleProblem } from '../../src/lib/exam-style'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
const nav = vi.hoisted(() => vi.fn())
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: nav, takeIntent: () => null }) }))

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

test('a saved exam style chosen in the advanced settings is sent with the practice request', async () => {
  const user = userEvent.setup()
  api.createQuizSet.mockResolvedValue({ id: 's', status: 'READY', requested: 10, produced: 10, questions: [] })
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'FIFO')
  await user.click(screen.getByText('Gelişmiş ayarlar'))
  await user.selectOptions(await screen.findByLabelText('Sınav stili'), 'e1')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(api.createQuizSet.mock.calls[0][1]).toMatchObject({ count: 10, topics: ['FIFO'], exam_style_id: 'e1' })
})

test('without a chosen style the request carries none', async () => {
  const user = userEvent.setup()
  api.createQuizSet.mockResolvedValue({ id: 's', status: 'READY', requested: 10, produced: 10, questions: [] })
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'FIFO')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(api.createQuizSet.mock.calls[0][1]).not.toHaveProperty('exam_style_id')
})

test('exams live in their own menu; the practice form only points there', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  await user.click(await screen.findByText('Gelişmiş ayarlar'))
  expect(screen.queryByRole('button', { name: /Geçmiş sınav ekle|Sınav hazırla/ })).not.toBeInTheDocument()
  expect(screen.getByText(/soldaki/)).toHaveTextContent('Sınav menüsünü kullan')
})
