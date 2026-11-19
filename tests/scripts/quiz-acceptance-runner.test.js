import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/quiz-acceptance.mjs')
const DOC = { material_id: 'file_java', kind: 'TXT' }
const VIDEO = { material_id: 'video_java', kind: 'VIDEO' }

/** A fake backend: the routes the script calls, answering a finished exam and a finished set. */
function fakeBackend({ examSource = DOC, setRequested = 3 } = {}) {
  const seen = []
  const questions = [
    { id: 'e1', kind: 'OPEN', question: 'Kalıtımın amacını açıklayınız.', available: true, source: examSource },
    { id: 'e2', kind: 'MULTIPLE_CHOICE', question: 'Bytecode hangi ortamda çalışır?', available: true, source: DOC },
  ]
  const routes = {
    'POST /auth/login': [200, { access_token: 'secret-token', token_type: 'Bearer' }],
    'GET /courses/c1/knowledge/materials': [200, { materials: [{ id: 'file_java', kind: 'TXT', status: 'READY' }, { id: 'video_java', kind: 'VIDEO', status: 'READY' }] }],
    'GET /courses/c1/exam-styles': [200, [{ id: 's1' }]],
    'POST /courses/c1/exams': [202, { id: 'x1', status: 'GENERATING', requested: 2, produced: 0 }],
    'GET /courses/c1/exams/x1': [200, { id: 'x1', status: 'READY', requested: 2, produced: 2, note: null, questions }],
    'GET /courses/c1/exams/x1/key': [200, { key: [{ available: true, quote: 'Kalıtım devralmayı sağlar.' }, { available: true, quote: 'Bytecode JVM üzerinde çalışır.' }] }],
    'GET /courses/c1/quiz-topics': [200, { topics: ['Kapsülleme'] }],
    'POST /courses/c1/quizzes': [202, { id: 'set1', type: 'quiz_set', status: 'GENERATING', requested: setRequested, produced: 0, note: null }],
    'GET /courses/c1/quiz-sets/set1': [200, { id: 'set1', type: 'quiz_set', status: 'READY', requested: setRequested, produced: setRequested, note: null,
      questions: [{ id: 'q1', kind: 'TRUE_FALSE', question: 'Kapsülleme veriyi gizler mi?', available: true, source: DOC }] }],
  }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ route: `${req.method} ${req.url}`, auth: req.headers.authorization ?? null, body: body ? JSON.parse(body) : null })
      const [status, data] = routes[`${req.method} ${req.url}`] ?? [404, { error: { message: 'yok' } }]
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })))
}

function run(url, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, KNOT_API_URL: url, KNOT_EMAIL: 'ogrenci@example.com', KNOT_PASSWORD: 'parola-123', KNOT_COURSE_ID: 'c1',
        KNOT_EXAM_COUNT: '2', KNOT_QUIZ_COUNT: '3', ...extra },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('close', (code) => resolve({ code, out }))
  })
}

let backend
afterEach(() => backend?.server.close())

test('a run that meets all five criteria passes with exit code 0, and never prints the password or token', async () => {
  backend = await fakeBackend()
  const { code, out } = await run(backend.url)
  expect(out).toContain('Sonuç: GEÇTİ')
  expect(code).toBe(0)
  expect(out).not.toContain('parola-123')
  expect(out).not.toContain('secret-token')
  const post = (route) => backend.seen.find((s) => s.route === route)
  expect(post('POST /courses/c1/exams').body).toEqual({ exam_style_ids: ['s1'], count: 2 })
  expect(post('POST /courses/c1/quizzes').body).toEqual({ topic: 'Kapsülleme', kind: 'MIXED', count: 3 })
  expect(post('GET /courses/c1/exams/x1').auth).toBe('Bearer secret-token')
})

test('a question from the transcript while notes exist fails the run with exit code 1', async () => {
  backend = await fakeBackend({ examSource: VIDEO })
  const { code, out } = await run(backend.url)
  expect(out).toContain('KALDI   1. Belge varken transkriptten soru yok')
  expect(code).toBe(1)
})

test('a smaller set without a reason fails criterion 5', async () => {
  backend = await fakeBackend({ setRequested: 2 })
  const { code, out } = await run(backend.url)
  expect(out).toContain('KALDI   5.')
  expect(code).toBe(1)
})
