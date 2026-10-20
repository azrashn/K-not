import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import App from '../../src/App'
import { COURSE, doc, envelope, fakeApi, signIn } from './fake-api'

const C = COURSE.id
const D1 = 'ready-doc-1'
const open = () => { signIn(); window.location.hash = '#/quiz'; return render(<App />) }

const QUIZ = {
  id: 'quiz1', course_id: C, title: 'Veri Yapıları quizi', status: 'READY', question_count: 2, requested_count: 5, difficulty: 'medium',
  question_types: ['multiple_choice', 'true_false'], generator: 'extractive-v1', llm_used: false, warnings: ['Materyallerden yalnızca 2 güvenilir soru çıkarıldı.'],
  document_ids: [D1], created_at: '2026-10-21T10:00:00Z',
  questions: [
    { id: 'qa', ordinal: 1, type: 'multiple_choice', prompt: 'AVL ağacında denge faktörü en fazla ___ olabilir.', options: ['1', '2', '3', '4'], topic: 'AVL', difficulty: 'medium' },
    { id: 'qb', ordinal: 2, type: 'true_false', prompt: 'Hash tablosunda çakışma zincirleme ile çözülebilir.', options: ['Doğru', 'Yanlış'], topic: 'Hash', difficulty: 'medium' },
  ],
}
const RESULT = {
  id: 'att1', quiz_id: 'quiz1', status: 'SUBMITTED', score_pct: 50, correct_count: 1, total_count: 2, submitted_at: '2026-10-21T10:05:00Z',
  results: [
    { question_id: 'qa', ordinal: 1, type: 'multiple_choice', prompt: QUIZ.questions[0].prompt, options: ['1', '2', '3', '4'], selected_index: 1, correct_index: 0, is_correct: false,
      explanation: 'Slayt 18: fark en fazla 1 olabilir.', topic: 'AVL', source: { document_id: D1, document_title: 'Hafta 4', page_start: 18, page_end: 18, quote: 'farkın en fazla 1 olduğu bilinir', label: 'Slayt · s.18' } },
    { question_id: 'qb', ordinal: 2, type: 'true_false', prompt: QUIZ.questions[1].prompt, options: ['Doğru', 'Yanlış'], selected_index: 0, correct_index: 0, is_correct: true,
      explanation: 'Doğru.', topic: 'Hash', source: { document_id: D1, document_title: 'Hafta 4', page_start: 12, page_end: 12, quote: null, label: 'Hafta 6 · s.12' } },
  ],
}

function routes(extra = {}) {
  return {
    'GET /courses': { body: [COURSE] },
    'GET /quizzes': { body: [] },
    [`GET /courses/${C}/documents`]: { body: [doc(D1, 'READY', { title: 'Hafta 4 — AVL' }), doc('busy1', 'EXTRACTING', { title: 'Hazırlanan' })] },
    ...extra,
  }
}

