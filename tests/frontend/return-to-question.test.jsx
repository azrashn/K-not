// End to end in the browser model: question → "İlgili kaynağı aç" → source screen → "← Soruya dön" → the same
// question with its answer. With the real store (hash routing, intents) and <StrictMode>, as in the app:
// StrictMode mounts every page twice, which is what lost the set before.
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppProvider, useApp } from '../../src/app/store'
import CourseQuiz from '../../src/pages/CourseQuiz'
import CourseExams from '../../src/pages/CourseExams'
import LearningWorkspace from '../../src/pages/LearningWorkspace'
import { api } from '../../src/api/endpoints'

vi.mock('../../src/api/endpoints')
vi.mock('../../src/hooks/useVideoProgress', () => ({ useVideoProgress: () => ({ flushForQuestion: vi.fn().mockResolvedValue(true) }) }))

// The app's page switch (App.jsx Page): one page per route, a new one when the route changes.
function Pages() {
  const { route, navigate } = useApp()
  const key = `${route.view}:${route.courseId || ''}`
  return (
    <>
      {/* Only for the "address lost" case: the way back arrives without any set in the address. */}
      <button type="button" hidden onClick={() => navigate('/quiz', { returnToQuestion: true })}>test-back-without-address</button>
      {route.view === 'learning' ? <LearningWorkspace key={key} courseId={route.courseId} />
        : route.view === 'exams' ? <CourseExams key={key} courseId={route.courseId} />
          : route.view === 'quiz' ? <CourseQuiz key={key} courseId={route.courseId} /> : null}
    </>
  )
}
const app = () => render(<StrictMode><AppProvider><Pages /></AppProvider></StrictMode>)

const NOTES = { id: 'file_notes', kind: 'TXT', source_id: 'notes', title: 'Notlar', status: 'READY' }
const SEG = { id: 'seg1', material_id: NOTES.id, text: 'Giriş. Nesne, sınıfın örneğidir. Son.', location: { kind: 'text' } }
const mc = (id, question) => ({ id, kind: 'MULTIPLE_CHOICE', topic: 'nesne', question, options: ['Şablon', 'Örnek', 'Metot', 'Paket'], available: true })
const QUESTIONS = [mc('q1', 'Nesne nedir?'), mc('q2', 'Sınıf nedir?'), mc('q3', 'Kalıtım nedir?')]
const GRADED = { score: 0, message: 'Kaynağı tekrar incele.', explanation: 'Nesne bir örnektir.', quote: 'Nesne,\nsınıfın örneğidir.',
  source: { id: 'seg1', material_id: NOTES.id }, expected: 'Örnek' }

// The server: answers are recorded and come back with the set or exam (last_answer).
let recorded
const withAnswers = () => QUESTIONS.map((q) => ({ ...q, last_answer: recorded[q.id] ?? null }))

beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  recorded = {}
  Element.prototype.scrollIntoView = vi.fn()
  api.courses.mockResolvedValue([{ id: 'c', name: 'Java' }])
  api.knowledgeMaterials.mockResolvedValue({ materials: [NOTES] })
  api.quizzes.mockResolvedValue([])
  api.examStyles.mockResolvedValue([])
  api.course.mockResolvedValue({ name: 'Java' })
  api.conversations.mockResolvedValue([])
  api.activity.mockResolvedValue({})
  api.knowledgeSource.mockResolvedValue(SEG)
  api.knowledgePreview.mockResolvedValue({ material: NOTES, segments: [SEG] })
  api.answerQuiz.mockImplementation(async (_c, id, response) => (recorded[id] = { ...GRADED, response }))
  api.quizSet.mockImplementation(async () => ({ id: 's1', type: 'quiz_set', topic: 'nesne', status: 'READY', requested: 3, produced: 3,
    note: null, failures: [], questions: withAnswers() }))
  api.exams.mockResolvedValue([{ id: 'x1', title: 'Final — yeni sınav', status: 'READY', requested: 3, produced: 3, failures: [] }])
  api.exam.mockImplementation(async () => ({ id: 'x1', title: 'Final — yeni sınav', status: 'READY', requested: 3, produced: 3,
    failures: [], note: null, questions: withAnswers() }))
})
afterEach(() => window.history.replaceState(null, '', '#'))

async function answerAndOpenSource(user, option = 'Şablon') {
  await user.click(screen.getByLabelText(option))
  await user.click(screen.getByRole('button', { name: 'Yanıtı değerlendir' }))
  await screen.findByText('Kaynağı tekrar incele.')
  await user.click(screen.getByRole('button', { name: 'İlgili kaynağı aç →' }))
  // The source screen, the sentence marked, and the way back.
  await waitFor(() => expect(document.querySelector('mark.evidence')).not.toBeNull())
  expect(window.location.hash).toBe('#/dersler/c/ogrenme')
}

