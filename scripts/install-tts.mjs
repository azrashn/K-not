#!/usr/bin/env node
/**
 * Yerel Türkçe sinirsel ses kurulumu (tek seferlik, ~60 MB): Piper paketini AI servisinin sanal ortamına
 * kurar ve ses modelini ai-service/models/tts içine indirir. Kurulumdan sonra ses tamamen çevrimdışı çalışır.
 *
 *   npm run tts:install                 (varsayılan ses: dfki)
 *   npm run tts:install -- --voice fettah
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setEnv } from './lib/envfile.mjs'
import { DEFAULT_VOICE, VOICES, parseVoiceArg, voiceFiles } from './lib/tts-install.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AI = path.join(ROOT, 'ai-service')
const MODELS = path.join(AI, 'models', 'tts')
const WIN = process.platform === 'win32'
const py = path.join(AI, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python')
const fail = (msg) => { console.error(`\nHATA: ${msg}`); process.exit(1) }
const step = (msg) => console.log(`\n▸ ${msg}`)

async function download(url, file, minBytes) {
  if (existsSync(file) && statSync(file).size >= minBytes) { console.log(`  zaten var: ${path.basename(file)}`); return }
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) fail(`${url} indirilemedi (HTTP ${res.status}). İnternet bağlantınızı ve huggingface.co erişimini kontrol edin.`)
  const total = Number(res.headers.get('content-length')) || 0
  const tmp = `${file}.part`
  let got = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (c) => {
    got += c.length
    if (total) {
      const pct = Math.floor((got / total) * 10) * 10
      if (pct !== lastPct) { lastPct = pct; process.stdout.write(`\r  ${path.basename(file)}  %${pct}`) }
    }
  })
  await pipeline(body, createWriteStream(tmp))
  process.stdout.write('\n')
  if (statSync(tmp).size < minBytes) { rmSync(tmp, { force: true }); fail(`${path.basename(file)} eksik indi (beklenenden küçük). Tekrar deneyin.`) }
  renameSync(tmp, file)
}

const voice = parseVoiceArg(process.argv.slice(2))
if (!Object.hasOwn(VOICES, voice)) fail(`Bilinmeyen ses "${voice}". Seçenekler: ${Object.keys(VOICES).join(', ')}`)
if (!existsSync(py)) fail('AI servisinin Python ortamı yok. Önce: npm run setup')

step('Piper paketi (piper-tts) kuruluyor')
const pip = spawnSync(py, ['-m', 'pip', 'install', '--upgrade', 'piper-tts'], { stdio: 'inherit' })
if (pip.status !== 0) fail('piper-tts kurulamadı. Yukarıdaki pip hatasına bakın (internet veya Python sürümü uyumu).')

step(`Ses modeli indiriliyor: ${VOICES[voice].label}`)
mkdirSync(MODELS, { recursive: true })
for (const f of voiceFiles(voice, MODELS)) await download(f.url, f.file, f.minBytes)

if (voice !== DEFAULT_VOICE) {
  const model = path.join('models', 'tts', `tr_TR-${voice}-medium.onnx`)
  setEnv(path.join(AI, '.env'), 'TTS_VOICE_PATH', model)
  console.log(`  ai-service/.env içine TTS_VOICE_PATH=${model} yazıldı.`)
}

step('Deneme: ses motoru yükleniyor ve bir cümle üretiyor')
const model = voiceFiles(voice, MODELS)[0].file
const code = `
import io, sys, time, wave
from piper import PiperVoice
t = time.time()
v = PiperVoice.load(sys.argv[1])
buf = io.BytesIO()
with wave.open(buf, 'wb') as w:
    v.synthesize_wav('Merhaba, ben yerel Türkçe sesim.', w)
print(f'{len(buf.getvalue()) // 1024} KB ses, {time.time() - t:.1f} sn')
`
const test = spawnSync(py, ['-c', code, model], { encoding: 'utf8' })
if (test.status !== 0) fail(`Ses motoru çalışmadı:\n${(test.stderr || test.stdout).trim().split('\n').slice(-6).join('\n')}`)
console.log(`  ✓ ${test.stdout.trim()}`)
console.log('\nHazır. Servisleri yeniden başlatın:  npm run stop:all  ve  npm run start:all')
console.log('Tarayıcıda Ctrl+F5; yanıtlarda "Ses ayarları → Ses motoru: Yerel doğal ses" seçili olur.')
