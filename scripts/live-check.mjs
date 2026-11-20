#!/usr/bin/env node
// Canlı kontrol: çalışan K-not yığınına (backend + ai-service + Ollama) karşı uçtan uca deneme yapar
// ve sonucu bir JSON raporuna yazar. Kaynak seçimi, kaynak kontrolü, "örnek göster" ve her alıştırma
// türü denenir. Rapor, plan issue'larının (#51–#63) kabul ölçütlerini ölçmek içindir.
//
// Kullanım (Node 18+):
//   node scripts/live-check.mjs ders1.pdf [ders2.pdf ...]
// Ortam değişkenleri:
//   API_URL=http://localhost:3000  EMAIL=ayse@knot.local  PASSWORD=knot123456  RUNS=3
//   ACTIVE=1   ilk PDF açıkmış gibi (active_material_id) sorar
//   QUESTIONS="transport layer nedir?|TCP ile UDP farkı nedir?"   '|' ile ayrılmış sorular
// Rapor: live-check-report.json (aynı klasörde değil, çalıştırdığın yerde)

import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

const API = (process.env.API_URL || 'http://localhost:3000').replace(/\/$/, '')
const EMAIL = process.env.EMAIL || 'ayse@knot.local'
const PASSWORD = process.env.PASSWORD || 'knot123456'
const RUNS = Number(process.env.RUNS || 3)
const ACTIVE = process.env.ACTIVE === '1'
const QUESTIONS = (process.env.QUESTIONS || 'transport layer nedir?|TCP ile UDP arasındaki fark nedir?|Bir örnek göster').split('|')
const KINDS = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'CLOZE', 'SHORT_ANSWER', 'OPEN']
const files = process.argv.slice(2)
if (!files.length) {
  console.error('Kullanım: node scripts/live-check.mjs ders1.pdf [ders2.pdf ...]')
  process.exit(2)
}

let token = ''
async function call(method, path, { body, form } = {}) {
  const started = Date.now()
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(API + path, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) })
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { data = text }
    return { ok: res.ok, status: res.status, ms: Date.now() - started, data }
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, data: { error: String(e) } }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)

const report = { api: API, startedAt: new Date().toISOString(), files: files.map((f) => basename(f)), uploads: [], answers: [], quizzes: [], summary: {} }

// 1) giriş ve ders
const login = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } })
if (!login.ok) { console.error('Giriş başarısız:', login.status, JSON.stringify(login.data)); process.exit(1) }
token = login.data.access_token
const course = await call('POST', '/courses', { body: { name: `Canlı kontrol ${new Date().toISOString().slice(0, 16)}`, description: '', category: '' } })
if (!course.ok) { console.error('Ders açılamadı:', course.status, JSON.stringify(course.data)); process.exit(1) }
const courseId = course.data.id
report.courseId = courseId
log('Ders:', courseId)

// 2) yükleme
for (const path of files) {
  const form = new FormData()
  form.append('document_type', 'notes')
  form.append('file', new Blob([await readFile(path)], { type: 'application/pdf' }), basename(path))
  const up = await call('POST', `/courses/${courseId}/documents`, { form })
  report.uploads.push({ file: basename(path), status: up.status, ok: up.ok, error: up.ok ? undefined : up.data })
  log('Yüklendi:', basename(path), up.status)
}

// 3) hazır olana kadar bekle
let materials = []
for (let i = 0; i < 60; i++) {
  const m = await call('GET', `/courses/${courseId}/knowledge/materials`)
  materials = m.data?.materials || []
  if (materials.length >= files.length && materials.every((x) => ['READY', 'FAILED'].includes(x.status))) break
  await sleep(3000)
}
report.materials = materials.map((m) => ({ id: m.id, title: m.title, status: m.status }))
const ready = materials.filter((m) => m.status === 'READY')
log('Hazır materyal:', ready.length, '/', files.length)
if (!ready.length) { await writeFile('live-check-report.json', JSON.stringify(report, null, 2)); console.error('Hazır materyal yok.'); process.exit(1) }
const first = ready[0]

// 4) sorular (her biri RUNS kez: kaynak listesi tutarlı mı?)
const cites = (d) => (d?.evidence || []).map((e) => `${e.title}#${e.location?.page ?? e.location?.start_ms ?? '?'}`)
for (const q of QUESTIONS) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    const body = { question: q, response_mode: 'default', ...(ACTIVE ? { active_material_id: first.id } : {}) }
    const r = await call('POST', `/courses/${courseId}/knowledge/answers`, { body })
    const d = r.data
    runs.push({
      status: r.status, ms: r.ms,
      error: r.ok ? undefined : d,
      llm_used: d?.llm_used, answer_status: d?.status,
      sources: cites(d), used: d?.retrieval?.used_source_ids?.length,
      claims: d?.support_summary ?? d?.claims?.map((c) => ({ text: c.text?.slice(0, 80), label: c.support?.label, reason: c.support?.reason })),
      answer_preview: typeof d?.answer === 'string' ? d.answer.slice(0, 400) : undefined,
    })
    log(`Soru "${q}" #${i + 1}: ${r.status} ${r.ms}ms kaynaklar=${cites(d).join(', ')}`)
  }
  const sig = new Set(runs.map((x) => x.sources.join('|')))
  report.answers.push({ question: q, active: ACTIVE, stableSources: sig.size === 1, runs })
}

// 5) örnek göster (görsel destek olmayan modelde 500 vermemeli)
const example = await call('POST', `/courses/${courseId}/knowledge/answers`, {
  body: { question: 'Bir örnek göster', response_mode: 'example', active_material_id: first.id },
})
report.example = { status: example.status, error: example.ok ? undefined : example.data, answer_preview: example.data?.answer?.slice?.(0, 300) }
log('Örnek göster:', example.status)

// 6) alıştırma: her tür için 3 deneme
for (const kind of KINDS) {
  const runs = []
  for (let i = 0; i < 3; i++) {
    const r = await call('POST', `/courses/${courseId}/quizzes`, {
      body: { topic: 'transport layer', kind, scope: { mode: 'selected', material_ids: ready.map((m) => m.id) }, watched_only: false },
    })
    const q = r.data
    runs.push({
      status: r.status, ms: r.ms, error: r.ok ? undefined : q?.error,
      returnedKind: q?.question?.kind ?? q?.kind ?? q?.questions?.[0]?.kind,
      prompt: (q?.question?.prompt ?? q?.questions?.[0]?.prompt ?? '').slice?.(0, 200),
    })
    log(`Alıştırma ${kind} #${i + 1}: ${r.status} ${r.ms}ms`)
  }
  report.quizzes.push({ kind, success: runs.filter((x) => x.status === 200 || x.status === 201).length, runs })
}

// 7) özet
report.summary = {
  sourcesStable: report.answers.map((a) => ({ question: a.question, stable: a.stableSources })),
  exampleOk: report.example.status === 200,
  quizSuccess: Object.fromEntries(report.quizzes.map((q) => [q.kind, `${q.success}/3`])),
  finishedAt: new Date().toISOString(),
}
await writeFile('live-check-report.json', JSON.stringify(report, null, 2))
log('\nÖzet:', JSON.stringify(report.summary, null, 2))
log('Rapor: live-check-report.json')
