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
async function up(url) { try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).status < 500 } catch { return false } }
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
  stop()
  mkdirSync(LOGS, { recursive: true })
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
