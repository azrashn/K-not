import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import Analytics from '../../src/pages/Analytics'
import { AppProvider } from '../../src/app/store'
import { fakeApi, signIn } from './fake-api'

vi.mock('recharts', async (orig) => {
  const m = await orig()
  return { ...m, ResponsiveContainer: ({ children }) => <div>{children}</div> }
})

const EMPTY = { completed_quizzes: 0, average_score_pct: null, attempts: [], topics: [] }
const setup = (summary = EMPTY) => {
  signIn()
  fakeApi({ 'GET /analytics/quiz-summary': { body: summary } })
  return render(<AppProvider><Analytics /></AppProvider>)
}

describe('Öğrenme Analizi', () => {
  test('shows honest empty states, sample notice and no rope metaphor without quiz data', async () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Öğrenme Analizi' })).toBeInTheDocument()
    expect(await screen.findByText('Henüz quiz tamamlanmadı')).toBeInTheDocument()
    expect(screen.getByText('Henüz değerlendirme verisi yok')).toBeInTheDocument()
    expect(screen.getByText('Çalışma süresi henüz kaydedilmiyor')).toBeInTheDocument()
    expect(screen.getByText(/en az iki farklı tarihte quiz/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ipin|Bilgi İpi/i)
    expect(screen.getByRole('note')).toHaveTextContent('Örnek veri')
  })

  test('recommends weak (sample) topics with student-facing labels', async () => {
    setup()
    await screen.findByText('Henüz quiz tamamlanmadı')
    const panel = screen.getByRole('region', { name: 'Tekrar etmeni önerdiğimiz konular' })
    expect(within(panel).getByText('LR / RL çift rotasyon')).toBeInTheDocument()
    expect(within(panel).getAllByText('Tekrar öneriliyor').length).toBeGreaterThan(0)
  })

  test('uses real quiz results: counts, average, trend (≥2 dates) and topic accuracy', async () => {
    setup({
      completed_quizzes: 3, average_score_pct: 66.7,
      attempts: [
        { attempt_id: 'a1', quiz_id: 'q1', course_id: 'c', submitted_at: '2026-10-01T10:00:00Z', score_pct: 40 },
        { attempt_id: 'a2', quiz_id: 'q1', course_id: 'c', submitted_at: '2026-10-05T10:00:00Z', score_pct: 80 },
        { attempt_id: 'a3', quiz_id: 'q2', course_id: 'c', submitted_at: '2026-10-05T12:00:00Z', score_pct: 80 },
      ],
      topics: [{ topic: 'AVL denge', answered: 6, correct: 2, accuracy_pct: 33 }, { topic: 'Hash', answered: 4, correct: 4, accuracy_pct: 100 }],
    })
    expect(await screen.findByText('%67')).toBeInTheDocument()
    expect(screen.getByText('Teslim edilen denemeler')).toBeInTheDocument()
    expect(screen.queryByText(/en az iki farklı tarihte quiz/)).not.toBeInTheDocument()
    const rec = screen.getByRole('region', { name: 'Tekrar etmeni önerdiğimiz konular' })
    expect(within(rec).getByText('AVL denge')).toBeInTheDocument()
    expect(within(rec).queryByText('LR / RL çift rotasyon')).not.toBeInTheDocument()
    expect(screen.getByRole('note')).not.toHaveTextContent('Konu puanları')
  })

  test('a single date keeps the trend panel empty', async () => {
    setup({
      completed_quizzes: 1, average_score_pct: 50,
      attempts: [{ attempt_id: 'a1', quiz_id: 'q1', course_id: 'c', submitted_at: '2026-10-01T10:00:00Z', score_pct: 50 }],
      topics: [{ topic: 'Hash', answered: 2, correct: 1, accuracy_pct: 50 }],
    })
    expect((await screen.findAllByText('%50')).length).toBeGreaterThan(0)
    expect(screen.getByText(/en az iki farklı tarihte quiz/)).toBeInTheDocument()
  })

  test('source tab uses the new labels', async () => {
    setup()
    await userEvent.click(screen.getByRole('tab', { name: 'Yanıt ve kaynak analizi' }))
    expect(screen.getByText('Kaynakla doğrulanan yanıtlar')).toBeInTheDocument()
    expect(screen.getByText('Yeterli kaynak bulunamayan yanıtlar')).toBeInTheDocument()
  })
})