async function expectAnsweredQuestion(text, option = 'Şablon') {
  expect(await screen.findByRole('heading', { name: text })).toBeInTheDocument()
  const feedback = await screen.findByLabelText('Alıştırma geri bildirimi')
  expect(within(feedback).getByText('Kaynağı tekrar incele.')).toBeInTheDocument()
  expect(within(feedback).getByText('Nesne bir örnektir.')).toBeInTheDocument()
  expect(within(feedback).getByText('Nesne, sınıfın örneğidir.')).toBeInTheDocument()
  expect(screen.getByLabelText(option)).toBeChecked()
}

describe('"← Soruya dön" brings back the same question with its answer', () => {
  test('quiz set on the general quiz page (#/quiz?course=…)', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/quiz')
    api.createQuiz.mockImplementation(async () => ({ id: 's1', type: 'quiz_set', topic: 'nesne', status: 'READY', requested: 3,
      produced: 3, note: null, failures: [], questions: withAnswers() }))
    app()
    await user.selectOptions(await screen.findByLabelText('Ders'), 'c')
    await user.type(screen.getByLabelText('Konu'), 'nesne')
    await user.selectOptions(screen.getByLabelText('Soru sayısı'), '3')
    await user.click(screen.getByRole('button', { name: 'Alıştırma hazırla' }))
    await screen.findByRole('heading', { name: 'Nesne nedir?' })
    await waitFor(() => expect(window.location.hash).toBe('#/quiz?course=c&set=s1&q=1'))

    await answerAndOpenSource(user)
    await user.click(screen.getByRole('button', { name: '← Soruya dön' }))
    await waitFor(() => expect(window.location.hash).toBe('#/quiz?course=c&set=s1&q=1'))
    await expectAnsweredQuestion('Nesne nedir?')
    expect(screen.getByLabelText('Ders')).toHaveValue('c') // not the empty "Ders seç" page
    expect(screen.getByText('Soru 1 / 3')).toBeInTheDocument()
  })

  test('quiz set on the course quiz page (#/dersler/c/quiz), from the second question', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/dersler/c/quiz?set=s1&q=2')
    app()
    await screen.findByRole('heading', { name: 'Sınıf nedir?' })
    await answerAndOpenSource(user)
    await user.click(screen.getByRole('button', { name: '← Soruya dön' }))
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/quiz?set=s1&q=2'))
    await expectAnsweredQuestion('Sınıf nedir?')
    expect(screen.getByText('Soru 2 / 3')).toBeInTheDocument()
  })

  test('exam page in solve mode (#/dersler/c/sinavlar?exam=…&mode=solve&q=2)', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/dersler/c/sinavlar')
    app()
    await user.click(await screen.findByRole('button', { name: /Final — yeni sınav Hazır/ }))
    await user.click(await screen.findByRole('button', { name: 'Sınavı çöz' }))
    await user.click(screen.getByRole('button', { name: 'Sonraki →' }))
    await screen.findByRole('heading', { name: 'Sınıf nedir?' })
    await answerAndOpenSource(user, 'Örnek')
    await user.click(screen.getByRole('button', { name: '← Soruya dön' }))
    await waitFor(() => expect(window.location.hash).toBe('#/dersler/c/sinavlar?exam=x1&mode=solve&q=2'))
    const solver = await screen.findByRole('region', { name: 'Sınavı çöz' })
    expect(within(solver).getByText('Soru 2 / 3')).toBeInTheDocument()
    await expectAnsweredQuestion('Sınıf nedir?', 'Örnek')
  })

  test('the address lost the set: the tab record leads back to it, even when every question is answered', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '#/dersler/c/quiz?set=s1&q=1')
    app()
    await screen.findByRole('heading', { name: 'Nesne nedir?' })
    await answerAndOpenSource(user)
    recorded.q2 = { ...GRADED, response: '0' } // the rest answered meanwhile: the set is finished
    recorded.q3 = { ...GRADED, response: '0' }
    await user.click(screen.getByText('test-back-without-address')) // "#/quiz", no course, no set
    await expectAnsweredQuestion('Nesne nedir?')
    expect(screen.getByLabelText('Ders')).toHaveValue('c')
    await waitFor(() => expect(window.location.hash).toBe('#/quiz?course=c&set=s1&q=1'))
  })
})
