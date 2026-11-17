import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_VOICE, parseVoiceArg, voiceFiles } from '../../scripts/lib/tts-install.mjs'

describe('tts install plan', () => {
  test('downloads the model and its config into the models folder', () => {
    const [model, config] = voiceFiles('dfki', path.join('x', 'models'))
    expect(model.url).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx')
    expect(config.url.endsWith('.onnx.json')).toBe(true)
    expect(model.file).toBe(path.join('x', 'models', 'tr_TR-dfki-medium.onnx'))
    expect(model.minBytes).toBeGreaterThan(config.minBytes)
  })
  test('refuses an unknown voice instead of building a URL from user input', () => {
    expect(() => voiceFiles('../evil', 'm')).toThrow(/Bilinmeyen ses/)
    expect(() => voiceFiles('constructor', 'm')).toThrow(/Bilinmeyen ses/)
  })
  test('reads --voice in both spellings and defaults sensibly', () => {
    expect(parseVoiceArg([])).toBe(DEFAULT_VOICE)
    expect(parseVoiceArg(['--voice', 'fettah'])).toBe('fettah')
    expect(parseVoiceArg(['--voice=fahrettin'])).toBe('fahrettin')
    expect(parseVoiceArg(['--voice'])).toBe(DEFAULT_VOICE)
  })
})
