import { beforeAll, beforeEach, afterEach, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CourseEditor, CourseRemoval } from '../../src/components/ProductUI'
import CourseQuiz from '../../src/pages/CourseQuiz'
import HomeDashboard from '../../src/pages/HomeDashboard'
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
      Object.defineProperty(HTMLDialogElement.prototype, method, {
        configurable: true,
        writable: true,
        value() {},
      })
})
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
    function () {
      this.setAttribute('open', '')
    },
  )
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(
    function () {
      this.removeAttribute('open')
    },
  )
  api.courses.mockResolvedValue([
    { id: 'c', name: 'Physics', documents: { total: 0 }, material_count: 0 },
  ])
  api.quizzes.mockResolvedValue([])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
})
afterEach(() => vi.restoreAllMocks())
test('course editor submits real values and preserves failed edits for retry', async () => {
  const user = userEvent.setup(),
    saved = vi.fn()
  api.createCourse
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ id: 'c', name: 'Mechanics' })
  render(<CourseEditor onClose={vi.fn()} onSaved={saved} />)
  await user.type(screen.getByLabelText('Ders adı'), 'Mechanics')
  await user.click(screen.getByRole('button', { name: 'Dersi oluştur' }))
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Ders adı')).toHaveValue('Mechanics')
  expect(saved).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Dersi oluştur' }))
  await waitFor(() =>
    expect(saved).toHaveBeenCalledWith({ id: 'c', name: 'Mechanics' }),
  )
  expect(api.createCourse).toHaveBeenLastCalledWith({
    name: 'Mechanics',
    description: '',
    category: '',
  })
})
test('permanent course removal is disabled until exact confirmation, server failure stays visible', async () => {
  const user = userEvent.setup()
  api.deleteCourse.mockRejectedValue(new Error('unavailable'))
  render(
    <CourseRemoval
      course={{ id: 'c', name: 'Physics' }}
      onClose={vi.fn()}
      onRemoved={vi.fn()}
    />,
  )
  const button = screen.getByRole('button', { name: 'Kalıcı olarak sil' })
  expect(button).toBeDisabled()
  await user.type(
    screen.getByLabelText('Onaylamak için “Physics” yaz'),
    'Physic',
  )
  expect(button).toBeDisabled()
  await user.type(screen.getByLabelText('Onaylamak için “Physics” yaz'), 's')
  await user.click(button)
  expect(api.deleteCourse).toHaveBeenCalledWith('c', 'Physics')
  await screen.findByRole('alert')
})
test('quiz grade and exact source navigation use persisted server result', async () => {
  const user = userEvent.setup(),
    source = { id: 's', material_id: 'file_a', title: 'Physics' }
  api.createQuiz.mockResolvedValue({
    id: 'q',
    kind: 'CLOZE',
    question: 'Water _____',
    options: [],
  })
  api.answerQuiz.mockResolvedValue({
    score: 0,
    message: 'Review the exact source',
    expected: 'evaporates',
    quote: 'Water evaporates',
    source,
  })
  render(<CourseQuiz courseId="c" />)
  await user.type(screen.getByLabelText('Konu'), 'Water')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  await user.type(await screen.findByLabelText('Yanıtın'), 'wrong')
  await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
  await screen.findByText('Review the exact source')
  expect(api.answerQuiz).toHaveBeenCalledWith('c', 'q', 'wrong')
  await user.click(screen.getByRole('button', { name: 'İlgili kaynağı aç →' }))
  expect(nav).toHaveBeenCalledWith('/dersler/c/ogrenme', { openSource: source })
})
test('home displays missing-data state instead of sample exams or mastery', async () => {
  api.learningOverview.mockResolvedValue({
    activities: [],
    attempts: [],
    graded_count: 0,
    mastery_estimated: false,
  })
  render(<HomeDashboard />)
  await screen.findByText('İlk çalışma adımın')
  expect(screen.queryByText(/Vize ·|%82|60 saat/)).toBeNull()
  expect(screen.getByText('Physics')).toBeVisible()
})
