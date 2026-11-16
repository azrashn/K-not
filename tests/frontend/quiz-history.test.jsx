import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { filterHistory, historyLabel, summarizeHistory } from '../../src/lib/quiz-history'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => null }) }))

const items = [
  { id: 'a', kind: 'MULTIPLE_CHOICE', topic: 'BFS kuyruğu', status: 'ANSWERED', latest_outcome: 'CORRECT', attempt_count: 2 },
  { id: 'b', kind: 'SHORT_ANSWER', topic: 'DFS yığını', status: 'ANSWERED', latest_outcome: 'REVIEW_SOURCE', attempt_count: 1 },
  { id: 'c', kind: 'CLOZE', topic: 'Dijkstra', status: 'UNANSWERED', latest_outcome: null, attempt_count: 0 },
]

beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Algoritma' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
  api.quizzes.mockResolvedValue(items)
})

test('labels separate unanswered questions from answered ones', () => {
  expect(historyLabel(items[0])).toBe('Doğru')
  expect(historyLabel(items[1])).toBe('Kaynağı incele')
  expect(historyLabel(items[2])).toBe('Yanıt bekliyor')
  expect(historyLabel({ status: 'ANSWERED', latest_outcome: 'UNKNOWN' })).toBe('Yanıtlandı')
})

test('filters and summary count only what the server reports', () => {
  expect(summarizeHistory(items)).toEqual({ total: 3, answered: 2, unanswered: 1, correct: 1 })
  expect(filterHistory(items, 'unanswered').map((i) => i.id)).toEqual(['c'])
  expect(filterHistory(items, 'answered').map((i) => i.id)).toEqual(['a', 'b'])
  expect(filterHistory(items, 'all')).toHaveLength(3)
})

test('practice page shows the summary and filters the history list', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 soru · 2 yanıtlandı · 1 yanıt bekliyor')
  const list = () => screen.getAllByRole('button').filter((b) => b.classList.contains('resume-row'))
  expect(list().map((b) => b.textContent)).toEqual([
    expect.stringContaining('Doğru'), expect.stringContaining('Kaynağı incele'), expect.stringContaining('Yanıt bekliyor'),
  ])
  const group = screen.getByRole('group', { name: 'Alıştırma filtresi' })
  await user.click(within(group).getByRole('button', { name: 'Yanıt bekleyen' }))
  expect(list().map((b) => b.textContent)).toEqual([expect.stringContaining('Dijkstra')])
  expect(within(group).getByRole('button', { name: 'Yanıt bekleyen' })).toHaveAttribute('aria-pressed', 'true')
})
