import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import Analytics from '../../src/pages/Analytics'
import { AppProvider } from '../../src/app/store'

vi.mock('recharts', async (orig) => {
  const m = await orig()
  return { ...m, ResponsiveContainer: ({ children }) => <div>{children}</div> }
})

const setup = () => render(<AppProvider><Analytics /></AppProvider>)

describe('Öğrenme Analizi', () => {
  test('shows summary cards with honest empty states and no rope metaphor', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Öğrenme Analizi' })).toBeInTheDocument()
    expect(screen.getByText('Henüz quiz tamamlanmadı')).toBeInTheDocument()
    expect(screen.getByText('Çalışma süresi henüz kaydedilmiyor')).toBeInTheDocument()
    expect(screen.getByText(/en az iki farklı tarihte quiz/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ipin|Bilgi İpi/i)
    expect(screen.getByRole('note')).toHaveTextContent('Örnek veri')
  })

  test('recommends weak topics with student-facing labels', () => {
    setup()
    const panel = screen.getByRole('region', { name: 'Tekrar etmeni önerdiğimiz konular' })
    expect(within(panel).getByText('LR / RL çift rotasyon')).toBeInTheDocument()
    expect(within(panel).getAllByText('Tekrar öneriliyor').length).toBeGreaterThan(0)
  })

  test('source tab uses the new labels', async () => {
    setup()
    await userEvent.click(screen.getByRole('tab', { name: 'Yanıt ve kaynak analizi' }))
    expect(screen.getByText('Kaynakla doğrulanan yanıtlar')).toBeInTheDocument()
    expect(screen.getByText('Yeterli kaynak bulunamayan yanıtlar')).toBeInTheDocument()
  })
})
