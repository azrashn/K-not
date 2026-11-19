// The five acceptance criteria of the quiz/exam rewrite, as pure checks over what the public API returns.
// scripts/quiz-acceptance.mjs feeds them a real run; tests/scripts/quiz-acceptance.test.js feeds them fixtures.
//
// 1. With a document in the course, no question comes from a video's automatic transcript.
// 2. No repeated question in one exam: neither a near-identical stem nor the same source sentence.
// 3. At least 80% of the requested questions are made, or the note says why (capacity or a reason).
// 4. Open questions are real questions, and no stem leans on a sentence the student does not see.
// 5. A quiz's question count can be chosen: several questions start a set (202) of that size.

export const YIELD_MIN = 0.8

const fold = (s) => String(s ?? '').normalize('NFC').replace(/İ/g, 'i').replace(/I/g, 'ı').toLocaleLowerCase('tr').replace(/ı/g, 'i')
const isTranscript = (source) => source?.kind === 'VIDEO' || String(source?.material_id ?? '').startsWith('video_')
const isDocument = (m) => m.status === 'READY' && m.kind !== 'VIDEO' && !String(m.id).startsWith('video_')

/** 1. `questions` are public quizzes (with `source`); `materials` the course's materials. */
export function checkSources({ questions, materials }) {
  const hasDocument = (materials ?? []).some(isDocument)
  const fromTranscript = (questions ?? []).filter((q) => isTranscript(q.source))
  if (!hasDocument)
    return { pass: true, detail: `Derste belge yok; ${fromTranscript.length} soru transkriptten (uyarıyla) hazırlandı.` }
  return {
    pass: fromTranscript.length === 0,
    detail: fromTranscript.length
      ? `Belge varken ${fromTranscript.length} soru transkriptten geldi: ${fromTranscript.map((q) => q.id).join(', ')}`
      : `${(questions ?? []).length} sorunun hiçbiri transkriptten gelmedi.`,
  }
}

