#!/usr/bin/env node
/**
 * Browser end-to-end for the exam flow on the real stack (see lib/stack.mjs):
 * past exam (DOCX) → saved style → new exam from course sources → answer key → print/PDF →
 * solve a question → practice history → material summary.
 *
 *   npm run build && (cd backend && npm run build) && npm run test:e2e:exam
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PASSWORD, startStack } from './lib/stack.mjs'
import { makeDocx } from './lib/docx.mjs'
import { scan } from './lib/a11y.mjs'

const results = []
const check = (cond, msg) => { if (!cond) throw new Error(msg) }
async function step(name, fn) {
  const t = Date.now()
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name} (${Date.now() - t} ms)`) }
  catch (e) { results.push({ name, ok: false }); console.log(`  ✗ ${name}\n    ${String(e.message).split('\n')[0]}`); throw e }
}

const NOTES = [
  'Genişlik öncelikli arama (BFS) bir kuyruk kullanır ve düğümleri seviye seviye ziyaret eder.',
  'Derinlik öncelikli arama (DFS) bir yığın kullanır ve bir dalın sonuna kadar iner.',
  'Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışmaz; ağırlıklar eksi olmamalıdır.',
].join('\n\n')

const PAST_EXAM = [
  '1. Aşağıdaki veri yapılarından hangisi ilk giren ilk çıkar çalışır?',
  'A) Yığın',
  'B) Kuyruk',
  'C) Ağaç',
  '2. BFS algoritmasının kullandığı veri yapısını açıklayınız.',
  '3. Dijkstra negatif kenar ağırlıklarıyla doğru çalışır mı? Doğru veya yanlış yazınız.',
  '4. DFS ile BFS arasındaki farkı hesaplayınız ve açıklayınız.',
]

async function main() {
  const stack = await startStack({ python: process.env.PYTHON })
  const { web, browser, calls, work } = stack
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints += 1 } })
  const shot = (n) => page.screenshot({ path: path.join(work, `${n}.png`), fullPage: true })
  const apiJson = (url, init) => page.evaluate(async ([u, i]) => {
    const { token } = JSON.parse(sessionStorage.getItem('knot.session'))
    const r = await fetch('/api' + u, { ...i, headers: { Authorization: `Bearer ${token}`, ...(i?.headers || {}) } })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [url, init])
  let courseId = ''
  try {
    await page.goto(web)
    await step('login as a seeded student', async () => {
      await page.getByLabel('E-posta').fill('ayse@knot.local')
      await page.getByLabel('Parola').fill(PASSWORD)
      await page.getByRole('button', { name: 'Giriş yap' }).click()
      await page.getByRole('button', { name: 'Çıkış yap' }).waitFor()
    })

    await step('course and a course material (text notes) exist', async () => {
      const list = await apiJson('/courses')
      check(list.status === 200, `GET /courses → ${list.status}`)
      courseId = (list.body.courses ?? list.body)[0].id
      const up = await page.evaluate(async ([id, notes]) => {
        const { token } = JSON.parse(sessionStorage.getItem('knot.session'))
        const form = new FormData()
        form.append('file', new File([notes], 'graf-notlari.txt', { type: 'text/plain' }))
        const r = await fetch(`/api/courses/${id}/knowledge/materials`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
        return { status: r.status, body: await r.json().catch(() => null) }
      }, [courseId, NOTES])
      check([200, 201].includes(up.status), `material upload → ${up.status} ${JSON.stringify(up.body)}`)
    })

    await step('exams have their own menu entry, separate from Quiz', async () => {
      await page.goto(`${web}/#/quiz`)
      check(!(await page.getByRole('button', { name: 'Sınav hazırla →' }).count()), 'the quiz page must not hold the exam builder any more')
      await page.getByRole('button', { name: 'Sınav', exact: true }).first().click()
      await page.getByRole('heading', { name: 'Sınavlar' }).first().waitFor()
      await page.waitForURL((u) => u.hash === `#/dersler/${courseId}/sinavlar`, { timeout: 10000 })
    })

    await step('a past exam (DOCX) becomes a saved style', async () => {
      await page.getByLabel('Sınav adı').fill('Final 2025')
      await page.getByLabel('Sınav dosyası').setInputFiles({ name: 'final-2025.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: makeDocx(PAST_EXAM) })
      await page.getByRole('button', { name: 'Dosyayı oku' }).click()
      await page.getByText('4 soru', { exact: false }).first().waitFor()
      await shot('01-style')
      check(calls.examText.length === 1, 'the real ai-service must have read the file')
    })

    await step('an unreadable file is refused with a clear message', async () => {
      await page.getByLabel('Sınav dosyası').setInputFiles({ name: 'bos.txt', mimeType: 'text/plain', buffer: Buffer.from('kısa') })
      await page.getByRole('button', { name: 'Dosyayı oku' }).click()
      await page.getByRole('alert').waitFor()
      const msg = await page.getByRole('alert').innerText()
      check(/okunamadı|numaralandırılmış|metin/i.test(msg), `unexpected message: ${msg}`)
    })

    let examId = ''
    await step('a new exam is prepared from the course sources, with progress', async () => {
      await page.getByLabel('Soru sayısı').fill('4')
      await page.getByLabel('Konular').fill('BFS\nDFS\nDijkstra')
      const created = page.waitForResponse((r) => r.url().endsWith(`/courses/${courseId}/exams`) && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'Sınavı hazırla' }).click()
      examId = (await (await created).json()).id
      await page.getByRole('status').filter({ hasText: /Hazır · 4\/4 soru/ }).waitFor({ timeout: 120_000 })
      await shot('02-exam')
      const questions = await page.locator('.exam-questions > li').count()
      check(questions === 4, `expected 4 questions, saw ${questions}`)
    })

    await step('every question was written from a real course source with the exam style', async () => {
      check(calls.quiz.length === 4, `model boundary saw ${calls.quiz.length} requests`)
      for (const c of calls.quiz) {
        check(c.style_hint?.includes('Sınav stili'), 'style hint missing')
        check(/Genişlik|Derinlik|Dijkstra/.test(c.evidence[0].text), `evidence is not from the notes: ${c.evidence[0].text.slice(0, 60)}`)
      }
      const kinds = calls.quiz.map((c) => c.kind).sort()
      check(kinds.join() === 'MULTIPLE_CHOICE,OPEN,SHORT_ANSWER,TRUE_FALSE', `kinds follow the past exam: ${kinds}`)
    })

    await step('the exam hides answers from the student view', async () => {
      const res = await apiJson(`/courses/${courseId}/exams/${examId}`)
      check(res.status === 200 && res.body.questions.length === 4, 'exam read failed')
      const raw = JSON.stringify(res.body)
      check(!raw.includes('"expected"') && !raw.includes('"quote"') && !raw.includes('"explanation"'), 'answers leaked in the exam payload')
    })

    await step('answer key prints on request and opens the print dialog', async () => {
      await page.getByRole('button', { name: 'Cevap anahtarıyla yazdır' }).click()
      await page.getByLabel('Cevap anahtarı').waitFor()
      const text = await page.getByLabel('Cevap anahtarı').innerText()
      check(/Kuyruk/.test(text), `key lacks the multiple-choice answer: ${text}`)
      await page.waitForFunction(() => window.__prints === 1, null, { timeout: 5000 })
    })

    await step('a real PDF of the exam is produced, with the key and without the page controls', async () => {
      const pdf = path.join(work, 'exam.pdf')
      await page.pdf({ path: pdf, format: 'A4' })
      const bytes = readFileSync(pdf)
      check(bytes.subarray(0, 5).toString() === '%PDF-', 'PDF was not produced')
      // The PDF itself must contain the exam: read its text back.
      const py = spawnSync(process.env.PYTHON || 'python3', ['-I', '-c', 'import sys;from pypdf import PdfReader;print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', pdf], { encoding: 'utf8' })
      const pdfText = py.stdout || ''
      // pypdf splits Turkish diacritics from their letters, so match ASCII-only parts of each line.
      check(/Final 2025/.test(pdfText) && (pdfText.match(/konusunda/g) || []).length >= 4 && /hangisidir/.test(pdfText), `PDF text lacks the exam: "${pdfText.slice(0, 160)}" ${py.stderr.slice(-200)}`)
      check(/Kuyruk/.test(pdfText) && /\(OPEN\)/.test(pdfText) && /\(MULTIPLE_CHOICE\)/.test(pdfText), 'PDF must contain every question')
      check(/Cevap anahtarı/.test(pdfText) && /Kuyruk/.test(pdfText), 'PDF must contain the answer key that was requested')
      check(!/Sınav hazırla|Dosyayı oku|Bu soruyu çöz|Çıkış yap|Ana Sayfa/.test(pdfText), 'PDF must not contain page controls')
      check(await page.locator('.exam-print-root').count() === 0, 'the print copy must be removed after printing')
    })

    await step('a question can be solved and answered, with feedback', async () => {
      await page.getByRole('button', { name: 'Bu soruyu çöz' }).first().click()
      await page.getByRole('heading', { name: 'Alıştırmalar', exact: true }).waitFor()
      await page.locator('.quiz-question').waitFor()
      await shot('03-solve')
      // The exam interleaves kinds; answer whichever kind came first.
      const option = page.locator('.quiz-question input[type=radio]').first()
      if (await option.count()) await option.check()
      else await page.locator('.quiz-question textarea, .quiz-question input[type=text]').first().fill('Kuyruk kullanılır ve seviye seviye gezilir.')
      await page.getByRole('button', { name: 'Yanıtı değerlendir' }).click()
      await page.locator('.quiz-question').getByText(/kaydedildi|Kaynağı aç|kaynak/i).first().waitFor({ timeout: 30_000 })
      await shot('04-feedback')
    })

    await step('practice history separates answered from waiting questions', async () => {
      await page.getByText(/soru ·/).first().waitFor()
      const summary = await page.getByText(/soru ·.*yanıt bekliyor/).first().innerText()
      check(/yanıtlandı/.test(summary), `summary: ${summary}`)
      await page.getByRole('button', { name: 'Yanıt bekleyen' }).click()
      const rows = await page.locator('.resume-row').filter({ hasText: 'Yanıt bekliyor' }).count()
      check(rows >= 1, 'unanswered questions must be listed')
    })

    await step('an exam topic with no source is reported, never invented', async () => {
      await page.goto(`${web}/#/dersler/${courseId}/sinavlar`)
      await page.getByLabel('Sınav stili').selectOption({ index: 1 })
      await page.getByLabel('Soru sayısı').fill('2')
      await page.getByLabel('Konular').fill('Nothing')
      await page.getByRole('button', { name: 'Sınavı hazırla' }).click()
      await page.getByRole('status').filter({ hasText: /Hazırlanamadı/ }).waitFor({ timeout: 60_000 })
      await page.getByText(/kaynaklara dayalı soru hazırlanamadı/).waitFor()
      await shot('05-failed')
    })

    await step('material summary shows verified quotes from the source', async () => {
      await page.goto(`${web}/#/dersler/${courseId}/ogrenme`)
      await page.getByRole('button', { name: /graf-notlari/ }).first().click()
      await page.getByRole('tab', { name: 'Özet' }).click() // the workspace keeps the summary behind its own tab
      await page.getByRole('region', { name: 'Kaynaklı özet' }).waitFor()
      await page.getByRole('button', { name: 'Özet hazırla' }).click()
      await page.getByText(/Özet maddesi 1/).waitFor({ timeout: 30_000 })
      const quote = await page.locator('.material-summary blockquote').first().innerText()
      check(NOTES.includes(quote.replace(/[“”]/g, '').trim()), `quote is not verbatim from the notes: ${quote}`)
      await shot('06-summary')
    })

    await step('search inside the open material finds the section, highlights the match and opens it', async () => {
      await page.getByRole('tab', { name: /^Bölümler/ }).click() // search lives in the sections tab
      await page.getByLabel('Belge içinde ara', { exact: true }).fill('KUYRUK')
      await page.getByRole('button', { name: 'Ara', exact: true }).click()
      await page.getByText(/bölümde bulundu/).waitFor()
      const mark = await page.locator('.material-find-hits mark').first().innerText()
      check(mark.toLowerCase() === 'kuyruk', `highlighted "${mark}"`)
      await page.locator('.material-find-hits button').first().click()
      await page.getByText('Genişlik öncelikli arama (BFS) bir kuyruk kullanır').first().waitFor()
      await page.getByLabel('Belge içinde ara', { exact: true }).fill('yokboyle')
      await page.getByRole('button', { name: 'Ara', exact: true }).click()
      await page.getByText(/bu materyalde bulunamadı/).waitFor()
    })

    await step('upload hints show the limits the server enforces', async () => {
      const limits = await apiJson('/limits')
      check(limits.status === 200 && limits.body.study_file_bytes === 20 * 1024 * 1024, `limits: ${JSON.stringify(limits.body)}`)
      await page.getByText('+ Ekle', { exact: true }).click() // the upload area sits in a collapsible "+ Ekle"
      await page.getByText('PPTX ve TXT: 20 MB').waitFor()
    })

    await step('practice form: the main action is visible and reachable by keyboard at 1280×720', async () => {
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto(`${web}/#/dersler/${courseId}/quiz`)
      await page.getByLabel('Konu', { exact: true }).waitFor()
      await page.waitForTimeout(500)
      const box = await page.getByRole('button', { name: 'Alıştırma hazırla' }).boundingBox()
      check(box && box.y + box.height <= 720, `button bottom at ${box && box.y + box.height}px`)
      await page.getByLabel('Konu', { exact: true }).fill('BFS')
      await page.getByLabel('Soru türü').focus()
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
      check(focused === 'Alıştırma hazırla', `Tab from the kind selector reached "${focused}"`)
      await page.setViewportSize({ width: 1440, height: 900 })
    })

    // Automated accessibility scan of the main screens (serious and critical findings fail the run).
    const screens = [
      ['courses list', async () => { await page.goto(`${web}/#/dersler`); await page.getByText('Veri Yapıları', { exact: true }).first().waitFor() }],
      ['study screen, nothing open', async () => { await page.goto(`${web}/#/dersler/${courseId}/ogrenme`); await page.getByText('Buradan başla').waitFor() }],
      ['study screen with a material', async () => { await page.getByRole('button', { name: 'Birlikte öğren' }).click(); await page.getByRole('tab', { name: 'Özet' }).click(); await page.getByRole('region', { name: 'Kaynaklı özet' }).waitFor() }],
      ['practice page', async () => { await page.goto(`${web}/#/dersler/${courseId}/quiz`); await page.getByLabel('Konu', { exact: true }).waitFor() }],
      ['exam builder with an exam', async () => { await page.goto(`${web}/#/dersler/${courseId}/sinavlar`); await page.getByRole('button', { name: /yeni sınav/ }).first().click(); await page.locator('.exam-sheet').waitFor() }],
    ]
    for (const [name, open] of screens) {
      await step(`accessibility: ${name}`, async () => {
        await open()
        await page.waitForTimeout(900)
        await shot(`a11y-${name.replace(/[^a-z]+/gi, '-')}`)
        const found = await scan(page)
        if (found.length) throw new Error(found.map((f) => `${f.impact} ${f.id} ×${f.count}: ${f.help} → ${f.where.join(' | ')}${f.colors ? '\n      ' + f.colors.join('\n      ') : ''}`).join('\n    '))
      })
    }

    console.log(`\nEND-TO-END PASSED (${results.length} steps). Artifacts: ${work}`)
  } catch (e) {
    await page.screenshot({ path: path.join(work, 'failure.png'), fullPage: true }).catch(() => undefined)
    console.error(`artifacts (screenshots, service logs): ${work}`)
    throw e
  } finally {
    await stack.stop()
  }
}
main().catch((e) => { console.error(`\nEND-TO-END FAILED: ${e.message}`); process.exit(1) })
