import { beforeEach, describe, expect, test } from 'vitest'
import { rankVoices, speechText, splitSpeech, voicePrefs } from '../../src/lib/speech'

describe('speechText', () => {
  test('removes markdown markers, links, citations and arrows', () => {
    const out = speechText('## Başlık\n\n**Kalın** ve *eğik* metin [1]. Bkz. [kaynak](https://example.com/x) ✳ →')
    expect(out).not.toMatch(/[#*\[\]]|https?:|✳|→/)
    expect(out).toContain('Başlık.')
    expect(out).toContain('Kalın ve eğik metin')
    expect(out).toContain('kaynak')
  })
  test('does not read code or formulas symbol by symbol', () => {
    const out = speechText('Şunu çalıştır:\n```js\nfor (let i=0;i<n;i++) {}\n```\nAlan $a^2 + b^2$ ve $$\\int x dx$$.')
    expect(out).toContain('Kod örneği ekranda gösteriliyor.')
    expect(out).not.toMatch(/for \(|\\int|\^/)
    expect(out).toContain('formül')
  })
  test('turns list items into sentences so they pause naturally', () => {
    expect(speechText('- Birinci madde\n- İkinci madde')).toBe('Birinci madde.\nİkinci madde.')
  })
  test('is safe on empty input', () => {
    expect(speechText(undefined)).toBe('')
    expect(speechText('')).toBe('')
  })
})

describe('splitSpeech', () => {
  test('splits into sentences and merges tiny pieces', () => {
    const parts = splitSpeech('Evet. Bu, oldukça uzun ve ayrı duracak kadar yeterli bir cümledir. İkinci uzun cümle de kendi başına duruyor.')
    expect(parts).toHaveLength(2)
    expect(parts[0].startsWith('Evet. Bu,')).toBe(true)
  })
  test('cuts overlong sentences at commas or spaces, never beyond the limit', () => {
    const long = Array.from({ length: 60 }, (_, i) => `kelime${i}`).join(' ') + '.'
    const parts = splitSpeech(long, 100)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.every((p) => p.length <= 100)).toBe(true)
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })
})

describe('rankVoices', () => {
  const v = (name, lang, localService, extra = {}) => ({ name, lang, localService, voiceURI: name, ...extra })
  const all = [v('English', 'en-US', true), v('Tolga', 'tr-TR', true), v('Emel Online (Natural)', 'tr-TR', false), v('Neural Local', 'tr_TR', true)]
  test('keeps only local Turkish voices by default, best first', () => {
    expect(rankVoices(all).map((x) => x.name)).toEqual(['Neural Local', 'Tolga'])
  })
  test('online voices need an explicit opt-in and then rank first when natural', () => {
    const set = [v('Tolga', 'tr-TR', true), v('Emel Online (Natural)', 'tr-TR', false)]
    expect(rankVoices(set).map((x) => x.name)).toEqual(['Tolga'])
    expect(rankVoices(set, { allowOnline: true }).map((x) => x.name)).toEqual(['Emel Online (Natural)', 'Tolga'])
  })
  test('no Turkish voice gives an empty list', () => {
    expect(rankVoices([v('English', 'en-US', true)])).toEqual([])
  })
})

describe('voicePrefs', () => {
  beforeEach(() => { localStorage.clear(); voicePrefs.reload() })
  test('sound is on by default', () => {
    expect(voicePrefs.get().auto).toBe(true)
  })
  test('persists and ignores broken or invalid stored values', () => {
    voicePrefs.set({ auto: false, rate: 1.1 })
    voicePrefs.reload()
    expect(voicePrefs.get()).toMatchObject({ auto: false, rate: 1.1 })
    localStorage.setItem('knot.voice.prefs', '{"auto":true,"rate":99,"online":"yes"}')
    voicePrefs.reload()
    expect(voicePrefs.get()).toMatchObject({ auto: true, rate: 1, online: false })
    localStorage.setItem('knot.voice.prefs', 'not json')
    voicePrefs.reload()
    expect(voicePrefs.get().auto).toBe(true)
  })
})
