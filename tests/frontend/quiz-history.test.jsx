import { beforeEach, expect, test, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import {
  doneText, filterCounts, filterHistory, groupHistory, historyLabel, historySummary, meaningfulTopic, progressText,
  questionStatus, summarizeHistory, visibleCards,
} from '../../src/lib/quiz-history'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => null }) }))

const at = (min) => `2026-11-20T10:${String(min).padStart(2, '0')}:00.000Z`
const row = (id, over = {}) => ({
  id, kind: 'MULTIPLE_CHOICE', topic: 'Veri tipleri', status: 'UNANSWERED', latest_outcome: null, attempt_count: 0,
  question: `Soru ${id} nedir?`, section: null, set_id: null, set_title: null, created_at: at(0), ...over,
})
const answered = (outcome) => ({ status: 'ANSWERED', latest_outcome: outcome, attempt_count: 1 })

// A 4-question set (2 answered: 1 correct, 1 wrong), a finished 2-question set and a single question
// whose topic box was empty. The server lists the newest first.
const items = [
  row('s3', { set_id: 'A', set_title: 'Veri tipleri', created_at: at(13), kind: 'OPEN' }),
  row('s2', { set_id: 'A', set_title: 'Veri tipleri', created_at: at(12), kind: 'TRUE_FALSE' }),
  row('s1', { set_id: 'A', set_title: 'Veri tipleri', created_at: at(11), ...answered('REVIEW_SOURCE') }),
  row('s0', { set_id: 'A', set_title: 'Veri tipleri', created_at: at(10), ...answered('CORRECT') }),
  row('single', { topic: '', section: 'Nesne yönelimli programlama', created_at: at(5), kind: 'SHORT_ANSWER', ...answered('REVIEW_REQUIRED') }),
  row('d1', { set_id: 'B', topic: '2 Dakikada Java   Java Nedir, Ne İşe Yarar', created_at: at(2), ...answered('CORRECT') }),
  row('d0', { set_id: 'B', topic: '2 Dakikada Java   Java Nedir, Ne İşe Yarar', created_at: at(1), kind: 'OPEN', ...answered('REFLECTION_SAVED') }),
]
const exam = [
  row('e1', { set_id: 'X', set_title: 'Vize provası', topic: 'Kalıtım', kind: 'OPEN' }),
  row('e2', { set_id: 'X', set_title: 'Vize provası', topic: 'Bellek' }),
]

beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Java' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
  api.quizzes.mockImplementation(async (_course, _signal, purpose) => (purpose === 'EXAM' ? exam : items))
  api.examStyles.mockResolvedValue([])
})

test('each question has its own status and tone; open answers are never graded', () => {
  expect(questionStatus(items[3])).toEqual({ label: 'Doğru', tone: 'ok' })
  expect(questionStatus(items[2])).toEqual({ label: 'Yanlış', tone: 'no' })
  expect(questionStatus(items[4])).toEqual({ label: 'Kaynağı incele', tone: 'warn' })
  expect(questionStatus(items[6])).toEqual({ label: 'Açık uçlu', tone: 'warn' })
  expect(questionStatus(items[0])).toEqual({ label: 'Yanıt bekliyor', tone: 'wait' })
  expect(historyLabel({ status: 'ANSWERED', latest_outcome: 'UNKNOWN' })).toBe('Yanıtlandı')
})

test('one card per set; a single question is a row titled by its own question', () => {
  const cards = groupHistory(items)
  expect(cards.map((c) => [c.title, c.single, c.total, c.answered, c.graded, c.correct, c.done])).toEqual([
    ['Veri tipleri', false, 4, 2, 3, 1, false], // OPEN is not graded
    ['Soru single nedir?', true, 1, 1, 0, 0, true],
    ['Java Nedir', false, 2, 2, 1, 1, true], // topic-title.js: the subject, not the whole video title
  ])
  expect(cards[0].kind).toBe('Karışık')
  expect(cards[0].questions.map((q) => q.id)).toEqual(['s0', 's1', 's2', 's3']) // in the order written
  expect(cards[0].next.id).toBe('s2') // the first unanswered one
  expect(groupHistory([row('x', { topic: '', set_id: 'S', question: null })])[0].title).toBe('Karışık alıştırma')
  expect(groupHistory(exam, { exam: true }).map((c) => [c.title, c.total])).toEqual([['Vize provası', 2]])
})

