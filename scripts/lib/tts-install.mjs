// Yerel ses (Piper) kurulumunun saf kısımları: hangi ses dosyaları, nereye. Düzen ai-service/src/knot_rag/tts
// ile aynıdır: <TTS_VOICES_DIR>/<ses>.onnx + <ses>.onnx.json; Türkçe ve İngilizce için ayrı ses.
import path from 'node:path'

export const TR_VOICES = { dfki: 'tr_TR-dfki-medium', fahrettin: 'tr_TR-fahrettin-medium', fettah: 'tr_TR-fettah-medium' }
export const DEFAULT_TR = 'dfki'
export const DEFAULT_EN_VOICE = 'en_US-ryan-medium'
const BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

/** tr_TR-dfki-medium → <base>/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx (+ .onnx.json) */
export function voiceFiles(voice, voicesDir) {
  const parts = String(voice).split('-')
  if (parts.length < 3 || !/^[a-z]{2}_[A-Z]{2}$/.test(parts[0]) || !parts.every((p) => /^[A-Za-z0-9_]+$/.test(p))) {
    throw new Error(`Beklenmeyen ses adı: ${voice}`)
  }
  const [locale, quality] = [parts[0], parts.at(-1)]
  const name = parts.slice(1, -1).join('-')
  const url = `${BASE}/${locale.split('_')[0]}/${locale}/${name}/${quality}/${voice}`
  return [
    { url: `${url}.onnx`, file: path.join(voicesDir, `${voice}.onnx`), minBytes: 5_000_000 },
    { url: `${url}.onnx.json`, file: path.join(voicesDir, `${voice}.onnx.json`), minBytes: 200 },
  ]
}

/** `--voice fettah` / `--voice=fettah` → Türkçe ses adı; bilinmeyen değer hata verir. */
export function parseVoiceArg(argv) {
  const i = argv.findIndex((a) => a === '--voice' || a.startsWith('--voice='))
  const key = i < 0 ? DEFAULT_TR : (argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1]) || DEFAULT_TR
  if (!Object.hasOwn(TR_VOICES, key)) throw new Error(`Bilinmeyen ses "${key}". Seçenekler: ${Object.keys(TR_VOICES).join(', ')}`)
  return TR_VOICES[key]
}

/** Göreli TTS_VOICES_DIR, ai-service klasörüne göredir (servis orada çalışır). */
export function resolveVoicesDir(aiDir, configured) {
  const dir = (configured || '').trim() || './piper-voices'
  return path.isAbsolute(dir) ? dir : path.join(aiDir, dir)
}
