#!/usr/bin/env node
/**
 * K-not servislerini (frontend 5173, backend 3000, AI 8100) arka planda başlat/durdur/izle.
 * Windows / macOS / Linux. Önce `npm run setup` çalıştırılmış olmalı.
 *
 *   node scripts/dev.mjs start | stop | status      (npm run start:all / stop:all / status:all)
 *
 * Günlükler logs/*.out.log ve logs/*.err.log içindedir.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureMysql, listeningPids, tcpReachable } from './lib/ops.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = path.join(ROOT, 'backend')
const AI = path.join(ROOT, 'ai-service')
const LOGS = path.join(ROOT, 'logs')
const PIDS = path.join(LOGS, 'dev-pids.json')
const WIN = process.platform === 'win32'
const PORTS = { frontend: 5173, backend: 3000, ai: 8100 }
const URLS = { frontend: `http://localhost:${PORTS.frontend}`, backend: `http://localhost:${PORTS.backend}/health`, ai: `http://localhost:${PORTS.ai}/docs` }
const cmd = process.argv[2] ?? 'status'

const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
// 127.0.0.1: Windows'ta "localhost" IPv6'ya (::1) çözülüp servise ulaşılamıyor görünebilir.
// Windows'ta Vite yalnızca "localhost" (IPv6) üzerinde dinleyebilir, API'ler 127.0.0.1'de: ikisini de dene.
async function reachable(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status < 500 } catch { return false } }
async function up(url) { return (await reachable(url.replace('localhost', '127.0.0.1'))) || (await reachable(url)) }
function tailLog(name, lines = 12) {
  const file = path.join(LOGS, `${name}.err.log`)
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-lines).map((l) => `      ${l}`).join('\n')
}
async function waitFor(name, seconds) {
  const until = Date.now() + seconds * 1000
  while (Date.now() < until) { if (await up(URLS[name])) return true; await new Promise((r) => setTimeout(r, 1500)) }
  return false
}
const readPids = () => (existsSync(PIDS) ? JSON.parse(readFileSync(PIDS, 'utf8')) : {})

function stop() {
  for (const pid of Object.values(readPids())) {
    if (!alive(pid)) continue
    if (WIN) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else { try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch {} } }
  }
  rmSync(PIDS, { force: true })
  console.log('Servisler durduruldu (Docker MySQL açık bırakıldı; kapatmak için: docker compose down).')
}

function launch(name, file, args, cwd) {
  const out = openSync(path.join(LOGS, `${name}.out.log`), 'w')
  const err = openSync(path.join(LOGS, `${name}.err.log`), 'w')
  const child = spawn(file, args, { cwd, detached: true, stdio: ['ignore', out, err], windowsHide: true })
  child.unref()
  return child.pid
}

async function start() {
  const venvPy = path.join(AI, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python')
  const missing = [
    [path.join(ROOT, 'node_modules'), 'ön yüz bağımlılıkları'],
    [path.join(BACKEND, 'dist', 'main.js'), 'backend derlemesi'],
    [path.join(BACKEND, '.env'), 'backend/.env'],
    [path.join(AI, '.env'), 'ai-service/.env'],
    [venvPy, 'Python sanal ortamı'],
  ].filter(([p]) => !existsSync(p))
  if (missing.length) {
    console.error(`HATA: eksik: ${missing.map((m) => m[1]).join(', ')}. Önce çalıştır:  npm run setup`)
    process.exit(1)
  }
  const mysql = await ensureMysql({ root: ROOT, backendEnv: path.join(BACKEND, '.env'), log: (m) => console.log(`  ${m}`) })
  console.log(`  ${mysql.ok ? '✓' : '✗'} ${mysql.message}`)
  if (!mysql.ok) { console.error('\nVeritabanı hazır değil; servisler başlatılmadı. Ayrıntı: npm run doctor'); process.exit(1) }
  stop()
  mkdirSync(LOGS, { recursive: true })
  // Eski bir süreç aynı portu tutuyorsa yeni servis açılamaz ve hazır kontrolü eskisini "çalışıyor" sanır.
  const blocked = []
  for (const [name, port] of Object.entries(PORTS))
    if (await tcpReachable('127.0.0.1', port, 600)) blocked.push(`${name} (${port})${listeningPids(port).length ? ` PID ${listeningPids(port).join(', ')}` : ''}`)
  if (blocked.length) {
    console.error(`HATA: şu portlar başka bir program tarafından kullanılıyor: ${blocked.join('; ')}.\nProgramı kapatın (Windows: taskkill /PID <numara> /F) ya da nedenini görmek için: npm run doctor`)
    process.exit(1)
  }
  const pids = {
    frontend: launch('frontend', process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORTS.frontend), '--strictPort'], ROOT),
    backend: launch('backend', process.execPath, ['--env-file=.env', 'dist/main.js'], BACKEND),
    // AI servisi ayarlarını uvicorn'un --env-file'ından okur (tırnaklı değer ve satır içi yorumları doğru işler).
    ai: launch('ai', venvPy, ['-m', 'uvicorn', 'knot_rag.main:app', '--host', '127.0.0.1', '--port', String(PORTS.ai), '--env-file', '.env'], AI),
  }
  writeFileSync(PIDS, JSON.stringify(pids))
  console.log('Servisler başlatıldı; hazır olmaları bekleniyor (AI servisi ilk açılışta modeli indirebilir)…')
  const results = {}
  for (const [name, secs] of [['backend', 60], ['frontend', 60], ['ai', 600]]) {
    results[name] = await waitFor(name, secs)
    console.log(`  ${results[name] ? '✓' : '✗'} ${name.padEnd(9)} ${URLS[name]}${results[name] ? '' : `   → logs/${name}.err.log`}`)
  }
  // Açılıp hemen kapanan servisleri yakala: hazır göründükten kısa süre sonra yeniden kontrol et.
  if (Object.values(results).every(Boolean)) {
    await new Promise((r) => setTimeout(r, 4000))
    for (const name of Object.keys(PORTS)) {
      if (await up(URLS[name])) continue
      results[name] = false
      console.log(`  ✗ ${name.padEnd(9)} açıldıktan sonra kapandı. Son hata satırları:\n${tailLog(name) || '      (günlük boş; ayrıntı: npm run doctor)'}`)
    }
  }
  if (Object.values(results).every(Boolean)) console.log(`\nHazır:  http://localhost:${PORTS.frontend}\nDurdur: npm run stop:all`)
  else { console.log('\nBazı servisler hazır değil; logs/ altındaki *.err.log dosyalarına bak (README → Sorun giderme).'); process.exitCode = 1 }
}

async function status() {
  const pids = readPids()
  for (const name of Object.keys(PORTS)) {
    const state = (await up(URLS[name])) ? 'ÇALIŞIYOR' : 'KAPALI'
    console.log(`${name.padEnd(9)} ${state.padEnd(10)} ${URLS[name]}${pids[name] && alive(pids[name]) ? `  (pid ${pids[name]})` : ''}`)
  }
}

if (cmd === 'start') await start()
else if (cmd === 'stop') stop()
else if (cmd === 'status') await status()
else { console.error('Kullanım: node scripts/dev.mjs start|stop|status'); process.exit(2) }
