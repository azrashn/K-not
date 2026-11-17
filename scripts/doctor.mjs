#!/usr/bin/env node
/**
 * K-not ortam teşhisi: Docker, MySQL, portlar, ayar dosyaları ve yerel model.
 *
 *   npm run doctor            teşhis yazdırır; sorun varsa çıkış kodu 1
 *   npm run doctor -- --fix   DATABASE_URL içindeki "localhost" adresini 127.0.0.1 yapar (yedek alır)
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnv, setEnv } from './lib/envfile.mjs'
import { classifyPortOwner, effectiveDockerStatus, diagnose, formatReport, hasFailure, modelNames, prefersLoopbackIp, useLoopbackIp } from './lib/doctor-core.mjs'
import { databaseTarget, dbLogin, localVoiceState, modelProbe, popplerAvailable, dockerStatus, fetchJson, listeningPids, mysqlState, tcpReachable } from './lib/ops.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_ENV = path.join(ROOT, 'backend', '.env')
const AI_ENV = path.join(ROOT, 'ai-service', '.env')
const PIDS = path.join(ROOT, 'logs', 'dev-pids.json')
const PORTS = { backend: 3000, frontend: 5173, ai: 8100 }
const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }

if (process.argv.includes('--fix')) {
  const url = getEnv(BACKEND_ENV, 'DATABASE_URL')
  if (url && prefersLoopbackIp(url)) {
    copyFileSync(BACKEND_ENV, `${BACKEND_ENV}.bak`)
    setEnv(BACKEND_ENV, 'DATABASE_URL', useLoopbackIp(url))
    console.log('DATABASE_URL "localhost" yerine 127.0.0.1 yapıldı (yedek: backend/.env.bak).\n')
  } else console.log('Düzeltilecek bir şey yok.\n')
}

const tracked = existsSync(PIDS) ? JSON.parse(readFileSync(PIDS, 'utf8')) : {}
const db = databaseTarget(BACKEND_ENV)
const dbReachable = db ? await tcpReachable(db.host === 'localhost' ? '127.0.0.1' : db.host, db.port) : false
const docker = db
  ? effectiveDockerStatus({ dockerStatus: dockerStatus(), mysqlReachable: dbReachable, envDockerExists: existsSync(path.join(ROOT, '.env.docker')), host: db.host })
  : 'skipped'

const ports = {}
for (const [name, port] of Object.entries(PORTS)) {
  const listening = await tcpReachable('127.0.0.1', port, 600)
  if (!listening) { ports[name] = { port, owner: 'free' }; continue }
  const pids = listeningPids(port)
  const mine = tracked[name] && alive(tracked[name]) ? [tracked[name]] : []
  ports[name] = { port, pids, owner: mine.length ? 'ours' : pids.length ? classifyPortOwner(pids, mine) : 'foreign' }
}

const baseUrl = getEnv(AI_ENV, 'UNIFIED_LLM_BASE_URL')
const model = getEnv(AI_ENV, 'UNIFIED_LLM_MODEL')
const llm = { configured: Boolean(baseUrl && model), baseUrl, model }
const ollama = llm.configured ? await (async () => {
  const body = await fetchJson(`${baseUrl.replace(/\/+$/, '')}/models`)
  return { reachable: body !== null, models: modelNames(body) }
})() : null

const deep = process.argv.includes('--deep')
const facts = {
  localVoice: localVoiceState(path.join(ROOT, 'ai-service'), getEnv(AI_ENV, 'TTS_VOICE_PATH')),
  poppler: popplerAvailable(getEnv(AI_ENV, 'PDFTOPPM_PATH')),
  modelProbe: deep && llm.configured && ollama?.reachable ? await modelProbe(baseUrl, model) : null,
  node: process.versions.node,
  docker,
  mysqlState: docker === 'running' ? mysqlState() : 'missing',
  mysqlReachable: dbReachable,
  dbLogin: dbReachable ? dbLogin(path.join(ROOT, 'backend')) : { skipped: true },
  databaseUrl: getEnv(BACKEND_ENV, 'DATABASE_URL'),
  envFiles: { missing: ['backend/.env', 'ai-service/.env'].filter((f) => !existsSync(path.join(ROOT, f))) },
  ports,
  ollama,
  llm,
}
const items = diagnose(facts)
console.log('K-not teşhis\n')
console.log(formatReport(items))
console.log(hasFailure(items) ? '\nBaşlatmadan önce ✗ ile işaretli sorunları giderin.' : '\nHazır görünüyor. Başlat: npm run start:all')
process.exitCode = hasFailure(items) ? 1 : 0
