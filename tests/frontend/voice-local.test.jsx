import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import Voice from '../../src/components/Voice'
import { voicePrefs } from '../../src/lib/speech'

const players = []
let available = true
vi.mock('../../src/lib/local-voice', () => ({
  loadLocalVoice: () => Promise.resolve({ available, voice: 'tr_TR-dfki-medium' }),
  createQueuePlayer: (opts) => {
    const p = { opts, play: vi.fn(async () => opts.onState('loading')), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), setRate: vi.fn() }
    players.push(p)
    return p
  },
}))

function browserSpeech() {
  const speech = { getVoices: () => [{ localService: true, lang: 'tr-TR', name: 'Yerel', voiceURI: 'y' }], addEventListener: vi.fn(), removeEventListener: vi.fn(), cancel: vi.fn(), speak: vi.fn(), pause: vi.fn(), resume: vi.fn() }
  vi.stubGlobal('speechSynthesis', speech)
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(t) { this.text = t } })
  return speech
}

beforeEach(() => { players.length = 0; available = true; localStorage.clear(); voicePrefs.reload(); vi.unstubAllGlobals() })

test('the local neural voice is used when installed, and the text never leaves the computer', async () => {
  const speech = browserSpeech()
  const user = userEvent.setup()
  render(<Voice text="Merhaba dünya. Bu bir deneme." />)
  await user.click(await screen.findByRole('button', { name: 'Açıklamayı seslendir' }))
  expect(players).toHaveLength(1)
  expect(players[0].play).toHaveBeenCalled()
  expect(speech.speak).not.toHaveBeenCalled()
  expect(players[0].opts.chunks.join(' ')).toContain('Merhaba dünya')
})

test('a fresh answer starts on the local voice by itself while sound is on', async () => {
  browserSpeech()
  render(<Voice text="Merhaba dünya." autoPlay />)
  await screen.findByRole('button', { name: 'Açıklamayı seslendir' })
  await act(async () => {})
  expect(players).toHaveLength(1)
})

test('if the local voice fails, the browser voice takes over instead of silence', async () => {
  const speech = browserSpeech()
  const user = userEvent.setup()
  render(<Voice text="Merhaba dünya." />)
  await user.click(await screen.findByRole('button', { name: 'Açıklamayı seslendir' }))
  act(() => players[0].opts.onState('error'))
  expect(speech.speak).toHaveBeenCalledTimes(1)
})

test('without the local voice the browser voice is used and the install hint is shown', async () => {
  available = false
  const speech = browserSpeech()
  const user = userEvent.setup()
  render(<Voice text="Merhaba dünya." />)
  await user.click(await screen.findByRole('button', { name: 'Açıklamayı seslendir' }))
  expect(players).toHaveLength(0)
  expect(speech.speak).toHaveBeenCalledTimes(1)
  expect(screen.getByText(/npm run tts:install/)).toBeInTheDocument()
})

test('the engine can be switched to the browser voice and the choice is remembered', async () => {
  const speech = browserSpeech()
  const user = userEvent.setup()
  render(<Voice text="Merhaba dünya." />)
  await screen.findByRole('button', { name: 'Açıklamayı seslendir' })
  await user.selectOptions(screen.getByLabelText('Ses motoru'), 'browser')
  expect(JSON.parse(localStorage.getItem('knot.voice.prefs')).engine).toBe('browser')
  await user.click(screen.getByRole('button', { name: 'Açıklamayı seslendir' }))
  expect(speech.speak).toHaveBeenCalledTimes(1)
  expect(players).toHaveLength(0)
})