test('the topic is a title only when it means something; else the section, else the first question', () => {
  expect(meaningfulTopic('Veri tipleri')).toBe('Veri tipleri')
  expect(meaningfulTopic('nesne yönelimli programlama')).toBe('Nesne yönelimli programlama')
  expect(meaningfulTopic('JVM')).toBe('JVM')
  for (const bad of ['kalıtım', 'çevrilir', 'Kaynak kod bytecode a çevrilir', 'Çalışabilmesinin', 'Programın çalıştırılmasının',
    'g, float, double, char ve', 'verilere yalnızca metotlar aracılığıyla eri…', 'Sınıf ve', 'verilere yalnızca metotlar aracılığıyla eri', ''])
    expect(meaningfulTopic(bad)).toBeNull()
  const set = (topic, over = {}) => [row('a', { set_id: 'S', topic, ...over }), row('b', { set_id: 'S', topic, ...over })]
  expect(groupHistory(set('kalıtım', { section: 'Kalıtım ve çok biçimlilik' }))[0].title).toBe('Kalıtım ve çok biçimlilik')
  expect(groupHistory(set('Kaynak kod bytecode a çevrilir', { question: 'Java kaynak kodu neye çevrilir?' }))[0].title)
    .toBe('Java kaynak kodu neye çevrilir?')
})

test('every green "Doğru" counts, a matched short answer too; open reflections never count', () => {
  const reflective = groupHistory([
    row('o1', { set_id: 'R', kind: 'OPEN', ...answered('REFLECTION_SAVED') }),
    row('o2', { set_id: 'R', kind: 'SHORT_ANSWER', ...answered('REVIEW_REQUIRED') }),
    row('o3', { set_id: 'R', kind: 'OPEN' }),
    row('o4', { set_id: 'R', kind: 'SHORT_ANSWER' }),
  ])[0]
  // Nothing here can be right or wrong yet: no "0 doğru".
  expect([reflective.graded, reflective.correct]).toEqual([0, 0])
  expect(progressText(reflective)).toBe('2/4 yanıtlandı')
  expect(historySummary('answered', [reflective])).toBe('2 soru yanıtlandı')
  expect(doneText(groupHistory([row('o1', { set_id: 'R', kind: 'OPEN', ...answered('REFLECTION_SAVED') })])[0])).toBe('Tamamlandı')

  const matched = groupHistory([
    row('a1', { set_id: 'S', kind: 'SHORT_ANSWER', ...answered('CORRECT') }),
    row('a2', { set_id: 'S', kind: 'SHORT_ANSWER', ...answered('REVIEW_REQUIRED') }),
    row('a3', { set_id: 'S', kind: 'OPEN', ...answered('REFLECTION_SAVED') }),
  ])[0]
  expect(questionStatus(matched.questions[0]).label).toBe('Doğru')
  expect([matched.graded, matched.correct]).toEqual([1, 1]) // the green one counts; the unmatched short answer is not graded
  expect(progressText(matched)).toBe('3/3 yanıtlandı · 1 doğru')
  expect(doneText(matched)).toBe('Tamamlandı · 1/1')

  const mixed = groupHistory([
    row('m1', { set_id: 'M', ...answered('CORRECT') }),
    row('m2', { set_id: 'M', kind: 'CLOZE', ...answered('CORRECT') }),
    row('m3', { set_id: 'M', kind: 'TRUE_FALSE', ...answered('REVIEW_SOURCE') }),
    row('m4', { set_id: 'M', kind: 'SHORT_ANSWER', ...answered('CORRECT') }),
    row('m5', { set_id: 'M', kind: 'OPEN', ...answered('REFLECTION_SAVED') }),
  ])[0]
  expect(progressText(mixed)).toBe('5/5 yanıtlandı · 3 doğru')
  expect(doneText(mixed)).toBe('Tamamlandı · 3/4')
  // The count equals the green labels on the rows.
  expect(mixed.correct).toBe(mixed.questions.filter((q) => questionStatus(q).label === 'Doğru').length)
})