// A crude root: enough to see "sürecinde" and "sürecinin" as one word (the services use the full rule).
const STOP = new Set(['ve', 'ile', 'bir', 'bu', 'için', 'olan', 'olarak', 'gibi', 'the', 'and', 'of', 'is', 'are', 'to', 'in', 'ne', 'nedir', 'hangi'].map(fold))
const root = (w) => (w.length <= 3 || /^\d+$/.test(w) ? w : w.slice(0, Math.max(3, Math.min(5, w.length - 1))))
const stemRoots = (text) => [...new Set((fold(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(root))]

export function similarStems(a, b) {
  const x = stemRoots(a)
  const y = stemRoots(b)
  if (!x.length || !y.length) return false
  const shared = x.filter((r) => y.includes(r)).length
  return shared / Math.min(x.length, y.length) >= 0.7 || shared / (x.length + y.length - shared) >= 0.5
}

const quoteKey = (q) => fold(q).replace(/\s+/g, ' ').trim().replace(/[.!?;,]+$/, '')

/** 2. `questions` with `question`; `quotes` the source sentences (exam key), when known. */
export function checkRepeats({ questions, quotes = [] }) {
  const stems = (questions ?? []).map((q) => q.question).filter(Boolean)
  const pairs = []
  for (let i = 0; i < stems.length; i++)
    for (let j = i + 1; j < stems.length; j++) if (similarStems(stems[i], stems[j])) pairs.push([i + 1, j + 1])
  const seen = new Map()
  const sameQuote = []
  quotes.forEach((q, i) => {
    const key = quoteKey(q)
    if (!key) return
    if (seen.has(key)) sameQuote.push([seen.get(key) + 1, i + 1])
    else seen.set(key, i)
  })
  const problems = [
    ...pairs.map(([a, b]) => `${a}. ve ${b}. soru neredeyse aynı`),
    ...sameQuote.map(([a, b]) => `${a}. ve ${b}. soru aynı kaynak cümlesine dayanıyor`),
  ]
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `${stems.length} soru, ${quotes.length} kaynak cümlesi: tekrar yok.`,
  }
}

/** 3. `asked`: what the student asked for; `produced`; `note` of the exam or set. */
export function checkYield({ asked, produced, note }) {
  const ratio = asked ? produced / asked : 0
  const percent = Math.round(ratio * 100)
  if (ratio >= YIELD_MIN) return { pass: true, detail: `${asked} sorudan ${produced} tanesi hazırlandı (%${percent}).` }
  const explained = /yetiyor|neden:|ulaşılamadığı|yanıt vermediği/.test(note ?? '')
  return {
    pass: explained,
    detail: explained
      ? `${asked} sorudan ${produced} tanesi (%${percent}); not nedeni söylüyor: “${note}”`
      : `${asked} sorudan ${produced} tanesi (%${percent}) ve not nedeni söylemiyor${note ? `: “${note}”` : ''}.`,
  }
}

// The ai-service rules (quiz_checks.py): an open question ends with "?" or is an instruction, and no stem
// starts with a word that points back to a sentence the student never sees.
const DIRECTIVE = /(?<![\p{L}])(açıkla|yaz|karşılaştır|tartış|değerlendir|belirt|tanımla|örnekle|göster|yorumla|özetle|listele|sırala|explain|describe|compare|discuss|evaluate|define|summari[sz]e|list)/iu
const DANGLING = /^(bu|şu|o|bunlar|şunlar|onlar|bunun|onun|bunu|onu|buna|ona|bundan|ondan|burada|orada|böyle|daha\s+sonra|sonra|ardından|böylece|dolayısıyla|ayrıca|this|that|these|those|it|they|then|thus|therefore)(?=[\s,;:.!?]|$)/iu

/** 4. Every question with its `kind` and `question` (a cloze stem is written by the server). */
export function checkOpenQuestions({ questions }) {
  const problems = []
  ;(questions ?? []).forEach((q, i) => {
    const stem = String(q.question ?? '').trim()
    if (q.kind === 'OPEN' && !stem.endsWith('?') && !DIRECTIVE.test(stem)) problems.push(`${i + 1}. açık uçlu soru soru değil: “${stem.slice(0, 80)}”`)
    if (q.kind !== 'CLOZE' && DANGLING.test(stem.toLocaleLowerCase('tr'))) problems.push(`${i + 1}. soru tek başına anlaşılmıyor: “${stem.slice(0, 80)}”`)
  })
  const open = (questions ?? []).filter((q) => q.kind === 'OPEN').length
  return { pass: problems.length === 0, detail: problems.length ? problems.join('; ') : `${open} açık uçlu soru dahil hepsi bağımsız ve soru biçiminde.` }
}

/** 5. The POST /quizzes answer for `asked` (2-10) questions and the finished set. */
export function checkQuizCount({ status, started, finished, asked }) {
  const problems = []
  if (status !== 202 || started?.type !== 'quiz_set') problems.push(`${asked} soru istendi ama yanıt bir set değil (HTTP ${status})`)
  const planned = started?.requested ?? 0
  if (planned !== asked && !/yetiyor/.test(started?.note ?? '')) problems.push(`set ${planned} soru planladı, ${asked} istendi ve not nedeni söylemiyor`)
  if (finished && finished.produced > planned) problems.push('set planlanandan çok soru içeriyor')
  return {
    pass: problems.length === 0,
    detail: problems.length ? problems.join('; ') : `${asked} soru istendi; set ${planned} soru planladı, ${finished?.produced ?? 0} tanesi hazırlandı.`,
  }
}

export const CRITERIA = [
  ['sources', '1. Belge varken transkriptten soru yok'],
  ['repeats', '2. Aynı sınavda tekrar soru yok'],
  ['yield', '3. İstenenin en az %80\'i ya da açık neden'],
  ['open', '4. Açık uçlu sorular gerçek soru, kökler bağımsız'],
  ['count', '5. Quiz\'de soru sayısı seçilebiliyor'],
]

/** A plain-text report; `results` maps a criterion key to { pass, detail } (or null when not run). */
export function formatReport(results) {
  const lines = ['Quiz/sınav kabul kontrolü', '']
  for (const [key, title] of CRITERIA) {
    const r = results[key]
    lines.push(`${r == null ? 'ATLANDI' : r.pass ? 'GEÇTİ  ' : 'KALDI  '} ${title}`)
    if (r?.detail) lines.push(`        ${r.detail}`)
  }
  const ran = CRITERIA.map(([k]) => results[k]).filter(Boolean)
  lines.push('', ran.length && ran.every((r) => r.pass) ? 'Sonuç: GEÇTİ' : 'Sonuç: KALDI')
  return lines.join('\n')
}

export function allPassed(results) {
  const ran = CRITERIA.map(([k]) => results[k]).filter(Boolean)
  return ran.length === CRITERIA.length && ran.every((r) => r.pass)
}
