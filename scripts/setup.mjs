#!/usr/bin/env node
/**
 * K-not tek komutla kurulum (Windows / macOS / Linux, yalnızca Node gerekir).
 *
 *   npm run setup                 # hazırla (ilk kez: ~5-15 dk; torch + model indirmesi nedeniyle)
 *   npm run setup -- --start      # hazırla ve servisleri başlat
 *
 * Bayraklar:
 *   --start               kurulumdan sonra frontend + backend + AI servisini başlatır
 *   --no-docker           Docker kullanma; MySQL 8'i kendin sağla (--database-url ile ver)
 *   --database-url=URL    --no-docker ile: MySQL bağlantı adresi (biçim: backend/.env.example → DATABASE_URL)
 *   --no-embeddings       torch / sentence-transformers kurma (yalnızca testler; gerçek model gerekmez)
 *   --help
 *
 * Betik tekrar çalıştırılabilir (idempotent): var olan .env değerlerini ezmez, yalnızca eksik
 * gizli değerleri üretir ve servisler arası ortak değerleri (DB adresi, tokenlar, STORAGE_ROOT) eşitler.
 * Gizli değerler ekrana yazılmaz.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv, isPlaceholder, newSecret, setEnv } from './lib/envfile.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = path.join(ROOT, 'backend')
const AI = path.join(ROOT, 'ai-service')
const WIN = process.platform === 'win32'
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

if (has('--help') || has('-h')) {
  console.log(readHeader())
  process.exit(0)
}
function readHeader() {
  return 'Kullanım: npm run setup [-- --start] [--no-docker --database-url=mysql://...] [--no-embeddings]\nAyrıntı: scripts/setup.mjs başındaki açıklama ve README.md "Kurulum".'
}

const info = (m) => console.log(`\n==> ${m}`)
const ok = (m) => console.log(`    ✓ ${m}`)
const warn = (m) => console.log(`    ! ${m}`)
const fail = (m) => { console.error(`\nHATA: ${m}`); process.exit(1) }

function capture(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: WIN && /^(npm|npx)$/.test(cmd) })
  return r.error || r.status !== 0 ? null : (r.stdout || '').trim()
}
function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env }, shell: WIN && /^(npm|npx)$/.test(cmd) })
  if (r.error || r.status !== 0) fail(`Komut başarısız: ${cmd} ${args.join(' ')}`)
}
const which = (cmd) => capture(WIN ? 'where' : 'which', [cmd])

// ── 0. Ön koşullar ───────────────────────────────────────────────────────────
info('Ön koşullar kontrol ediliyor')
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 19)) fail(`Node.js >= 20.19 gerekli (bulunan: ${process.versions.node}). https://nodejs.org (LTS 22 önerilir).`)
ok(`Node.js ${process.versions.node}`)

function findPython() {
  const candidates = process.env.PYTHON ? [[process.env.PYTHON]] : WIN ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']]
  for (const [cmd, ...pre] of candidates) {
    const v = capture(cmd, [...pre, '-c', 'import sys;print("%d.%d" % sys.version_info[:2])'])
    if (!v) continue
    const [maj, min] = v.split('.').map(Number)
    if (maj === 3 && min >= 11 && min <= 14) return { cmd, pre, version: v }
    warn(`${cmd} ${v} desteklenmiyor (3.11 – 3.14 gerekli)`)
  }
  return null
}
const python = findPython()
if (!python) fail('Python 3.11 – 3.14 bulunamadı. https://www.python.org/downloads (Windows: "Add python.exe to PATH" kutusunu işaretle). Başka yoldaysa: PYTHON=/yol/python npm run setup')
ok(`Python ${python.version}`)

const useDocker = !has('--no-docker')
if (useDocker) {
  if (!capture('docker', ['--version'])) fail("Docker bulunamadı. Docker Desktop kur (https://www.docker.com/products/docker-desktop) veya kendi MySQL 8'inle: npm run setup -- --no-docker --database-url=mysql://...")
  if (!capture('docker', ['info'])) fail("Docker kurulu ama çalışmıyor. Docker Desktop'ı aç, hazır olunca tekrar dene.")
  ok('Docker çalışıyor')
} else if (!opt('database-url') && isPlaceholder(getEnv(path.join(BACKEND, '.env'), 'DATABASE_URL'))) {
  fail('--no-docker ile --database-url=<MySQL bağlantı adresi> vermelisin (biçim: backend/.env.example → DATABASE_URL; MySQL 8 / MariaDB 10.6+).')
}
// Zorunlu olmayan harici araçlar: eksikse yalnızca ilgili özellik çalışmaz.
if (!which('pdftoppm')) warn('Poppler (pdftoppm) yok → PDF/PPTX özgün sayfa görüntüleri çalışmaz (metin araması çalışır). Kurulum: README "Gereksinimler".')
if (!which('ffmpeg')) warn('FFmpeg yok → yalnızca harici video motoru (MomentSearch) için gerekir; bu repodaki uygulama onsuz çalışır.')

// ── 1. Ortam dosyaları ───────────────────────────────────────────────────────
info('Ortam dosyaları hazırlanıyor ve eşitleniyor')
const dockerEnv = path.join(ROOT, '.env.docker')
const rootEnv = path.join(ROOT, '.env')
const beEnv = path.join(BACKEND, '.env')
const aiEnv = path.join(AI, '.env')
const copyIfMissing = (from, to) => { if (existsSync(to)) return false; copyFileSync(from, to); return true }

copyIfMissing(path.join(ROOT, '.env.example'), rootEnv)
if (copyIfMissing(path.join(ROOT, '.env.docker.example'), dockerEnv)) ok('.env.docker oluşturuldu (rastgele parolalar)')
for (const k of ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD']) if (isPlaceholder(getEnv(dockerEnv, k))) setEnv(dockerEnv, k, newSecret())
const aiFresh = copyIfMissing(path.join(AI, '.env.example'), aiEnv)
copyIfMissing(path.join(BACKEND, '.env.example'), beEnv)

let databaseUrl = opt('database-url')
if (!databaseUrl) {
  if (useDocker) {
    const u = getEnv(dockerEnv, 'MYSQL_USER'), p = encodeURIComponent(getEnv(dockerEnv, 'MYSQL_PASSWORD'))
    databaseUrl = `mysql://${u}:${p}@localhost:${getEnv(dockerEnv, 'MYSQL_HOST_PORT') || '3306'}/${getEnv(dockerEnv, 'MYSQL_DATABASE') || 'knot_dev'}`
  } else databaseUrl = getEnv(beEnv, 'DATABASE_URL')
}
setEnv(beEnv, 'DATABASE_URL', databaseUrl)
for (const k of ['JWT_SECRET', 'RAG_INTERNAL_API_TOKEN', 'INGEST_CALLBACK_TOKEN']) if (isPlaceholder(getEnv(beEnv, k))) setEnv(beEnv, k, newSecret(32))

const storage = path.join(ROOT, 'data', 'storage')
mkdirSync(storage, { recursive: true })
setEnv(beEnv, 'STORAGE_ROOT', storage)
setEnv(beEnv, 'AI_SERVICE_URL', 'http://localhost:8100')
setEnv(beEnv, 'PORT', '3000')
setEnv(aiEnv, 'RAG_INTERNAL_API_TOKEN', getEnv(beEnv, 'RAG_INTERNAL_API_TOKEN'))
setEnv(aiEnv, 'INGEST_CALLBACK_TOKEN', getEnv(beEnv, 'INGEST_CALLBACK_TOKEN'))
setEnv(aiEnv, 'STORAGE_ROOT', storage)
setEnv(aiEnv, 'NESTJS_INTERNAL_URL', 'http://localhost:3000')
setEnv(aiEnv, 'INGEST_ENABLED', 'true')
if (aiFresh) {
  // İlk kurulumda LLM sunucusu (Ollama) olmayabilir: çevrimdışı, LLM olmayan çıkarımsal sağlayıcıyla başla.
  setEnv(aiEnv, 'LLM_PROVIDER', 'extractive')
  warn('LLM_PROVIDER=extractive ayarlandı (LLM yok). Ollama kullanmak için ai-service/.env içinde LLM_PROVIDER=openai_compatible yap.')
}
ok('DATABASE_URL, tokenlar ve STORAGE_ROOT backend ↔ ai-service arasında eşitlendi')

// ── 2. Veritabanı (Docker) ───────────────────────────────────────────────────
if (useDocker) {
  info('MySQL (Docker) başlatılıyor')
  run('docker', ['compose', '--env-file', '.env.docker', 'up', '-d', '--wait', 'db'], ROOT)
  ok('MySQL sağlıklı')
}

// ── 3. Bağımlılıklar ─────────────────────────────────────────────────────────
info('Ön yüz bağımlılıkları (npm ci)')
run('npm', ['ci'], ROOT)
info('Backend bağımlılıkları (npm ci + prisma generate)')
run('npm', ['ci'], BACKEND)

info('AI servisi: Python sanal ortamı')
const venvPy = path.join(AI, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python')
if (!existsSync(venvPy)) run(python.cmd, [...python.pre, '-m', 'venv', '.venv'], AI)
run(venvPy, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], AI)
const reqs = ['-r', 'requirements-dev.txt']
if (!has('--no-embeddings')) { reqs.push('-r', 'requirements-embeddings.txt'); warn('torch ve gömme modeli büyük (birkaç GB); ilk kurulum/açılış uzun sürebilir.') }
run(venvPy, ['-m', 'pip', 'install', ...reqs], AI)
run(venvPy, ['-m', 'pip', 'install', '--no-deps', '-e', '.'], AI)
run(venvPy, ['-c', 'import knot_rag, knot_ingest, uvicorn, chromadb'], AI)
ok('Python bağımlılıkları tamam')

// ── 4. Migrasyon, seed, derleme ──────────────────────────────────────────────
info('Veritabanı şeması (prisma migrate deploy) ve başlangıç verisi')
run('npx', ['prisma', 'migrate', 'deploy'], BACKEND)
run('npm', ['run', 'db:seed:local', '--', 'scripts/seed.example.json'], BACKEND)
info('Backend derleniyor')
run('npm', ['run', 'build'], BACKEND)

// ── 5. Bitti ─────────────────────────────────────────────────────────────────
console.log('\nKurulum tamamlandı.')
console.log('  • Giriş hesapları (admin@knot.local, ayse@knot.local, …): yukarıda "written to <dosya>" satırındaki geçici dosyada;')
console.log('    ilk girişten sonra dosyayı sil. (Seed tekrar çalışınca mevcut kullanıcılara yeni parola üretmez.)')
if (has('--start')) {
  run(process.execPath, [path.join(ROOT, 'scripts', 'dev.mjs'), 'start'], ROOT)
} else {
  console.log('  • Başlat:  npm run start:all     Durum: npm run status:all     Durdur: npm run stop:all')
}
