import { expect, test } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from '../../src/App'
import { BOARD_SAMPLE } from '../../src/data/board-sample'

test('#/tahta-deneme opens without login in development and plays the sample', async () => {
  window.location.hash = '#/tahta-deneme'
  render(<App />)
  expect(await screen.findByRole('heading', { name: BOARD_SAMPLE.question })).toBeInTheDocument()
  expect(screen.queryByLabelText(/şifre|parola/i)).not.toBeInTheDocument()
  expect(await screen.findByText('Sessiz mod')).toBeInTheDocument() // no local voice in tests: silent mode

  const list = screen.getByRole('region', { name: 'Adımların kaynakları' })
  fireEvent.click(list.querySelector('.board-chip'))
  expect(screen.getByText('1. adımın kaynağı: videoda 7:01 anına gidilirdi.')).toBeInTheDocument()
})

test('the sample quotes are placeholders, never invented sentences', () => {
  for (const step of BOARD_SAMPLE.steps) expect(step.quote).toMatch(/^<videonun \d\d:\d\d civarındaki gerçek cümlesi>$/)
})
