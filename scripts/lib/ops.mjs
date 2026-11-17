// Docker / MySQL / port / model kontrolleri (G/Ç). Karar kuralları doctor-core.mjs içindedir.
import { spawnSync } from 'node:child_process'
import net from 'node:net'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { getEnv } from './envfile.mjs'
import { listeningPidsFromNetstat, mysqlContainerState, parseDatabaseUrl, parseDockerPs, usesDockerMysql } from './doctor-core.mjs'

const WIN = process.platform === 'win32'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function docker(args, timeout = 15000) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout, windowsHide: true })
  if (r.error?.code === 'ENOENT') return { missing: true, status: 1, stdout: '', stderr: '' }
  return { missing: false, status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' }
}

/** 'running' | 'stopped' (kurulu ama kapalı) | 'missing' (kurulu değil) */
export function dockerStatus() {
  const r = docker(['info'], 20000)
  if (r.missing) return 'missing'
  return r.status === 0 ? 'running' : 'stopped'
}

export function mysqlState(name = 'knot_mysql') {
  const r = docker(['ps', '-a', '--format', '{{.Names}}|{{.State}}|{{.Status}}'])
  return r.status === 0 ? mysqlContainerState(parseDockerPs(r.stdout), name) : 'missing'
}

export function tcpReachable(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    const done = (ok) => { s.destroy(); resolve(ok) }
    s.setTimeout(timeout, () => done(false))
    s.once('connect', () => done(true))
    s.once('error', () => done(false))
  })
}

/** Portu dinleyen süreç numaraları (en iyi çaba; bulunamazsa boş). */
export function listeningPids(port) {
  if (WIN) {
    const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    return r.status === 0 ? listeningPidsFromNetstat(r.stdout, port) : []
  }
  const r = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', timeout: 10000 })
  return r.status === 0 ? r.stdout.split(/\s+/).filter(Boolean).map(Number) : []
}

export function databaseTarget(backendEnvFile) {
  return parseDatabaseUrl(getEnv(backendEnvFile, 'DATABASE_URL') || '')
}

export function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * MySQL konteynerini hazır hale getirir: kapalıysa başlatır, yoksa compose ile oluşturur ve
 * sağlıklı olana kadar bekler. Docker kullanılmıyorsa yalnızca bağlantıyı doğrular.
 * Dönüş: {ok, message}
 */
export async function ensureMysql({ root, backendEnv, log = () => {}, waitSeconds = 90 }) {
  const db = databaseTarget(backendEnv)
  if (!db) return { ok: false, message: 'backend/.env içindeki DATABASE_URL okunamadı. Önce: npm run setup' }
  const dockerManaged = usesDockerMysql({ envDockerExists: existsSync(path.join(root, '.env.docker')), host: db.host })
  if (!dockerManaged) {
    return (await tcpReachable(db.host, db.port))
      ? { ok: true, message: `Veritabanı hazır (${db.host}:${db.port})` }
      : { ok: false, message: `Veritabanına bağlanılamıyor (${db.host}:${db.port}).` }
  }
  if (dockerStatus() !== 'running') {
    // Docker kapalı ama veritabanı zaten ulaşılabilirse (kendi MySQL'iniz) devam edilir.
    return (await tcpReachable(db.host === 'localhost' ? '127.0.0.1' : db.host, db.port))
      ? { ok: true, message: `Veritabanı hazır (${db.host}:${db.port}; Docker kullanılmıyor)` }
      : { ok: false, message: "Docker çalışmıyor. Docker Desktop'ı açın, hazır olunca tekrar deneyin." }
  }

  let state = mysqlState()
  if (state === 'stopped') {
    log('MySQL konteyneri kapalı, başlatılıyor…')
    docker(['start', 'knot_mysql'], 60000)
  } else if (state === 'missing') {
    log('MySQL konteyneri yok, oluşturuluyor…')
    const r = docker(['compose', '--env-file', '.env.docker', 'up', '-d', 'db'], 180000)
    if (r.status !== 0) return { ok: false, message: `MySQL oluşturulamadı: ${r.stderr.trim().split('\n').pop()}` }
  }
  const until = Date.now() + waitSeconds * 1000
  while (Date.now() < until) {
    state = mysqlState()
    if (state === 'healthy' && (await tcpReachable(db.host === 'localhost' ? '127.0.0.1' : db.host, db.port))) {
      return { ok: true, message: 'MySQL hazır (knot_mysql sağlıklı)' }
    }
    if (state === 'unhealthy') break
    await sleep(2000)
  }
  return { ok: false, message: `MySQL ${waitSeconds} saniyede sağlıklı olmadı (durum: ${state}). Günlük: docker logs knot_mysql --tail 30` }
}

export async function fetchJson(url, timeout = 2500) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/**
 * Gerçek giriş denemesi: backend'in kendi sürücüsü ve URL kuralıyla "select 1". Yalnızca portun açık
 * olması yetmez; kimlik doğrulama yöntemi uyuşmazsa bağlantı sessizce takılır (pool timeout).
 * Dönüş: {ok, error} ya da derlenmiş backend yoksa {skipped: true}.
 */
export function dbLogin(dir) {
  const backendDir = path.resolve(dir)
  const service = path.join(backendDir, 'dist', 'prisma', 'prisma.service.js')
  if (!existsSync(service) || !existsSync(path.join(backendDir, '.env'))) return { skipped: true }
  const code = `
    const { mariaDbUrl } = require(${JSON.stringify(service)});
    const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
    new PrismaMariaDb(mariaDbUrl(process.env.DATABASE_URL)).connect()
      .then((c) => c.queryRaw({ sql: 'select 1 as ok', args: [], argTypes: [] }))
      .then(() => process.exit(0))
      .catch((e) => { console.error(String(e && e.message).split('\\n')[0]); process.exit(1) })`
  const r = spawnSync(process.execPath, ['--env-file=.env', '-e', code], { cwd: backendDir, encoding: 'utf8', timeout: 25000, windowsHide: true })
  return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || r.error?.message || 'bilinmeyen hata').split('\n').map((l) => l.trim()).find((l) => l && !/^Node\.js v/.test(l)) || 'bilinmeyen hata' }
}

/** Poppler (pdftoppm): PDF sayfa görüntüsü ve taranmış PDF için gerekir. PDFTOPPM_PATH ya da PATH. */
export function popplerAvailable(explicitPath) {
  if (explicitPath) return existsSync(explicitPath)
  const r = spawnSync(WIN ? 'where' : 'which', ['pdftoppm'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  return r.status === 0 && Boolean(r.stdout.trim())
}

/**
 * Modele gerçekten bir istek gönderir (yalnızca model listesine bakmak yetmez: model belleğe sığmayabilir,
 * adres yanlış olabilir). İlk istek modeli belleğe yükler, bu yüzden uzun sürebilir.
 */
export async function modelProbe(baseUrl, model, timeoutMs = 120000) {
  const started = Date.now()
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Yalnızca "tamam" yaz.' }], max_tokens: 8, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200).replace(/\s+/g, ' ')}` }
    return { ok: true, ms: Date.now() - started }
  } catch (e) {
    const timeout = e?.name === 'TimeoutError'
    return { ok: false, error: timeout ? `${Math.round(timeoutMs / 1000)} saniyede yanıt gelmedi (model yükleniyor ya da makine yavaş olabilir)` : `${e?.cause?.code || e?.name}: ${e?.cause?.message || e?.message}` }
  }
}