test('filters count questions; the summary follows the chosen filter', () => {
  expect(filterCounts(items, exam)).toEqual({ all: 7, unanswered: 2, answered: 5, exam: 2 })
  const cards = groupHistory(items)
  expect(visibleCards(cards, 'unanswered').map((c) => c.title)).toEqual(['Veri tipleri'])
  expect(historySummary('all', cards)).toBe('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  expect(historySummary('unanswered', visibleCards(cards, 'unanswered'))).toBe('2 soru yanıt bekliyor · 1 alıştırmada')
  expect(historySummary('answered', cards)).toBe('5 soru yanıtlandı · 2 doğru')
  expect(summarizeHistory(items)).toEqual({ total: 7, answered: 5, unanswered: 2, graded: 4, correct: 2 })
  expect(filterHistory(items, 'unanswered').map((i) => i.id)).toEqual(['s3', 's2'])
})

const cardsOnScreen = () => screen.getAllByRole('listitem').filter((li) => li.classList.contains('quiz-history-card'))
const rowsOnScreen = () => screen.getAllByRole('listitem').filter((li) => li.classList.contains('quiz-history-row'))
const group = () => screen.getByRole('group', { name: 'Alıştırma filtresi' })

test('the page shows cards, not one line per question; a card opens to its questions', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  expect(await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')).toBeInTheDocument()
  expect(cardsOnScreen()).toHaveLength(2)
  const [first, done] = cardsOnScreen()
  expect(within(first).getByText('2/4 yanıtlandı · 1 doğru')).toBeInTheDocument()
  expect(within(first).getByText(/4 soru · Karışık/)).toBeInTheDocument()
  expect(within(done).getByText('Tamamlandı · 1/1')).toBeInTheDocument() // the open answer is not graded
  expect(within(done).queryByRole('button', { name: /Devam et/ })).not.toBeInTheDocument()

  const head = within(first).getByRole('button', { name: /^Veri tipleri/ })
  expect(head).toHaveAttribute('aria-expanded', 'false')
  expect(first.querySelector('.quiz-history-questions')).not.toBeVisible()
  await user.click(head)
  expect(head).toHaveAttribute('aria-expanded', 'true')
  const questions = within(first).getAllByRole('button').filter((b) => b.closest('.quiz-history-questions'))
  expect(questions.map((b) => b.textContent)).toEqual([
    'Soru s0 nedir?Doğru', 'Soru s1 nedir?Yanlış', 'Soru s2 nedir?Yanıt bekliyor', 'Soru s3 nedir?Yanıt bekliyor',
  ])
  expect(within(first).getByText('Doğru')).toHaveAttribute('data-tone', 'ok')
  expect(within(first).getByText('Yanlış')).toHaveAttribute('data-tone', 'no')
})

test('"Devam et" opens the first unanswered question of the set, inside the set', async () => {
  const user = userEvent.setup()
  const q = (id) => ({ id, topic: 'Veri tipleri', kind: 'OPEN', question: `Soru ${id} nedir?`, options: [], available: true })
  api.quizSet.mockResolvedValue({ id: 'A', type: 'quiz_set', status: 'READY', requested: 4, produced: 4, failures: [], note: null,
    source_warning: null, questions: [q('s0'), q('s1'), q('s2'), q('s3')] })
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  const [first] = cardsOnScreen()
  await user.click(within(first).getByRole('button', { name: 'Devam et: Veri tipleri' }))
  expect(api.quizSet).toHaveBeenCalledWith('c', 'A')
  expect(await screen.findByRole('heading', { name: 'Soru s2 nedir?' })).toBeInTheDocument()
  expect(screen.getByText('Soru 3 / 4')).toBeInTheDocument()
})

test('a card with nothing answered says "Başla"; a partly answered one "Devam et"', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  const [partly] = cardsOnScreen()
  expect(within(partly).getByRole('button', { name: 'Devam et: Veri tipleri' })).toHaveTextContent('Devam et →')
  expect(within(partly).queryByRole('button', { name: /^Başla/ })).not.toBeInTheDocument()

  // The exam has two questions, none answered.
  api.quiz.mockResolvedValue({ id: 'e1', topic: 'Kalıtım', kind: 'OPEN', question: 'Sınav sorusu nedir?', options: [] })
  await user.click(within(group()).getByRole('button', { name: 'Sınavdan 2' }))
  const [fresh] = cardsOnScreen()
  const start = within(fresh).getByRole('button', { name: 'Başla: Vize provası' })
  expect(start).toHaveTextContent('Başla →')
  expect(within(fresh).queryByRole('button', { name: /^Devam et/ })).not.toBeInTheDocument()
  await user.click(start)
  expect(api.quiz).toHaveBeenCalledWith('c', 'e1') // the first unanswered question
  expect(await screen.findByText('Sınav sorusu nedir?')).toBeInTheDocument()
})

