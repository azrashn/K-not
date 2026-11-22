#!/usr/bin/env node
/**
 * Quiz/sınav kabul kontrolü: çalışan bir K-not'a (backend + ai-service + gerçek model) karşı bir sınav ve bir
 * alıştırma seti üretir, beş kabul ölçütünü denetler (scripts/lib/quiz-acceptance-checks.mjs) ve rapor yazar.
 * Tüm ölçütler geçerse çıkış kodu 0, değilse 1.
 *
 *   KNOT_EMAIL=... KNOT_PASSWORD=... KNOT_COURSE_ID=... node scripts/quiz-acceptance.mjs
 *
 * Ortam değişkenleri
 *   KNOT_API_URL          backend adresi (varsayılan http://localhost:3000)
 *   KNOT_EMAIL            giriş e-postası (zorunlu)
 *   KNOT_PASSWORD         parola (zorunlu; hiçbir yere yazılmaz)
 *   KNOT_COURSE_ID        denenecek ders (zorunlu)
 *   KNOT_EXAM_STYLE_IDS   kayıtlı geçmiş sınav id'leri, virgülle (ya da:)
 *   KNOT_PAST_EXAM_FILE   numaralı soruları olan bir .txt geçmiş sınav; stil olarak kaydedilir
 *   KNOT_EXAM_COUNT       sınavdaki soru sayısı (varsayılan 14, Azra'nın denemesi)
 *   KNOT_QUIZ_TOPIC       alıştırma konusu (varsayılan: GET /quiz-topics'in ilk önerisi)
 *   KNOT_QUIZ_COUNT       alıştırma setindeki soru sayısı (varsayılan 5)
 *   KNOT_TIMEOUT_MINUTES  bir üretimi bekleme sınırı (varsayılan 60)
 *   KNOT_REPORT_FILE      ayrıca JSON rapor yazılacak dosya (isteğe bağlı)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  allPassed, checkOpenQuestions, checkQuizCount, checkRepeats, checkSources, checkYield, formatReport,
} from './lib/quiz-acceptance-checks.mjs'

const env = process.env
const API = (env.KNOT_API_URL || 'http://localhost:3000').replace(/\/+$/, '')
const POLL_MS = 5000
const TIMEOUT_MS = Number(env.KNOT_TIMEOUT_MINUTES || 60) * 60_000

function need(name) {
  if (!env[name]) {
    console.error(`${name} gerekli. Kullanım için dosyanın başındaki açıklamaya bakın.`)
    process.exit(2)
  }
  return env[name]
}

let token = null
async function call(method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}
async function ok(method, route, body) {
  const r = await call(method, route, body)
  if (r.status >= 400) throw new Error(`${method} ${route} → HTTP ${r.status}: ${r.data?.error?.message ?? JSON.stringify(r.data).slice(0, 300)}`)
  return r
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitDone(route, label) {
  const started = Date.now()
  for (;;) {
    const { data } = await ok('GET', route)
    if (data.status !== 'GENERATING') return data
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`${label} ${TIMEOUT_MS / 60_000} dakikada bitmedi`)
    process.stdout.write(`  ${label}: ${data.produced}/${data.requested} hazır…\r`)
    await sleep(POLL_MS)
  }
}

async function main() {
  const email = need('KNOT_EMAIL')
  const password = need('KNOT_PASSWORD')
  const course = encodeURIComponent(need('KNOT_COURSE_ID'))
  const examCount = Number(env.KNOT_EXAM_COUNT || 14)
  const quizCount = Number(env.KNOT_QUIZ_COUNT || 5)
  const results = {}

  token = (await ok('POST', '/auth/login', { email, password })).data.access_token
  const materials = (await ok('GET', `/courses/${course}/knowledge/materials`)).data.materials ?? []
  console.log(`Ders: ${materials.length} materyal (${materials.filter((m) => m.kind !== 'VIDEO').length} belge)`)

  // ── exam ──
  let styleIds = (env.KNOT_EXAM_STYLE_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!styleIds.length && env.KNOT_PAST_EXAM_FILE) {
    const text = readFileSync(env.KNOT_PAST_EXAM_FILE, 'utf8')
    const name = path.basename(env.KNOT_PAST_EXAM_FILE).replace(/\.[^.]+$/, '')
    styleIds = [(await ok('POST', `/courses/${course}/exam-styles`, { name, text })).data.id]
  }
  if (!styleIds.length) styleIds = (await ok('GET', `/courses/${course}/exam-styles`)).data.slice(0, 1).map((s) => s.id)
  let examQuestions = []
  if (styleIds.length) {
    console.log(`Sınav: ${styleIds.length} geçmiş sınavdan ${examCount} soru isteniyor…`)
    const created = (await ok('POST', `/courses/${course}/exams`, { exam_style_ids: styleIds, count: examCount })).data
    const exam = await waitDone(`/courses/${course}/exams/${created.id}`, 'sınav')
    const key = (await ok('GET', `/courses/${course}/exams/${created.id}/key`)).data.key ?? []
    examQuestions = exam.questions.filter((q) => q.available)
    console.log(`\nSınav bitti: ${exam.status}, ${exam.produced}/${exam.requested}. Not: ${exam.note ?? '-'}`)
    results.repeats = checkRepeats({ questions: examQuestions, quotes: key.filter((k) => k.available).map((k) => k.quote) })
    results.yield = checkYield({ asked: examCount, produced: exam.produced, note: exam.note })
  } else console.log('Geçmiş sınav yok: sınav ölçütleri (2, 3) atlandı. KNOT_PAST_EXAM_FILE verin.')

  // ── quiz set ──
  const topic = env.KNOT_QUIZ_TOPIC || (await ok('GET', `/courses/${course}/quiz-topics`)).data.topics?.[0]
  let setQuestions = []
  if (topic) {
    console.log(`Alıştırma: “${topic}” için ${quizCount} soru (Karışık) isteniyor…`)
    const started = await call('POST', `/courses/${course}/quizzes`, { topic, kind: 'MIXED', count: quizCount })
    if (started.status >= 400) throw new Error(`POST quizzes → HTTP ${started.status}: ${started.data?.error?.message}`)
    const finished = started.data?.id ? await waitDone(`/courses/${course}/quiz-sets/${started.data.id}`, 'alıştırma') : null
    setQuestions = (finished?.questions ?? []).filter((q) => q.available)
    console.log(`\nAlıştırma bitti: ${finished?.status}, ${finished?.produced}/${finished?.requested}. Not: ${finished?.note ?? '-'}`)
    results.count = checkQuizCount({ status: started.status, started: started.data, finished, asked: quizCount })
  } else console.log('Alıştırma konusu yok: ölçüt 5 atlandı. KNOT_QUIZ_TOPIC verin.')

  const all = [...examQuestions, ...setQuestions]
  if (all.length) {
    results.sources = checkSources({ questions: all, materials })
    results.open = checkOpenQuestions({ questions: all })
  }

  const report = formatReport(results)
  console.log(`\n${report}`)
  if (env.KNOT_REPORT_FILE) {
    writeFileSync(env.KNOT_REPORT_FILE, JSON.stringify({ api: API, examCount, quizCount, topic, results }, null, 2))
    console.log(`JSON rapor: ${env.KNOT_REPORT_FILE}`)
  }
  // exitCode, not exit(): exiting with fetch's open keep-alive sockets crashes Node on Windows (0xC0000409).
  process.exitCode = allPassed(results) ? 0 : 1
}

main().catch((e) => {
  console.error(`Kabul kontrolü çalışamadı: ${e.message}`)
  process.exitCode = 2
})
