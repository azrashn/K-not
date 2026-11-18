/**
 * Real stack for browser end-to-end tests of the CURRENT product:
 *   Chromium → vite preview (/api proxy) → NestJS → MySQL, NestJS → [model boundary] → Python ai-service.
 * Ingestion, extraction and retrieval are the real ai-service (hashing embeddings, no model download).
 * Only the question/summary WRITER is scripted: a small proxy answers /knowledge/quiz and
 * /knowledge/summary deterministically from the evidence it receives and forwards everything else.
 * Needs an EMPTY dedicated MySQL 8 database (E2E_DATABASE_URL); it never resets existing data.
 */
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const BACKEND = path.join(ROOT, 'backend')
const AI = path.join(ROOT, 'ai-service')
export const PASSWORD = 'e2e-password-123'
const RAG_TOKEN = 'e2e-rag-internal-token'
const CALLBACK_TOKEN = 'e2e-ingest-callback-token'
const COLLECTION = 'knot_e2e_hashing'

const freePort = () => new Promise((resolve) => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

export async function waitFor(what, fn, ms = 120_000) {
  const until = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

/** Deterministic writer used in place of the local language model. Never invents a source. */
export function scriptedQuiz(body) {
  const ev = body.evidence?.[0]
  const text = ev?.text ?? ''
  const quote = text.slice(0, Math.min(text.length, 160)).trim()
  const kind = body.kind
  const options = kind === 'MULTIPLE_CHOICE' ? ['Yığın', 'Kuyruk', 'Ağaç', 'Küme'] : kind === 'TRUE_FALSE' ? ['Doğru', 'Yanlış'] : []
  return {
    kind,
    question: `${body.question} konusunda kaynağa göre doğru ifade hangisidir? (${kind})`,
    options,
    expected: kind === 'MULTIPLE_CHOICE' ? '1' : kind === 'TRUE_FALSE' ? '0' : kind === 'OPEN' ? '' : quote.split(/\s+/).slice(0, 2).join(' '),
    explanation: 'Kaynak metin bu ifadeyi doğrudan destekler.',
    objective: 'Kaynaktaki kavramı tanımak.',
    quote,
    source_index: 1,
    quality: { structural_validation: true, independent_model_review: true, option_audit_version: 2 },
  }
}

// v2 question stems differ per kind, so the backend's repeat check (quiz-repeat.ts) does not take two
// questions of one exam for copies. Every stem keeps "konusunda" and the kind tag the exam test reads.
const V2_STEM = {
  MULTIPLE_CHOICE: (t) => `${t} konusunda kaynağa göre doğru seçenek hangisidir? (MULTIPLE_CHOICE)`,
  TRUE_FALSE: (t) => `${t} konusunda kaynaktaki ifade doğru mudur? (TRUE_FALSE)`,
  SHORT_ANSWER: (t) => `${t} konusunda verilen değerle sonucu hesaplayınız. (SHORT_ANSWER)`,
  OPEN: (t) => `${t} konusundaki süreci kendi cümlelerinle açıklayınız. (OPEN)`,
}

/** The same deterministic writer for the v2 engine contract (ai-service quiz_engine.py):
 *  { questions: [...], failures: [...] } for the requested items. A topic named "Nothing" fails every
 *  item with a reason code, as a real model whose answer has no ground in the source would. */
export function scriptedQuizV2(body) {
  const items = body.items ?? []
  if (String(body.topic).includes('Nothing'))
    return { engine: 'v2', pipeline_version: 'single-call-v1', questions: [], timing: {},
      failures: items.map((it, slot) => ({ slot, kind: it.kind, variant: it.variant ?? null, code: 'ANSWER_NOT_IN_SOURCE', detail: 'scripted', attempts: 2, seconds: 0 })) }
  const text = body.evidence?.[0]?.text ?? ''
  const quote = text.slice(0, Math.min(text.length, 160)).trim()
  const firstWords = quote.split(/\s+/).slice(0, 2).join(' ')
  const questions = items.map((it, slot) => {
    const kind = it.kind
    const cloze = kind === 'CLOZE'
    return {
      slot, kind, ...(it.variant ? { variant: it.variant } : {}),
      question: cloze ? `Kaynakta kullanılan kavramla tamamla:\n_____ ${quote.split(/\s+/).slice(1).join(' ')}` : V2_STEM[kind](body.topic),
      options: kind === 'MULTIPLE_CHOICE' ? ['Yığın', 'Kuyruk', 'Ağaç', 'Küme'] : kind === 'TRUE_FALSE' ? ['Doğru', 'Yanlış'] : [],
      expected: kind === 'MULTIPLE_CHOICE' ? '1' : kind === 'TRUE_FALSE' ? '0' : kind === 'OPEN' ? ''
        : it.variant === 'CALCULATION' ? '42' : cloze ? quote.split(/\s+/)[0] : firstWords,
      quote, source_index: 1,
      explanation: 'Kaynak metin bu ifadeyi doğrudan destekler.', objective: null, option_feedback: [],
      experimental: true, llm_used: true, question_style: cloze ? 'SOURCE_COMPLETION' : 'CONCEPTUAL',
      assessment: kind === 'OPEN' ? 'REFLECTION_NOT_AUTOGRADED' : 'SOURCE_CHECKED_UNVERIFIED',
      quality: { pipeline_version: 'single-call-v1', structural_validation: true, deterministic_validation: true,
        independent_model_review: false, truth_verified: false, attempts: 1, feedback_mode: 'SOURCE_EXPLANATION' },
      note: 'Senaryolu yazıcı (e2e).',
    }
  })
  return { engine: 'v2', pipeline_version: 'single-call-v1', questions, failures: [], timing: {} }
}

export const QUIZ_ENGINES = ['v2', 'legacy']

export function scriptedSummary(body) {
  const sources = body.evidence ?? []
  const items = sources.slice(0, 3).map((s, i) => {
    const quote = s.text.slice(0, Math.min(s.text.length, 70)).trim()
    return body.focus === 'concepts'
      ? { term: `Kavram ${i + 1}`, explanation: 'Kaynaktaki ifadeyle açıklanır.', quote, source_index: i + 1 }
      : { text: `Özet maddesi ${i + 1}: kaynağın başlangıcı.`, quote, source_index: i + 1 }
  })
  return { focus: body.focus, items, dropped: 0, quality: { quote_verified: true, model_generated: true } }
}

/** quizEngine: the backend's QUIZ_ENGINE ("v2" default, or "legacy"); also read from E2E_QUIZ_ENGINE.
 *  The scripted writer answers both request shapes, so either engine runs end to end. */
export async function startStack({ dbUrl, python, logs = true, quizEngine } = {}) {
  const QUIZ_ENGINE = quizEngine ?? process.env.E2E_QUIZ_ENGINE ?? 'v2'
  if (!QUIZ_ENGINES.includes(QUIZ_ENGINE)) throw new Error(`quiz engine must be one of ${QUIZ_ENGINES.join(', ')}: ${QUIZ_ENGINE}`)
  const DB = dbUrl ?? process.env.E2E_DATABASE_URL ?? 'mysql://knot:knot-dev-password@127.0.0.1:3306/knot_e2e'
  const PYTHON = python ?? process.env.PYTHON ?? 'python3'
  const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  const work = mkdtempSync(path.join(tmpdir(), 'knot-e2e-'))
  const storage = path.join(work, 'storage')
  mkdirSync(storage)
  const procs = []
  const start = (name, cmd, args, opts) => {
    const out = openSync(path.join(work, `${name}.log`), 'w')
    const p = spawn(cmd, args, { stdio: ['ignore', out, out], ...opts })
    procs.push(p)
    return p
  }
  const run = (cmd, args, opts) => {
    const r = spawnSync(cmd, args, { stdio: logs ? 'ignore' : 'inherit', ...opts })
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`)
  }
  const [aiPort, apiPort, webPort, proxyPort] = [await freePort(), await freePort(), await freePort(), await freePort()]
  const ai = `http://127.0.0.1:${aiPort}`
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const web = `http://127.0.0.1:${webPort}`

  const dbEnv = { ...process.env, DATABASE_URL: DB }
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: BACKEND, env: dbEnv })
  const conn = await createRequire(path.join(BACKEND, 'package.json'))('mariadb').createConnection(DB.replace(/^mysql:/, 'mariadb:'))
  const [{ n }] = await conn.query('SELECT COUNT(*) AS n FROM User')
  await conn.end()
  if (Number(n) > 0) throw new Error('E2E_DATABASE_URL must point at an empty, dedicated database (users found)')
  const seedFile = path.join(work, 'seed.json')
  writeFileSync(seedFile, JSON.stringify({
    users: [
      { email: 'ayse@knot.local', display_name: 'Ayşe Yılmaz', password: PASSWORD },
      { email: 'mehmet@knot.local', display_name: 'Mehmet Demir', password: PASSWORD },
    ],
    courses: [
      { code: 'BIL 211', name: 'Veri Yapıları', term: 'Güz 2026', instructor_name: 'Doç. Dr. M. Aydın', members: [{ email: 'ayse@knot.local', role: 'STUDENT' }, { email: 'mehmet@knot.local', role: 'STUDENT' }] },
    ],
    index_version: {
      collection: COLLECTION, chunker_version: 'c1',
      embedding: { backend: 'hashing', model: 'knot-hashing-v1', revision: null, dimension: 512, query_prefix: '', document_prefix: '', normalize: true, distance: 'cosine' },
    },
  }))
  run(process.execPath, ['node_modules/ts-node/dist/bin.js', 'scripts/seed.ts', seedFile], { cwd: BACKEND, env: dbEnv })

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

  // Model boundary: scripted writer for quiz/summary, everything else goes to the real ai-service.
  const calls = { quiz: [], summary: [], examText: [] }
  const proxy = http.createServer(async (req, res) => {
    const raw = await readBody(req)
    const url = req.url ?? ''
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    try {
      if (req.method === 'POST' && url === '/api/v1/knowledge/quiz') {
        const body = JSON.parse(raw.toString('utf8'))
        calls.quiz.push(body)
        // Same dispatch as the ai-service route: a body with "items" is the v2 engine.
        if (Array.isArray(body.items)) return json(200, scriptedQuizV2(body))
        if (String(body.question).includes('Nothing')) return json(422, { detail: { code: 'QUIZ_TOPIC_NOT_FOUND' } })
        return json(200, scriptedQuiz(body))
      }
      if (req.method === 'POST' && url === '/api/v1/knowledge/summary') {
        const body = JSON.parse(raw.toString('utf8'))
        calls.summary.push(body)
        return json(200, scriptedSummary(body))
      }
      if (url === '/api/v1/knowledge/exam-text') calls.examText.push({ at: Date.now() })
      const upstream = await fetch(ai + url, { method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k))), body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw })
      const buf = Buffer.from(await upstream.arrayBuffer())
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
      res.end(buf)
    } catch (e) {
      json(502, { error: String(e) })
    }
  })
  await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r))

  start('backend', 'node', ['dist/main.js'], {
    cwd: BACKEND,
    env: {
      ...process.env, DATABASE_URL: DB, PORT: String(apiPort), JWT_SECRET: 'e2e-jwt-secret-at-least-32-characters-long',
      STORAGE_ROOT: storage, AI_SERVICE_URL: `http://127.0.0.1:${proxyPort}`, RAG_INTERNAL_API_TOKEN: RAG_TOKEN, INGEST_CALLBACK_TOKEN: CALLBACK_TOKEN,
      SCHEDULER_ENABLED: 'true', LOG_LEVEL: 'warn',
      QUIZ_ENGINE,
    },
  })
  await waitFor('backend', async () => (await fetch(`${apiUrl}/courses`)).status === 401)
  start('web', process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], {
    cwd: ROOT, env: { ...process.env, VITE_API_PROXY_TARGET: apiUrl },
  })
  await waitFor('vite preview', async () => (await fetch(web)).ok)

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {})
  const stop = async () => {
    await browser.close().catch(() => undefined)
    proxy.close()
    for (const p of procs) p.kill('SIGTERM')
  }
  return { web, apiUrl, ai, work, browser, calls, stop, quizEngine: QUIZ_ENGINE }
}
