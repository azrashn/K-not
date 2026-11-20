import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DEFAULT_EN_VOICE, parseVoiceArg, resolveVoicesDir, voiceFiles } from '../../scripts/lib/tts-install.mjs'

describe('tts install plan', () => {
  test('Turkish and English voices map to the piper-voices layout', () => {
    const [model, config] = voiceFiles('tr_TR-dfki-medium', path.join('ai', 'piper-voices'))
    expect(model.url).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx')
    expect(config.file).toBe(path.join('ai', 'piper-voices', 'tr_TR-dfki-medium.onnx.json'))
    expect(voiceFiles(DEFAULT_EN_VOICE, 'v')[0].url).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx')
  })
  test('a malformed voice name never becomes a URL or a path', () => {
    for (const bad of ['../evil', 'tr_TR-../x-medium', 'constructor', 'tr-dfki']) expect(() => voiceFiles(bad, 'v')).toThrow(/Beklenmeyen ses/)
  })
  test('--voice picks a known Turkish voice; unknown names are refused', () => {
    expect(parseVoiceArg([])).toBe('tr_TR-dfki-medium')
    expect(parseVoiceArg(['--voice', 'fettah'])).toBe('tr_TR-fettah-medium')
    expect(parseVoiceArg(['--voice=fahrettin'])).toBe('tr_TR-fahrettin-medium')
    expect(() => parseVoiceArg(['--voice', 'constructor'])).toThrow(/Bilinmeyen ses/)
  })
  test('a relative voices folder is inside ai-service, like the service sees it', () => {
    expect(resolveVoicesDir(path.join('r', 'ai-service'), '')).toBe(path.join('r', 'ai-service', 'piper-voices'))
    expect(resolveVoicesDir(path.join('r', 'ai-service'), './v')).toBe(path.join('r', 'ai-service', 'v'))
  })
})
