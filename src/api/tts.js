// Adım sesi: POST /api/tts { text, lang: 'tr' | 'en' } → { url }. Aynı metin sunucunun önbelleğinden döner.
// TTS_ENABLED yalnızca varsayılandır: StepBoard sunucudaki sesin kurulu olduğunu /api/tts/status ile öğrenir
// ve sesi o zaman açar (kurulu değilse tahta sessiz modda okuma süresiyle akar).
import { request } from './client'

export const TTS_ENABLED = false

export async function speak(text, lang = 'tr', signal) {
  const result = await request('POST', '/tts', { body: { text, lang }, signal })
  return result?.url || null
}

// Tahta için adım sesi getiren fonksiyon; ses kapalıysa null (ses düğmesi de çıkmaz).
export function stepAudioFetcher(lang = 'tr', say = speak, enabled = TTS_ENABLED) {
  if (!enabled) return null
  return async (_index, step) => {
    const url = await say((step.speech || step.board).trim(), lang)
    if (!url) throw new Error('Ses alınamadı')
    return url
  }
}
