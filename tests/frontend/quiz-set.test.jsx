import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import QuizSetRunner from '../../src/components/QuizSetRunner'
import { api } from '../../src/api/endpoints'
import { answerStats, parseCount, parseTopics, topicVerdict } from '../../src/lib/quiz-set'

vi.mock('../../src/api/endpoints')
const nav = vi.fn()
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: nav, takeIntent: () => null }) }))

const mk = (i, over = {}) => ({
  id: `q${i}`, index: i, topic: i % 2 ? 'Kalıtım' : 'Polimorfizm', kind: 'MULTIPLE_CHOICE',
  difficulty: ['easy', 'medium', 'hard'][i % 3], focus: 'definition',
  question: `Soru metni ${i}?`, options: [`a${i}`, `b${i}`, `c${i}`, `d${i}`], available: true, ...over,
})
const questions = [1, 2, 3].map((i) => mk(i))
const set = { id: 's1', title: 'Set', status: 'READY', requested: 3, produced: 3, questions, result: null }
const source = { id: 'seg', material_id: 'pdf_a', title: 'Java Ders Notu', location: { page: 4 } }
const result = {
  summary: {
    total: 3, answered: 2, correct: 1, wrong: 1, blank: 1, percent: 33,
    by_topic: [{ key: 'Kalıtım', total: 2, correct: 2, wrong: 0, blank: 0, percent: 100 }, { key: 'Polimorfizm', total: 1, correct: 0, wrong: 1, blank: 0, percent: 0 }],
    by_difficulty: [{ key: 'easy', total: 1, correct: 1, wrong: 0, blank: 0, percent: 100 }, { key: 'hard', total: 2, correct: 0, wrong: 1, blank: 1, percent: 0 }],
    by_focus: [{ key: 'definition', total: 3, correct: 1, wrong: 1, blank: 1, percent: 33 }],
  },
  items: [1, 2, 3].map((i) => ({
    index: i, quiz_id: `q${i}`, topic: i === 2 ? 'Polimorfizm' : 'Kalıtım', kind: 'MULTIPLE_CHOICE', difficulty: 'easy', focus: 'definition',
    question: `Soru metni ${i}?`, answered: i !== 3, correct: i === 1, response: i === 3 ? null : '0',
    options: [0, 1, 2, 3].map((k) => ({ index: k, text: `opt${k}`, correct: k === 1, chosen: i !== 3 && k === 0, feedback: `Neden ${k}` })),
    expected: 'opt1', explanation: `Açıklama ${i} nesne sınıftan türer.`, quote: 'Kaynak alıntısı', source,
  })),
}

beforeEach(() => {
  vi.resetAllMocks()
  nav.mockReset()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Java' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([])
})

test('count rules: whole numbers 5 to 25, topics split on commas', () => {
  expect(parseCount('10')).toEqual({ value: 10, error: '' })
  expect(parseCount('5').value).toBe(5)
  expect(parseCount('25').value).toBe(25)
  for (const bad of ['4', '26', '7.5', '', 'abc', '-3']) expect(parseCount(bad).error).toMatch(/5 ile 25/)
  expect(parseTopics('Kalıtım, Polimorfizm;\nkalıtım , Interface')).toEqual(['Kalıtım', 'Polimorfizm', 'Interface'])
  expect(answerStats(questions, { q1: '0', q3: ' ' })).toMatchObject({ answered: 1, unanswered: 2, unansweredIndexes: [1, 2] })
  expect(topicVerdict(result.summary.by_topic)).toEqual({ weak: ['Polimorfizm'], strong: ['Kalıtım'] })
})

test('default is 10, presets and manual input work, out-of-range blocks the button', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  const input = await screen.findByLabelText('Soru sayısı')
  expect(input).toHaveValue(10)
  await user.click(screen.getByRole('button', { name: '25' }))
  expect(input).toHaveValue(25)
  await user.type(screen.getByLabelText('Konu'), 'Kalıtım, Polimorfizm')
  await user.clear(input)
  await user.type(input, '30')
  expect(screen.getByRole('button', { name: 'Alıştırma hazırla' })).toBeDisabled()
  expect(screen.getAllByRole('alert')[0]).toHaveTextContent('5 ile 25')
  await user.clear(input)
  await user.type(input, '7')
  expect(screen.getByRole('button', { name: 'Alıştırma hazırla' })).toBeEnabled()
})

test('progress is shown while generating and the quiz opens only when every question exists', async () => {
  const user = userEvent.setup()
  api.createQuizSet.mockResolvedValue({ id: 's1', status: 'GENERATING', requested: 5, produced: 2 })
  api.quizSet
    .mockResolvedValueOnce({ id: 's1', status: 'GENERATING', requested: 5, produced: 4 })
    .mockResolvedValueOnce({ ...set, requested: 5, produced: 5 })
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'Kalıtım, Polimorfizm')
  await user.click(screen.getByRole('button', { name: '5' }))
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(await screen.findByText('2 / 5 soru hazır')).toBeInTheDocument()
  expect(screen.queryByText('Soru metni 1?')).toBeNull() // nothing to answer yet
  expect(api.createQuizSet.mock.calls[0][1]).toMatchObject({ count: 5, topics: ['Kalıtım', 'Polimorfizm'] })
  expect(await screen.findByText('Soru 1 / 3', {}, { timeout: 6000 })).toBeInTheDocument()
}, 10000)

