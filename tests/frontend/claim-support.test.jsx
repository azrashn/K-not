import { expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ClaimSupport from '../../src/components/ClaimSupport'

const claim = (text, label, extra = {}) => ({ text, sources: [1], support: { label, reason: 'WORDS_FOUND_IN_SOURCE', coverage: 1, missing_terms: [], unmatched_numbers: [], ...extra } })

test('nothing is shown for answers without a source check', () => {
  const { container } = render(<ClaimSupport claims={[{ text: 'x', sources: [1] }]} />)
  expect(container).toBeEmptyDOMElement()
  expect(render(<ClaimSupport claims={undefined} />).container).toBeEmptyDOMElement()
})

test('a fully matching answer is collapsed with a plain count and no warning', () => {
  render(<ClaimSupport claims={[claim('Kuyruk FIFO çalışır.', 'SUPPORTED'), claim('BFS kuyruk kullanır.', 'SUPPORTED')]} />)
  expect(screen.getByText('Kaynak kontrolü: 2 iddia — 2 örtüşüyor')).toBeInTheDocument()
  expect(screen.queryByRole('note')).toBeNull()
  expect(document.querySelector('details')).not.toHaveAttribute('open')
})

test('a weak claim opens the check, warns, and says what is missing', () => {
  render(<ClaimSupport claims={[
    claim('BFS kuyruk kullanır.', 'SUPPORTED'),
    claim('Dijkstra negatif ağırlıkla çalışır.', 'UNSUPPORTED', { reason: 'NEGATION_MISMATCH' }),
    claim('BFS 7 düğümü gezer.', 'PARTIAL', { reason: 'NUMBER_NOT_IN_SOURCE', unmatched_numbers: ['7'] }),
    claim('Özyineleme ile budanır.', 'UNSUPPORTED', { reason: 'LOW_COVERAGE', missing_terms: ['özyineleme', 'budanır'] }),
  ]} />)
  expect(screen.getByText('Kaynak kontrolü: 4 iddia — 1 örtüşüyor, 1 kısmen örtüşüyor, 2 kaynakta zayıf')).toBeInTheDocument()
  expect(screen.getByRole('note')).toHaveTextContent('zayıf örtüşüyor')
  expect(document.querySelector('details')).toHaveAttribute('open')
  const items = screen.getAllByRole('listitem')
  expect(within(items[1]).getByText(/Olumlu\/olumsuz anlamı/)).toBeInTheDocument()
  expect(within(items[2]).getByText(/Kaynakta olmayan sayı: 7/)).toBeInTheDocument()
  expect(within(items[3]).getByText(/Kaynakta olmayan: özyineleme, budanır/)).toBeInTheDocument()
})

test('it never claims the answer is verified', () => {
  render(<ClaimSupport claims={[claim('Kuyruk FIFO çalışır.', 'SUPPORTED')]} />)
  expect(screen.getByText(/doğruluğunu kanıtlamaz/)).toBeInTheDocument()
})


test('a translated answer is shown as "different language", not as unsupported', () => {
  render(<ClaimSupport claims={[
    claim('Taşıma katmanı süreçler arası iletişim sağlar.', 'UNCHECKED', { reason: 'DIFFERENT_LANGUAGE' }),
    claim('Ağ katmanı ana bilgisayarlar arası iletişim sağlar.', 'UNCHECKED', { reason: 'DIFFERENT_LANGUAGE' }),
  ]} />)
  expect(screen.getByText('Kaynak kontrolü: 2 iddia — 2 farklı dilde (kontrol edilemedi)')).toBeInTheDocument()
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
  expect(screen.getAllByText(/farklı dilde \(çeviri\)/).length).toBe(2)
})
