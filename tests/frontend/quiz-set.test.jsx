import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CourseQuiz from '../../src/pages/CourseQuiz'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/app/store', () => ({ useApp: () => ({ navigate: vi.fn(), takeIntent: () => null }) }))

const WARNING = 'Sorular videonun otomatik transkriptinden hazırlanıyor; yazım hataları olabilir.'
const question = (id, text) => ({ id, topic: 'nesne', kind: 'OPEN', question: text, options: [], available: true })
const set = (over) => ({ id: 's1', type: 'quiz_set', topic: 'nesne', status: 'GENERATING', requested: 3, produced: 0,
  note: null, source_warning: null, failures: [], questions: [], ...over })

beforeEach(() => {
  vi.resetAllMocks()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Java' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [] })
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

async function fill(user, { count, kind } = {}) {
  await user.type(await screen.findByLabelText('Konu'), 'nesne')
  if (kind) await user.selectOptions(screen.getByLabelText('Soru türü'), kind)
  if (count) await user.selectOptions(screen.getByLabelText('Soru sayısı'), String(count))
  await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
}

test('the count (1-10) and "Karışık" are basics; one question sends no count', async () => {
  const user = userEvent.setup()
  api.createQuiz.mockResolvedValue({ id: 'q', topic: 'nesne', kind: 'OPEN', question: 'Nesne nedir?', options: [] })
  render(<CourseQuiz courseId="c" />)
  const counts = await screen.findByLabelText('Soru sayısı')
  expect(Array.from(counts.querySelectorAll('option')).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
  expect(screen.getByText('Gelişmiş ayarlar').closest('details')).not.toContainElement(counts)
  expect(screen.getByRole('option', { name: 'Karışık (türler sırayla)' })).toBeInTheDocument()
  await fill(user)
  expect(api.createQuiz.mock.calls[0][1]).not.toHaveProperty('count')
  expect(await screen.findByText('Nesne nedir?')).toBeInTheDocument()
})

test('several questions: the set is followed, its first question opens at once, then the next', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  api.createQuiz.mockResolvedValue(set())
  api.quizSet
    .mockResolvedValueOnce(set({ produced: 1, questions: [question('q1', 'Nesne nedir?')] }))
    .mockResolvedValue(set({ status: 'READY', produced: 3, questions: [question('q1', 'Nesne nedir?'), question('q2', 'Sınıf nedir?'), question('q3', 'Kalıtım nedir?')] }))
  api.answerQuiz.mockResolvedValue({ score: null, message: 'Yanıtın kaydedildi.', quote: 'Nesne, sınıfın örneğidir.' })
  render(<CourseQuiz courseId="c" />)
  await fill(user, { count: 3, kind: 'MIXED' })
  expect(api.createQuiz.mock.calls[0][1]).toMatchObject({ topic: 'nesne', kind: 'MIXED', count: 3 })
  expect(await screen.findByText('3 sorudan 0 tanesi hazır; diğerleri hazırlanıyor…')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Alıştırma hazırla' })).toBeDisabled() // one set at a time

  await act(async () => { vi.advanceTimersByTime(2000) })
  expect(await screen.findByText('Nesne nedir?')).toBeInTheDocument()
  expect(screen.getByText('Soru 1 / 3')).toBeInTheDocument()

  await act(async () => { vi.advanceTimersByTime(2000) })
  expect(await screen.findByText('3 sorudan 3 tanesi hazırlandı.')).toBeInTheDocument()
  expect(api.quiz).not.toHaveBeenCalled()
  await user.type(screen.getByLabelText('Yanıtın'), 'Bir örnek')
  await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
  await user.click(await screen.findByRole('button', { name: 'Sonraki soru →' }))
  expect(await screen.findByText('Sınıf nedir?')).toBeInTheDocument()
  expect(screen.getByText('Soru 2 / 3')).toBeInTheDocument()
  // The practice list (no purpose): first load, after the request (as for one question), when the set is done,
  // after the answer. The exam list ("Sınavdan") is read once on load.
  const practiceCalls = () => api.quizzes.mock.calls.filter((c) => !c[2]).length
  await waitFor(() => expect(practiceCalls()).toBe(4))
  expect(api.quizzes.mock.calls.filter((c) => c[2] === 'EXAM')).toHaveLength(1)
})

test('the transcript warning is shown for one question and for a set', async () => {
  const user = userEvent.setup()
  api.createQuiz.mockResolvedValueOnce({ id: 'q', topic: 'object', kind: 'OPEN', question: 'Object nedir?', options: [], source_warning: WARNING })
  const { unmount } = render(<CourseQuiz courseId="c" />)
  await fill(user)
  expect(await screen.findByRole('note')).toHaveTextContent(WARNING)
  unmount()

  api.createQuiz.mockResolvedValueOnce(set({ status: 'READY', produced: 2, requested: 2, source_warning: WARNING, note: 'Bu konu için kaynaklar yaklaşık 2 soruya yetiyor; 4 soru istendi.' }))
  render(<CourseQuiz courseId="c" />)
  await fill(user, { count: 4 })
  expect(await screen.findByRole('note')).toHaveTextContent(WARNING)
  expect(screen.getByText('Bu konu için kaynaklar yaklaşık 2 soruya yetiyor; 4 soru istendi.')).toBeInTheDocument()
})

test('a set that ended without questions says so instead of an empty screen', async () => {
  const user = userEvent.setup()
  api.createQuiz.mockResolvedValue(set({ status: 'FAILED', note: 'Kaynaklara dayalı soru hazırlanamadı.' }))
  render(<CourseQuiz courseId="c" />)
  await fill(user, { count: 2 })
  expect(await screen.findByText('Alıştırma seti boş kaldı')).toBeInTheDocument()
  expect(screen.getByText('Kaynaklara dayalı soru hazırlanamadı.')).toBeInTheDocument()
})

test('the next question follows the open one, even if the list order changed meanwhile (Mac: 2nd = 3rd)', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  api.createQuiz.mockResolvedValue(set())
  const q1 = question('q1', 'Nesne nedir?'), q2 = question('q2', 'Sınıf nedir?'), q3 = question('q3', 'Kalıtım nedir?')
  api.quizSet
    .mockResolvedValueOnce(set({ produced: 2, questions: [q1, q3] }))
    // An older server sorted the finished set: q3 moved from the 2nd to the 3rd place.
    .mockResolvedValue(set({ status: 'READY', produced: 3, questions: [q1, q2, q3] }))
  api.answerQuiz.mockResolvedValue({ score: null, message: 'Yanıtın kaydedildi.', quote: 'Kalıtım devralmadır.' })
  render(<CourseQuiz courseId="c" />)
  await fill(user, { count: 3 })
  expect(await screen.findByText('3 sorudan 0 tanesi hazır; diğerleri hazırlanıyor…')).toBeInTheDocument()
  await act(async () => { vi.advanceTimersByTime(2000) })
  expect(await screen.findByText('Nesne nedir?')).toBeInTheDocument()
  await user.type(screen.getByLabelText('Yanıtın'), 'Bir örnek')
  await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
  await user.click(await screen.findByRole('button', { name: 'Sonraki soru →' }))
  expect(await screen.findByText('Kalıtım nedir?')).toBeInTheDocument()
  expect(screen.getByText('Soru 2 / 3')).toBeInTheDocument()

  await act(async () => { vi.advanceTimersByTime(2000) })
  expect(await screen.findByText('3 sorudan 3 tanesi hazırlandı.')).toBeInTheDocument()
  expect(screen.getByText('Soru 3 / 3')).toBeInTheDocument() // the open question's new place
  expect(screen.queryByRole('button', { name: 'Sonraki soru →' })).not.toBeInTheDocument()
})

describe('going back in a set and keeping it in the address', () => {
  const qs = [question('q1', 'Nesne nedir?'), question('q2', 'Sınıf nedir?'), question('q3', 'Kalıtım nedir?')]
  const ready = set({ status: 'READY', produced: 3, questions: qs })
  afterEach(() => window.history.replaceState(null, '', '#'))

  test('"← Önceki soru" goes back and shows the answer given there; the first question has no way back', async () => {
    const user = userEvent.setup()
    api.createQuiz.mockResolvedValue(ready)
    api.answerQuiz.mockResolvedValue({ score: null, message: 'Yanıtın kaydedildi.', quote: 'Nesne, sınıfın örneğidir.' })
    render(<CourseQuiz courseId="c" />)
    await fill(user, { count: 3 })
    expect(await screen.findByText('Nesne nedir?')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Setteki sorular arasında gezin' })
    expect(within(nav).getByRole('button', { name: '← Önceki soru' })).toBeDisabled()
    await user.type(screen.getByLabelText('Yanıtın'), 'Bir örnek')
    await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
    await screen.findByText('Yanıtın kaydedildi.')
    await user.click(screen.getByRole('button', { name: 'Sonraki soru →' }))
    expect(await screen.findByText('Sınıf nedir?')).toBeInTheDocument()
    expect(screen.queryByText('Yanıtın kaydedildi.')).toBeNull() // a new question starts unanswered
    await user.click(screen.getByRole('button', { name: '← Önceki soru' }))
    expect(await screen.findByText('Nesne nedir?')).toBeInTheDocument()
    expect(screen.getByText('Soru 1 / 3')).toBeInTheDocument()
    expect(screen.getByText('Yanıtın kaydedildi.')).toBeInTheDocument()
  })

  test('the open set and question are written into the address', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/dersler/c/quiz')
    api.createQuiz.mockResolvedValue(ready)
    render(<CourseQuiz courseId="c" />)
    await fill(user, { count: 3 })
    await screen.findByText('Nesne nedir?')
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/quiz?set=s1&q=q1'))
    await user.click(screen.getByRole('button', { name: 'Sonraki soru →' }))
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/quiz?set=s1&q=q2'))
  })

  test('coming back to the page opens the same set at the question left', async () => {
    window.history.replaceState(null, '', '#/dersler/c/quiz?set=s1&q=q2')
    api.quizSet.mockResolvedValue(ready)
    render(<CourseQuiz courseId="c" />)
    expect(await screen.findByText('Sınıf nedir?')).toBeInTheDocument()
    expect(screen.getByText('Soru 2 / 3')).toBeInTheDocument()
    expect(api.quizSet).toHaveBeenCalledWith('c', 's1')
    expect(window.location.hash).toBe('#/dersler/c/quiz?set=s1&q=q2')
  })

  test('on the general quiz page the course comes back from the address too', async () => {
    window.history.replaceState(null, '', '#/quiz?course=c&set=s1&q=q3')
    api.quizSet.mockResolvedValue(ready)
    render(<CourseQuiz />)
    expect(await screen.findByText('Kalıtım nedir?')).toBeInTheDocument()
    expect(screen.getByLabelText('Ders')).toHaveValue('c')
    expect(screen.queryByRole('button', { name: 'Sonraki soru →' })).toBeNull() // the last question
  })

  test('a set that no longer exists opens nothing and leaves the address', async () => {
    window.history.replaceState(null, '', '#/dersler/c/quiz?set=gone&q=q1')
    api.quizSet.mockRejectedValue(new Error('404'))
    render(<CourseQuiz courseId="c" />)
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/quiz'))
    expect(screen.getByText('Öğrendiklerini dene')).toBeInTheDocument()
  })
})