test('a single question is a compact row: its question, kind and date, status on the right; no progress', async () => {
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  expect(rowsOnScreen()).toHaveLength(1)
  const [single] = rowsOnScreen()
  expect(within(single).getByText('Soru single nedir?')).toBeInTheDocument()
  expect(within(single).getByText(/^Kısa yanıt ·/)).toBeInTheDocument()
  expect(within(single).getByText('Kaynağı incele')).toHaveAttribute('data-tone', 'warn')
  expect(single.querySelector('.quiz-history-progress')).toBeNull()
  expect(single.textContent).not.toMatch(/yanıtlandı|Tamamlandı|doğru/)
})

test('a single-question row opens its question on its own', async () => {
  const user = userEvent.setup()
  api.quiz.mockResolvedValue({ id: 'single', topic: '', kind: 'SHORT_ANSWER', question: 'Tek soru nedir?', options: [] })
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  const [single] = rowsOnScreen()
  await user.click(within(single).getByRole('button', { name: /^Soru single nedir\?/ }))
  expect(api.quiz).toHaveBeenCalledWith('c', 'single')
  expect(api.quizSet).not.toHaveBeenCalled()
  expect(await screen.findByText('Tek soru nedir?')).toBeInTheDocument()
})

test('filter buttons carry their counts, the chosen one is pressed and the summary follows it', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  expect(within(group()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Tümü 7', 'Yanıt bekleyen 2', 'Yanıtlanan 5', 'Sınavdan 2'])
  expect(within(group()).getByRole('button', { name: 'Tümü 7' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(within(group()).getByRole('button', { name: 'Yanıt bekleyen 2' }))
  expect(within(group()).getByRole('button', { name: 'Yanıt bekleyen 2' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(group()).getByRole('button', { name: 'Tümü 7' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('2 soru yanıt bekliyor · 1 alıştırmada')).toBeInTheDocument()
  expect(cardsOnScreen()).toHaveLength(1)
})

test('exam questions stay out of "Tümü" and are grouped by exam under "Sınavdan"', async () => {
  const user = userEvent.setup()
  render(<CourseQuiz courseId="c" />)
  await screen.findByText('3 alıştırma · 7 soru · 5 yanıtlandı · 2 yanıt bekliyor')
  expect(cardsOnScreen().map((c) => c.textContent).join(' ')).not.toContain('Vize provası')
  await user.click(within(group()).getByRole('button', { name: 'Sınavdan 2' }))
  expect(cardsOnScreen()).toHaveLength(1)
  expect(within(cardsOnScreen()[0]).getByText('Vize provası')).toBeInTheDocument()
  expect(screen.getByText('1 sınav · 2 soru · 0 yanıtlandı')).toBeInTheDocument()
})

test('without exam questions the filter says so', async () => {
  const user = userEvent.setup()
  api.quizzes.mockImplementation(async (_course, _signal, purpose) => (purpose === 'EXAM' ? [] : items))
  render(<CourseQuiz courseId="c" />)
  await user.click(within(await screen.findByRole('group', { name: 'Alıştırma filtresi' })).getByRole('button', { name: 'Sınavdan 0' }))
  expect(screen.getByText('Bu derste hazırlanmış sınav sorusu yok.')).toBeInTheDocument()
})

test('no course chosen, and a course without practice, each say what to do', async () => {
  const { unmount } = render(<CourseQuiz />)
  expect(await screen.findByText('Geçmişi görmek için bir ders seç.')).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Alıştırma filtresi' })).not.toBeInTheDocument()
  unmount()

  api.quizzes.mockResolvedValue([])
  render(<CourseQuiz courseId="c" />)
  expect(await screen.findByText(/Bu derste henüz alıştırma yok/)).toBeInTheDocument()
})