test('a set that could not be completed is never opened and says why', async () => {
  const user = userEvent.setup()
  api.createQuizSet.mockResolvedValue({ id: 's1', status: 'GENERATING', requested: 10, produced: 1 })
  api.quizSet.mockResolvedValue({ id: 's1', status: 'FAILED', requested: 10, produced: 3, note: '10 sorudan 3’ü hazırlanabildi; eksik set başlatılmaz.' })
  render(<CourseQuiz courseId="c" />)
  await user.type(await screen.findByLabelText('Konu'), 'Kalıtım')
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
  expect(await screen.findByRole('alert', {}, { timeout: 6000 })).toHaveTextContent('eksik set başlatılmaz')
  expect(screen.queryByText(/Soru 1 \//)).toBeNull()
}, 10000)

test('one question at a time, free navigation, answers can change, no timer anywhere', async () => {
  const user = userEvent.setup()
  render(<QuizSetRunner set={set} submit={vi.fn()} onOpenSource={vi.fn()} onNewSet={vi.fn()} />)
  expect(screen.getByText('Soru 1 / 3')).toBeInTheDocument()
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  expect(screen.queryByText('Soru metni 2?')).toBeNull()
  await user.click(screen.getByLabelText('b1'))
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
  expect(screen.getByText('Soru 2 / 3')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '← Önceki' }))
  expect(screen.getByLabelText('b1')).toBeChecked()
  await user.click(screen.getByLabelText('c1')) // change the answer
  expect(screen.getByLabelText('c1')).toBeChecked()
  expect(screen.getByRole('button', { name: 'Soru 1, yanıtlandı' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Soru 2, yanıtsız' })).toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/süre|kalan zaman|geri sayım|\d+:\d{2}/i)
})

test('review lists blanks; finishing sends only answered questions and shows the detailed result', async () => {
  const user = userEvent.setup()
  const submit = vi.fn().mockResolvedValue(result)
  render(<QuizSetRunner set={set} submit={submit} onOpenSource={nav} onNewSet={vi.fn()} />)
  await user.click(screen.getByLabelText('a1'))
  await user.click(screen.getByRole('button', { name: /Gözden geçir ve bitir/ }))
  expect(screen.getByText(/1 \/ 3 soru yanıtlandı/)).toHaveTextContent('2 soru yanıtsız')
  const rows = screen.getAllByRole('listitem')
  expect(within(rows[1]).getByText('Boş')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Alıştırmayı bitir' }))
  expect(submit).toHaveBeenCalledWith([{ quiz_id: 'q1', response: '0' }])
  // totals, topic and difficulty breakdown, explanations, source link
  expect(await screen.findByText('Sonuç: %33')).toBeInTheDocument()
  const tiles = screen.getByText('Toplam soru').closest('dl')
  expect(tiles).toHaveTextContent('Toplam soru3')
  expect(tiles).toHaveTextContent('Doğru1')
  expect(tiles).toHaveTextContent('Yanlış1')
  expect(tiles).toHaveTextContent('Boş1')
  expect(screen.getByText(/Tekrar etmen gereken konular/)).toHaveTextContent('Polimorfizm')
  expect(screen.getByText(/Güçlü olduğun konular/)).toHaveTextContent('Kalıtım')
  expect(screen.getByRole('img', { name: 'Kolay: yüzde 100' })).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Zor: yüzde 0' })).toBeInTheDocument()
  expect(screen.getByText('Açıklama 2 nesne sınıftan türer.')).toBeInTheDocument()
  expect(screen.getByText('Bu soruyu boş bıraktın.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Yanlış ve boş (2)' }))
  expect(screen.queryByText('Soru metni 1?')).toBeNull()
  await user.click(screen.getAllByRole('button', { name: /Java Ders Notu · sayfa 4/ })[0])
  expect(nav).toHaveBeenCalledWith(source)
})

test('a failed submission keeps the answers so they can be sent again', async () => {
  const user = userEvent.setup()
  const submit = vi.fn().mockRejectedValueOnce(new Error('Bağlantı kurulamadı')).mockResolvedValueOnce(result)
  render(<QuizSetRunner set={set} submit={submit} onOpenSource={vi.fn()} onNewSet={vi.fn()} />)
  await user.click(screen.getByLabelText('a1'))
  await user.click(screen.getByRole('button', { name: /Gözden geçir ve bitir/ }))
  await user.click(screen.getByRole('button', { name: 'Alıştırmayı bitir' }))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Alıştırmayı bitir' }))
  expect(submit).toHaveBeenCalledTimes(2)
  expect(submit.mock.calls[1][0]).toEqual([{ quiz_id: 'q1', response: '0' }])
  expect(await screen.findByText('Sonuç: %33')).toBeInTheDocument()
})

test('an already submitted set opens on its stored result', () => {
  render(<QuizSetRunner set={{ ...set, result }} submit={vi.fn()} onOpenSource={vi.fn()} onNewSet={vi.fn()} />)
  expect(screen.getByText('Sonuç: %33')).toBeInTheDocument()
})
