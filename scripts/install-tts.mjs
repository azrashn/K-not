#!/usr/bin/env node
/**
 * Yerel sesli anlatım kurulumu (tek seferlik, ~130 MB): Piper'ı AI servisinin sanal ortamına kurar, Türkçe ve
 * İngilizce sesi ai-service/piper-voices içine indirir, gereken iki gizli anahtarı (boşsa) üretir ve bir deneme
 * cümlesi seslendirir. Kurulumdan sonra ses tamamen çevrimdışı çalışır. Sohbet ve tahta aynı sesi kullanır.
 *
 *   npm run tts:install                  (Türkçe ses: dfki)
 *   npm run tts:install -- --voice fettah
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv, setEnv } from './lib/envfile.mjs'
import { DEFAULT_EN_VOICE, parseVoiceArg, resolveVoicesDir, voiceFiles } from './lib/tts-install.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const AI = path.join(ROOT, 'ai-service')
const AI_ENV = path.join(AI, '.env')
const BACKEND_ENV = path.join(ROOT, 'backend', '.env')
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
  if (statSync(tmp).size < minBytes) { rmSync(tmp, { force: true }); fail(`${path.basename(file)} eksik indi. Tekrar deneyin.`) }
  renameSync(tmp, file)
}

let trVoice
try { trVoice = parseVoiceArg(process.argv.slice(2)) } catch (e) { fail(e.message) }
if (!existsSync(py)) fail('AI servisinin Python ortamı yok. Önce: npm run setup')
if (!existsSync(AI_ENV) || !existsSync(BACKEND_ENV)) fail('ai-service/.env veya backend/.env yok. Önce: npm run setup')

step('Piper paketi kuruluyor (requirements-tts.txt)')
const pip = spawnSync(py, ['-m', 'pip', 'install', '-r', path.join(AI, 'requirements-tts.txt')], { stdio: 'inherit' })
if (pip.status !== 0) fail('Piper kurulamadı. Yukarıdaki pip hatasına bakın (internet veya Python sürümü uyumu).')

const voicesDir = resolveVoicesDir(AI, getEnv(AI_ENV, 'TTS_VOICES_DIR'))
const enVoice = getEnv(AI_ENV, 'TTS_VOICE_EN') || DEFAULT_EN_VOICE
mkdirSync(voicesDir, { recursive: true })
for (const voice of [trVoice, enVoice]) {
  step(`Ses indiriliyor: ${voice}`)
  for (const f of voiceFiles(voice, voicesDir)) await download(f.url, f.file, f.minBytes)
}

step('Ayarlar')
if (getEnv(AI_ENV, 'TTS_VOICE_TR') !== trVoice) { setEnv(AI_ENV, 'TTS_VOICE_TR', trVoice); console.log(`  ai-service/.env: TTS_VOICE_TR=${trVoice}`) }
if ((getEnv(AI_ENV, 'TTS_KEY_SECRET') || '').length < 16) { setEnv(AI_ENV, 'TTS_KEY_SECRET', randomBytes(24).toString('hex')); console.log('  ai-service/.env: TTS_KEY_SECRET üretildi') }
if ((getEnv(BACKEND_ENV, 'TTS_URL_SECRET') || '').length < 32) { setEnv(BACKEND_ENV, 'TTS_URL_SECRET', randomBytes(32).toString('hex')); console.log('  backend/.env: TTS_URL_SECRET üretildi') }

step('Deneme: Türkçe ses bir cümle üretiyor')
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
const test = spawnSync(py, ['-c', code, voiceFiles(trVoice, voicesDir)[0].file], { encoding: 'utf8' })
if (test.status !== 0) fail(`Ses motoru çalışmadı:\n${(test.stderr || test.stdout).trim().split('\n').slice(-6).join('\n')}`)
console.log(`  ✓ ${test.stdout.trim()}`)
console.log('\nHazır. Servisleri yeniden başlatın:  npm run stop:all  ve  npm run start:all')
console.log('Not: varsayılan ses dosyaları CC BY-NC-SA 4.0 lisanslıdır (ticari kullanım yok, atıf gerekir).')
