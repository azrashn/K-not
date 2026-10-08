#!/usr/bin/env node
/**
 * WBS-5 real end-to-end smoke test (no mocks): browser → Vite preview (/api proxy) → NestJS →
 * MySQL, NestJS → Python ai-service (WBS-2 ingestion + WBS-3 RAG, in-memory Chroma).
 *
 *   npm run build && (cd backend && npm run build) && npm run test:e2e
 *
 * Requires an EMPTY, dedicated MySQL 8 database at E2E_DATABASE_URL (migrations are applied with the
 * non-destructive `migrate deploy`; the run refuses to start if documents already exist), Python with the
 * ai-service requirements, and a Chromium (CHROMIUM_PATH, default /opt/pw-browsers/chromium).
 * Embeddings use the deterministic `hashing` backend so the run needs no model download; the
 * IndexVersion seeded below carries the same configuration, so the backend index guard passes.
 * The answer provider is the extractive baseline (not an LLM).
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BACKEND = path.join(ROOT, 'backend')
const AI = path.join(ROOT, 'ai-service')
const FIXTURES = path.join(AI, 'tests/ingest/fixtures')
const DB = process.env.E2E_DATABASE_URL ?? 'mysql://knot:knot-dev-password@localhost:3306/knot_e2e'
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'
const PYTHON = process.env.PYTHON ?? 'python3'
const PASSWORD = 'e2e-password-123'
const RAG_TOKEN = 'e2e-rag-internal-token'
const CALLBACK_TOKEN = 'e2e-ingest-callback-token'
const COLLECTION = 'knot_e2e_hashing'
const QUESTION = 'AVL ağacında sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?'

const work = mkdtempSync(path.join(tmpdir(), 'knot-e2e-'))
const storage = path.join(work, 'storage')
mkdirSync(storage)
const procs = []
const results = []

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

async function waitFor(what, fn, ms = 120_000) {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > until) throw new Error(`timed out waiting for ${what} (logs in ${work})`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`)
}

function start(name, cmd, args, opts) {
  const out = openSync(path.join(work, `${name}.log`), 'w')
  const p = spawn(cmd, args, { stdio: ['ignore', out, out], ...opts })
  procs.push(p)
  return p
}

async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t })
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`)
    throw e
  }
}

function check(cond, msg) { if (!cond) throw new Error(msg) }

async function main() {
  const [aiPort, apiPort, webPort] = [await freePort(), await freePort(), await freePort()]
  const ai = `http://127.0.0.1:${aiPort}`
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const web = `http://127.0.0.1:${webPort}`

  console.log(`work dir: ${work}`)
  // 1) Database: migrate + admin seed (seed-only accounts, U1). Never resets data.
  const dbEnv = { ...process.env, DATABASE_URL: DB }
  run('npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND, env: dbEnv })
  const conn = await createRequire(path.join(BACKEND, 'package.json'))('mariadb').createConnection(DB.replace(/^mysql:/, 'mariadb:'))
  const [{ n }] = await conn.query('SELECT COUNT(*) AS n FROM Document')
  await conn.end()
  if (Number(n) > 0) throw new Error('E2E_DATABASE_URL must point at an empty, dedicated database (documents found)')
  const seedFile = path.join(work, 'seed.json')
  writeFileSync(seedFile, JSON.stringify({
    users: [
      { email: 'ayse@knot.local', display_name: 'Ayşe Yılmaz', password: PASSWORD },
      { email: 'mehmet@knot.local', display_name: 'Mehmet Demir', password: PASSWORD },
    ],
    courses: [
      { code: 'BIL 211', name: 'Veri Yapıları', term: 'Güz 2026', instructor_name: 'Doç. Dr. M. Aydın', members: [{ email: 'ayse@knot.local', role: 'STUDENT' }] },
      { code: 'BIL 304', name: 'İşletim Sistemleri', term: 'Güz 2026', members: [{ email: 'mehmet@knot.local', role: 'STUDENT' }] },
    ],
    index_version: {
      collection: COLLECTION, chunker_version: 'c1',
      embedding: { backend: 'hashing', model: 'knot-hashing-v1', revision: null, dimension: 512, query_prefix: '', document_prefix: '', normalize: true, distance: 'cosine' },
    },
  }))
  run('npx', ['ts-node', 'scripts/seed.ts', seedFile], { cwd: BACKEND, env: dbEnv })

  // 2) Python ai-service (WBS-2 ingestion + WBS-3 RAG). Internal tokens stay server-side.
  start('ai-service', PYTHON, ['-m', 'uvicorn', 'knot_rag.main:app', '--host', '127.0.0.1', '--port', String(aiPort)], {
    cwd: AI,
    env: {
      ...process.env, PYTHONPATH: 'src', RAG_INTERNAL_API_TOKEN: RAG_TOKEN, CHROMA_MODE: 'memory', CHROMA_COLLECTION: COLLECTION,
      EMBEDDING_BACKEND: 'hashing', EMBEDDING_MODEL: 'knot-hashing-v1', EMBEDDING_REVISION: '', EMBEDDING_QUERY_PREFIX: '', EMBEDDING_DOCUMENT_PREFIX: '',
      LLM_PROVIDER: 'extractive', INGEST_ENABLED: 'true', STORAGE_ROOT: storage, NESTJS_INTERNAL_URL: apiUrl,
      INGEST_CALLBACK_TOKEN: CALLBACK_TOKEN, INGEST_HEARTBEAT_SECONDS: '5', LOG_LEVEL: 'WARNING',
    },
  })
  await waitFor('ai-service /health', async () => (await fetch(`${ai}/health`)).ok)
  await fetch(`${ai}/ready`)

  // 3) NestJS backend (built dist).
  start('backend', 'node', ['dist/main.js'], {
    cwd: BACKEND,
    env: {
      ...process.env, DATABASE_URL: DB, PORT: String(apiPort), JWT_SECRET: 'e2e-jwt-secret-at-least-32-characters-long',
      STORAGE_ROOT: storage, AI_SERVICE_URL: ai, RAG_INTERNAL_API_TOKEN: RAG_TOKEN, INGEST_CALLBACK_TOKEN: CALLBACK_TOKEN,
      SCHEDULER_ENABLED: 'true', LOG_LEVEL: 'warn',
    },
  })
  await waitFor('backend', async () => (await fetch(`${apiUrl}/courses`)).status === 401)

  // 4) Built frontend served by `vite preview`, /api proxied to the backend (browser never sees ai-service).
  start('web', 'npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, VITE_API_PROXY_TARGET: apiUrl },
  })
  await waitFor('vite preview', async () => (await fetch(web)).ok)

  // 5) Browser.
  const browser = await chromium.launch({ executablePath: CHROMIUM })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const browserHosts = new Set()
  page.on('request', (r) => browserHosts.add(new URL(r.url()).host))
  const shot = (n) => page.screenshot({ path: path.join(work, `${n}.png`) })
  let courseHash = ''
  let docId = ''

  try {
    await page.goto(web)

    await step('wrong password is rejected', async () => {
      await page.getByLabel('E-posta').fill('ayse@knot.local')
      await page.getByLabel('Parola').fill('wrong-password-1')
      await page.getByRole('button', { name: 'Giriş yap' }).click()
      await page.getByText('E-posta ya da parola hatalı.').waitFor()
    })

    await step('LOGIN as a seeded student', async () => {
      await page.getByLabel('Parola').fill(PASSWORD)
      await page.getByRole('button', { name: 'Giriş yap' }).click()
      await page.getByRole('button', { name: 'Çıkış yap' }).waitFor()
      const stored = await page.evaluate(() => sessionStorage.getItem('knot.session'))
      check(stored && !stored.includes(RAG_TOKEN) && !stored.includes(CALLBACK_TOKEN), 'session storage must hold only the user JWT')
    })

    await step('COURSE list comes from the API (member courses only)', async () => {
      await page.goto(`${web}/#/dersler`)
      await page.getByText('Veri Yapıları', { exact: true }).waitFor()
      check(await page.getByText('İşletim Sistemleri', { exact: true }).count() === 0, 'non-member course must not be listed')
      await page.getByText('Henüz materyal yok').waitFor()
      await page.getByText('Veri Yapıları', { exact: true }).click()
      await page.waitForFunction(() => /#\/dersler\/[^/]+$/.test(location.hash))
      courseHash = await page.evaluate(() => location.hash)
    })

    await step('PDF UPLOAD → PROCESSING → READY (real WBS-2 ingestion)', async () => {
      await page.getByRole('button', { name: /Materyal ekle/ }).click()
      await page.getByLabel('Dosya seç').setInputFiles(path.join(FIXTURES, 'slides_tr.pdf'))
      const row = page.locator('[data-material]').filter({ hasText: 'slides_tr.pdf' })
      await row.waitFor()
      docId = await row.getAttribute('data-material')
      await page.locator(`[data-material="${docId}"][data-state="ready"]`).waitFor({ timeout: 180_000 })
      await shot('01-ready')
    })

    await step('scanned PDF fails with the server NO_TEXT_LAYER message', async () => {
      await page.getByLabel('Dosya seç').setInputFiles(path.join(FIXTURES, 'scanned.pdf'))
      const row = page.locator('[data-material][data-state="error"]').filter({ hasText: 'scanned.pdf' })
      await row.waitFor({ timeout: 180_000 })
      const issue = await row.locator('[data-issue]').innerText()
      check(/metin/i.test(issue), `unexpected issue text: ${issue}`)
      console.log(`    issue: ${issue}`)
    })

    await step('non-PDF is rejected before upload', async () => {
      await page.getByLabel('Dosya seç').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a pdf') })
      await page.getByText(/notes\.txt:/).waitFor()
    })

    await step('download streams the stored PDF with the bearer token', async () => {
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'slides_tr.pdf indir' }).click(),
      ])
      const file = path.join(work, 'download.pdf')
      await dl.saveAs(file)
      const head = spawnSync('head', ['-c', '5', file]).stdout.toString()
      check(head === '%PDF-', `downloaded file is not a PDF (${head})`)
    })

    let quote = ''
    let cite = null
    await step('QUESTION → ANSWER (extractive baseline, server support label)', async () => {
      await page.getByRole('button', { name: /Çalışma alanını aç/ }).click()
      const box = page.getByLabel('Materyallerine bir soru sor')
      await box.fill(QUESTION)
      const answered = page.waitForResponse((r) => r.url().endsWith('/answers'))
      await page.getByRole('button', { name: 'Soruyu gönder' }).click()
      const answer = await (await answered).json()
      check(answer.generation?.provider === 'extractive_baseline', `unexpected provider ${answer.generation?.provider}`)
      cite = answer.claims.flatMap((c) => c.citations).find((c) => c.document_id === docId && c.label === 'Slayt · s.4')
      check(cite, 'answer has no citation for slides page 4')
      await page.getByText(/üretken bir dil modeliyle değil/).waitFor({ timeout: 60_000 })
      const knot = await page.locator('[data-knot]').first().getAttribute('data-knot')
      console.log(`    support label: ${knot}`)
      await page.getByRole('button', { name: /Kaynak: Slayt · s\.4/ }).first().waitFor()
      await shot('02-answer')
    })

    await step('SOURCE VIEWER: real page 4 text, mark equals the verified quote', async () => {
      await page.getByRole('button', { name: /Kaynak: Slayt · s\.4/ }).first().click()
      const body = await page.evaluate(async (id) => {
        const { token } = JSON.parse(sessionStorage.getItem('knot.session'))
        return (await fetch(`/api/documents/${id}/pages/4?indexing_version=c1`, { headers: { Authorization: `Bearer ${token}` } })).json()
      }, docId)
      check(body.page === 4 && body.text.length > 0, 'page endpoint did not return page 4 text')
      await page.getByText(/sayfa 4 \/ \d+/).waitFor()
      const mark = page.locator('[data-evidence-mark]')
      await mark.waitFor()
      quote = await mark.innerText()
      check(quote.length > 0 && body.text.includes(quote), 'highlight must be a substring of the real page text')
      check(cite.quote_verified && quote === cite.quote, `mark "${quote}" differs from the verified citation quote "${cite.quote}"`)
      console.log(`    mark: "${quote.slice(0, 80)}"`)
      await page.waitForTimeout(600) // let the 460 ms evidence-sweep finish before the screenshot
      await shot('03-source')
    })

    await step('INSUFFICIENT_EVIDENCE for an off-topic question is KOPUK, not an error', async () => {
      await page.getByLabel('Materyallerine bir soru sor').fill('Fotosentez sırasında kloroplastta hangi pigment ışığı soğurur?')
      await page.getByRole('button', { name: 'Soruyu gönder' }).click()
      await waitFor('second answer', async () => (await page.locator('[data-turn]').count()) === 2 && (await page.locator('[data-turn="t2"] [data-knot], [data-turn="t2"] [role="alert"]').count()) > 0, 60_000)
      const t2 = page.locator('[data-turn="t2"]')
      check(await t2.locator('[role="alert"]').count() === 0, 'off-topic question must not be a service error')
      console.log(`    off-topic label: ${await t2.locator('[data-knot]').first().getAttribute('data-knot')}`)
    })

    await step('delete (two-step) removes the document', async () => {
      await page.goto(`${web}/${courseHash}`)
      await page.reload()
      await page.getByRole('button', { name: 'scanned.pdf sil' }).click()
      await page.getByRole('button', { name: 'Sil', exact: true }).click()
      await waitFor('row removed', async () => (await page.locator('[data-material]').filter({ hasText: 'scanned.pdf' }).count()) === 0, 15_000)
    })

    await step('expired/invalid session returns to login with a notice', async () => {
      await page.evaluate(() => {
        const s = JSON.parse(sessionStorage.getItem('knot.session'))
        sessionStorage.setItem('knot.session', JSON.stringify({ ...s, token: 'invalid.jwt.token' }))
      })
      await page.reload()
      await page.getByText('Oturumun sona erdi. Lütfen yeniden giriş yap.').waitFor()
    })

    await step('unauthorized: another student cannot see the course or document', async () => {
      await page.getByLabel('E-posta').fill('mehmet@knot.local')
      await page.getByLabel('Parola').fill(PASSWORD)
      await page.getByRole('button', { name: 'Giriş yap' }).click()
      await page.getByRole('button', { name: 'Çıkış yap' }).waitFor()
      await page.goto(`${web}/${courseHash}`)
      await page.getByText(/bulunamadı/).first().waitFor()
      const status = await page.evaluate(async (id) => {
        const { token } = JSON.parse(sessionStorage.getItem('knot.session'))
        return (await fetch(`/api/documents/${id}/pages/4?indexing_version=c1`, { headers: { Authorization: `Bearer ${token}` } })).status
      }, docId)
      check(status === 404, `cross-user page fetch returned ${status}, expected 404`)
    })

    await step('LOGOUT clears the session', async () => {
      await page.getByRole('button', { name: 'Çıkış yap' }).click()
      await page.getByLabel('E-posta').waitFor()
      check(await page.evaluate(() => sessionStorage.getItem('knot.session')) === null, 'session not cleared')
    })

    await step('browser never calls NestJS or the ai-service directly (only the /api proxy)', async () => {
      const hosts = [...browserHosts]
      check(!hosts.includes(new URL(ai).host) && !hosts.includes(new URL(apiUrl).host), `direct backend calls: ${hosts.join(', ')}`)
      console.log(`    hosts: ${hosts.join(', ')}`)
    })
  } finally {
    await shot('99-last').catch(() => {})
    await browser.close()
  }
}

const stopAll = () => { for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM') }
main()
  .then(() => { console.log(`\nE2E passed: ${results.length}/${results.length} steps. Screenshots/logs: ${work}`) })
  .catch((e) => { console.error(`\nE2E FAILED: ${e.message}\nlogs: ${work}`); process.exitCode = 1 })
  .finally(stopAll)