describe('quiz creation', () => {
  test('lists only READY documents, requires a selection and sends the configuration', async () => {
    let sent = null
    fakeApi(routes({
      [`POST /courses/${C}/quizzes`]: ({ init }) => { sent = JSON.parse(init.body); return { status: 201, body: QUIZ } },
      'POST /quizzes/quiz1/attempts': { status: 201, body: { id: 'att1', quiz_id: 'quiz1', status: 'IN_PROGRESS', started_at: '', answers: [] } },
    }))
    open()
    expect(await screen.findByText('Hafta 4 — AVL')).toBeInTheDocument()
    expect(screen.queryByText('Hazırlanan')).not.toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'Quiz Oluştur' })
    expect(create).toBeDisabled()
    expect(screen.getByText(/yapay zekâ modeli kullanılmaz/)).toBeInTheDocument() // dürüst not
    await userEvent.click(screen.getByLabelText(/Hafta 4 — AVL/))
    await userEvent.click(screen.getByRole('radio', { name: '5' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Çoktan seçmeli' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Zor' }))
    await userEvent.click(create)
    await waitFor(() => expect(sent).toEqual({ document_ids: [D1], question_count: 5, question_types: ['multiple_choice'], difficulty: 'hard' }))
    expect(await screen.findByText('AVL ağacında denge faktörü en fazla ___ olabilir.')).toBeInTheDocument()
    expect(screen.getByText('Materyallerden yalnızca 2 güvenilir soru çıkarıldı.')).toBeInTheDocument()
    expect(screen.getByText(/5 soru istedin/)).toBeInTheDocument()
  })

  test('shows a Turkish error for a failed generation and keeps the form', async () => {
    fakeApi(routes({ [`POST /courses/${C}/quizzes`]: { status: 422, body: envelope('QUIZ_GENERATION_FAILED') } }))
    open()
    await userEvent.click(await screen.findByLabelText(/Hafta 4 — AVL/))
    await userEvent.click(screen.getByRole('button', { name: 'Quiz Oluştur' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('güvenilir soru çıkarılamadı')
    expect(screen.getByRole('button', { name: 'Quiz Oluştur' })).toBeEnabled()
  })

  test('empty states: no ready documents, no courses', async () => {
    fakeApi(routes({ [`GET /courses/${C}/documents`]: { body: [doc('busy1', 'EXTRACTING')] } }))
    const { unmount } = open()
    expect(await screen.findByText(/henüz hazır materyal yok/)).toBeInTheDocument()
    expect(screen.getByText(/Henüz quiz oluşturmadın/)).toBeInTheDocument()
    unmount()
    fakeApi({ 'GET /courses': { body: [] }, 'GET /quizzes': { body: [] } })
    open()
    expect(await screen.findByText(/önce bir ders ekle/)).toBeInTheDocument()
  })
})

describe('taking a quiz and results', () => {
  test('no answer keys before submit; answers can change; autosave; confirm with unanswered; results with sources', async () => {
    const saves = []
    let submitted = null
    fakeApi(routes({
      'GET /quizzes': { body: [{ id: 'quiz1', course_id: C, title: QUIZ.title, question_count: 2, difficulty: 'medium', created_at: '2026-10-21T10:00:00Z', latest_attempt: null }] },
      'GET /quizzes/quiz1': { body: QUIZ },
      'POST /quizzes/quiz1/attempts': { status: 201, body: { id: 'att1', quiz_id: 'quiz1', status: 'IN_PROGRESS', started_at: '', answers: [] } },
      'PUT /quiz-attempts/att1/answers': ({ init }) => { saves.push(JSON.parse(init.body)); return { body: { answered: 1 } } },
      'POST /quiz-attempts/att1/submit': ({ init }) => { submitted = JSON.parse(init.body); return { body: RESULT } },
    }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Başla' }))
    await screen.findByText(QUIZ.questions[0].prompt)
    expect(document.body.textContent).not.toMatch(/correct_index|Doğru cevap|Slayt 18/)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

    const q1 = document.querySelector('[data-question="qa"]')
    await userEvent.click(within(q1).getByLabelText(/^A\s*1$|A1/))
    await userEvent.click(within(q1).getByLabelText(/B\s*2|B2/)) // cevap değiştirilebilir
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    await waitFor(() => expect(saves.length).toBeGreaterThan(0), { timeout: 3000 })
    expect(saves.at(-1)).toEqual({ answers: [{ question_id: 'qa', selected_index: 1 }] })

    await userEvent.click(screen.getByRole('button', { name: 'Quizi bitir' }))
    expect(screen.getByText(/1 soru boş kaldı/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Teslim et' }))
    await waitFor(() => expect(submitted).toEqual({ answers: [{ question_id: 'qa', selected_index: 1 }] }))

    expect(await screen.findByText('%50')).toBeInTheDocument()
    const r1 = document.querySelector('[data-result="qa"]')
    expect(within(r1).getByText('Yanlış')).toBeInTheDocument()
    expect(within(r1).getByText('Doğru cevap')).toBeInTheDocument()
    expect(within(r1).getByText('Senin cevabın')).toBeInTheDocument()
    expect(within(r1).getByText('Slayt 18: fark en fazla 1 olabilir.')).toBeInTheDocument()
    expect(within(r1).getByText(/farkın en fazla 1 olduğu bilinir/)).toBeInTheDocument()
    expect(within(r1).getByRole('button', { name: 'Kaynakta aç' })).toBeInTheDocument()
    const r2 = document.querySelector('[data-result="qb"]')
    expect(within(r2).getByText(/Kaynak belge silindi/)).toBeInTheDocument()
    expect(within(r2).queryByRole('button', { name: 'Kaynakta aç' })).not.toBeInTheDocument()
  })

  test('submit failure is shown and the answers stay', async () => {
    fakeApi(routes({
      'GET /quizzes': { body: [{ id: 'quiz1', course_id: C, title: QUIZ.title, question_count: 2, difficulty: 'medium', created_at: '', latest_attempt: { id: 'att1', status: 'IN_PROGRESS' } }] },
      'GET /quiz-attempts/att1': { body: { id: 'att1', quiz_id: 'quiz1', status: 'IN_PROGRESS', answers: [{ question_id: 'qb', selected_index: 1 }], quiz: QUIZ } },
      'POST /quiz-attempts/att1/submit': { status: 503, body: envelope('AI_SERVICE_UNAVAILABLE') },
    }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Devam et' }))
    await screen.findByText(QUIZ.questions[0].prompt)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1') // kaydedilmiş cevap geri yüklendi
    await userEvent.click(screen.getByRole('button', { name: 'Quizi bitir' }))
    await userEvent.click(screen.getByRole('button', { name: 'Teslim et' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  test('a finished quiz offers its result', async () => {
    fakeApi(routes({
      'GET /quizzes': { body: [{ id: 'quiz1', course_id: C, title: QUIZ.title, question_count: 2, difficulty: 'medium', created_at: '', latest_attempt: { id: 'att1', status: 'SUBMITTED', score_pct: 50, submitted_at: '' } }] },
      'GET /quiz-attempts/att1': { body: RESULT },
    }))
    open()
    await userEvent.click(await screen.findByRole('button', { name: 'Sonucu gör' }))
    expect(await screen.findByText('%50')).toBeInTheDocument()
  })
})
