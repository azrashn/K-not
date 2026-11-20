import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import StepBoard from '../../src/components/board/StepBoard'

let status = { available: true, languages: { tr: true, en: false } }
const speak = vi.fn(async () => '/api/tts/audio/k.wav?exp=1&sig=s')
vi.mock('../../src/lib/local-voice', () => ({ loadLocalVoice: () => Promise.resolve(status) }))
vi.mock('../../src/api/tts', async (orig) => ({ ...(await orig()), speak: (...a) => speak(...a) }))

const tr = [{ board: 'Çerçeveleme', speech: 'Çerçeveleme, datagramın başlık ve sonluk eklenerek çerçeveye konmasıdır.', formula: null, mark: null, sources: [] }]
const en = [{ board: 'Framing', speech: 'Framing puts the datagram into a frame with a header and a trailer.', formula: null, mark: null, sources: [] }]

beforeEach(() => { speak.mockClear(); status = { available: true, languages: { tr: true, en: false } } })

test('with the local voice installed the teacher speaks the steps in their language', async () => {
  render(<StepBoard steps={tr} />)
  await waitFor(() => expect(speak).toHaveBeenCalled())
  expect(speak.mock.calls[0][0]).toContain('Çerçeveleme')
  expect(speak.mock.calls[0][1]).toBe('tr')
})

test('without a voice for that language the board stays silent instead of reading English with a Turkish voice', async () => {
  render(<StepBoard steps={en} />)
  expect(await screen.findByText('Sessiz mod')).toBeInTheDocument()
  expect(speak).not.toHaveBeenCalled()
})

test('without any local voice the board is silent', async () => {
  status = { available: false, languages: { tr: false, en: false } }
  render(<StepBoard steps={tr} />)
  expect(await screen.findByText('Sessiz mod')).toBeInTheDocument()
  expect(speak).not.toHaveBeenCalled()
})
