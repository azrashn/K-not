// Yerel Türkçe sinirsel ses (Piper) kurulumunun saf kısımları: hangi dosyalar, nereye.
import path from 'node:path'

export const VOICES = {
  dfki: { label: 'DFKI (erkek, orta kalite)' },
  fahrettin: { label: 'Fahrettin (erkek, orta kalite)' },
  fettah: { label: 'Fettah (erkek, orta kalite)' },
}
export const DEFAULT_VOICE = 'dfki'
const BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/tr/tr_TR'

export function voiceFiles(voice, modelsDir) {
  if (!Object.hasOwn(VOICES, voice)) throw new Error(`Bilinmeyen ses: ${voice}. Seçenekler: ${Object.keys(VOICES).join(', ')}`)
  const name = `tr_TR-${voice}-medium`
  return [
    { url: `${BASE}/${voice}/medium/${name}.onnx`, file: path.join(modelsDir, `${name}.onnx`), minBytes: 5_000_000 },
    { url: `${BASE}/${voice}/medium/${name}.onnx.json`, file: path.join(modelsDir, `${name}.onnx.json`), minBytes: 200 },
  ]
}

/** `--voice fettah` / `--voice=fettah`; verilmezse varsayılan. */
export function parseVoiceArg(argv) {
  const i = argv.findIndex((a) => a === '--voice' || a.startsWith('--voice='))
  if (i < 0) return DEFAULT_VOICE
  return argv[i].includes('=') ? argv[i].split('=')[1] : argv[i + 1] || DEFAULT_VOICE
}
