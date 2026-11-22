// Practice history helpers. The server returns one row per generated question, each with the quiz set or
// generated exam it belongs to (set_id). These helpers group the rows into cards, label and count them; an
// unanswered question is never shown as answered and nothing is estimated (only recorded answers count).
import { cleanTitle } from './topic-title'

export const KIND_LABELS = {
  MULTIPLE_CHOICE: 'Çoktan seçmeli',
  TRUE_FALSE: 'Doğru / yanlış',
  CLOZE: 'Boşluk doldurma',
  SHORT_ANSWER: 'Kısa yanıt',
  OPEN: 'Açık uçlu yansıtma',
}

export const HISTORY_FILTERS = [
  { id: 'all', label: 'Tümü' },
  { id: 'unanswered', label: 'Yanıt bekleyen' },
  { id: 'answered', label: 'Yanıtlanan' },
  // Questions of generated exams: kept out of the practice list, listed only under this filter.
  { id: 'exam', label: 'Sınavdan' },
]

// The latest recorded outcome (backend learning.service answer()): CORRECT a matched answer, REVIEW_SOURCE a
// choice or cloze that did not match the key (score 0), REVIEW_REQUIRED a short answer that did not match
// word for word (not graded wrong), REFLECTION_SAVED an open answer (never graded).
const OUTCOMES = {
  CORRECT: { label: 'Doğru', tone: 'ok' },
  REVIEW_SOURCE: { label: 'Yanlış', tone: 'no' },
  REVIEW_REQUIRED: { label: 'Kaynağı incele', tone: 'warn' },
  REFLECTION_SAVED: { label: 'Açık uçlu', tone: 'warn' },
}

const isAnswered = (item) => item?.status === 'ANSWERED'

// Kinds the server grades against a key: right or wrong. A short answer is never marked wrong automatically,
// but one that matched the key shows "Doğru" on its row, so it counts as graded and correct (every green
// "Doğru" is in the count). An open reflection is never graded and never counted.
export const GRADED_KINDS = new Set(['MULTIPLE_CHOICE', 'TRUE_FALSE', 'CLOZE'])
const isCorrect = (item) => isAnswered(item) && item.kind !== 'OPEN' && item.latest_outcome === 'CORRECT'
const isGraded = (item) => GRADED_KINDS.has(item?.kind) || isCorrect(item)

// The same idea as the backend topic planner (VERB_FORM): an inflected verb or verbal noun ends a sentence,
// not a topic ("…çevrilir", "…çalışabilmesinin", "…kullanılan").
const VERB_END =
  /(?:[ıiuü]l[ıiuü]r|[ıiuü]n[ıiuü]r|[şç][ıiuü]r|[ae]maz|[ae]mez|[ae]bil\p{L}*|[ıiuü]yor\p{L}*|m[ae]s[ıi]\p{L}*|m[ae]k|d[ıiuü]r|[çfhkpsşt]t[ıiuü]r|[ae]c[ae]k\p{L}*|m[ıiuü]ş|[ae]r[ae]k|[ıiuü]l[ae]n|l[ae]n[ae]n|n[ae]n)$/u
const ENDS_A_PHRASE = new Set('ve veya ile ama ancak için gibi kadar de da ki bir bu şu o the and or of to in on for with a an'.split(' '))

/**
 * The topic as a card title, or null when it is not one: empty, a single word in lower case ("kalıtım"),
 * a piece of a sentence (cut with "…" or "-", "g, float…", ending in "ve", a long lower-case run) or
 * ending like a verb ("…çevrilir", "…çalışabilmesinin").
 */
export function meaningfulTopic(raw) {
  const original = String(raw || '').trim()
  // Checked on one line; returned as written (topic-title.js reads a double space as a separator).
  const text = original.replace(/\s+/g, ' ')
  if (!text) return null
  if (/(…|\.\.\.|\p{L}[-‐])$/u.test(text) || /^\p{L}[,;]/u.test(text) || /[!?]/.test(text)) return null
  const words = text.toLocaleLowerCase('tr').split(' ').map((w) => w.replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean)
  if (!words.length || words.length > 8) return null
  const lower = !/\p{Lu}/u.test(text)
  if (lower && (words.length === 1 || words.length >= 4)) return null
  const last = words[words.length - 1]
  if (ENDS_A_PHRASE.has(last) || VERB_END.test(last)) return null
  return original.charAt(0).toLocaleUpperCase('tr') + original.slice(1)
}

/** A question as a one-line title: cut at a word, with "…". */
export function shortQuestion(text, max = 90) {
  const line = String(text || '').replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  const cut = line.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`
}

/** Label and tone (ok / no / warn / wait) of one question's latest answer. */
export function questionStatus(item) {
  if (!isAnswered(item)) return { label: 'Yanıt bekliyor', tone: 'wait' }
  return OUTCOMES[item.latest_outcome] || { label: 'Yanıtlandı', tone: 'warn' }
}

export function historyLabel(item) {
  return questionStatus(item).label
}

export function filterHistory(items = [], filter = 'all') {
  if (filter === 'unanswered') return items.filter((i) => !isAnswered(i))
  if (filter === 'answered') return items.filter(isAnswered)
  return items
}

export function summarizeHistory(items = []) {
  const answered = items.filter(isAnswered)
  return {
    total: items.length,
    answered: answered.length,
    unanswered: items.length - answered.length,
    // Graded kinds only: an open or short answer is never counted right or wrong.
    graded: items.filter(isGraded).length,
    correct: items.filter(isCorrect).length,
  }
}

/** Questions per filter button: practice questions for the first three, exam questions for "Sınavdan". */
export function filterCounts(practice = [], exam = []) {
  const s = summarizeHistory(practice)
  return { all: s.total, unanswered: s.unanswered, answered: s.answered, exam: exam.length }
}

const time = (item) => {
  const t = new Date(item?.created_at).getTime()
  return Number.isFinite(t) ? t : 0
}

/** A card's title: the exam's name; else the topic when it is meaningful (cleaned by topic-title.js), else
 *  the section heading, else the first question's text, else "Karışık alıştırma". */
function cardTitle(items, exam) {
  const first = items[0] || {}
  if (exam) return String(first.set_title || '').trim() || cleanTitle(meaningfulTopic(first.topic)) || 'Sınav'
  const topic = meaningfulTopic(first.topic || first.set_title)
  if (topic && cleanTitle(topic)) return cleanTitle(topic)
  const section = cleanTitle(items.find((i) => i.section)?.section)
  if (section) return section
  const question = items.find((i) => i.question)?.question
  return question ? shortQuestion(question, 70) : 'Karışık alıştırma'
}

/**
 * One card per quiz set (or generated exam with `exam`), and one per single question (`single`: shown as a
 * compact row titled by its own question). Cards keep the server order (newest first); a card's questions
 * are in the order they were written.
 */
export function groupHistory(items = [], { exam = false } = {}) {
  const groups = new Map()
  for (const item of items) {
    const key = item.set_id ? `set:${item.set_id}` : `quiz:${item.id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups].map(([key, list]) => {
    const questions = [...list].sort((a, b) => time(a) - time(b))
    const s = summarizeHistory(questions)
    const kinds = [...new Set(questions.map((q) => q.kind))]
    const single = !questions[0].set_id
    return {
      key,
      setId: questions[0].set_id || null,
      exam,
      single,
      title: single && questions[0].question ? shortQuestion(questions[0].question) : cardTitle(questions, exam),
      kind: kinds.length === 1 ? KIND_LABELS[kinds[0]] || kinds[0] : 'Karışık',
      createdAt: questions[0].created_at,
      questions,
      ...s,
      done: s.total > 0 && s.unanswered === 0,
      next: questions.find((q) => !isAnswered(q)) || null,
    }
  })
}

/** The cards a filter shows: a card is listed when one of its questions matches the filter. */
export function visibleCards(cards = [], filter = 'all') {
  if (filter === 'unanswered') return cards.filter((c) => c.unanswered > 0)
  if (filter === 'answered') return cards.filter((c) => c.answered > 0)
  return cards
}

/** A set card's progress line: "2/4 yanıtlandı · 1 doğru"; without a graded question no "doğru" at all. */
export function progressText(card) {
  const base = `${card.answered}/${card.total} yanıtlandı`
  return card.graded ? `${base} · ${card.correct} doğru` : base
}

/** A finished set card: "Tamamlandı · 3/4" (right of the graded questions), or just "Tamamlandı". */
export function doneText(card) {
  return card.graded ? `Tamamlandı · ${card.correct}/${card.graded}` : 'Tamamlandı'
}

/** The counter above the list, for the selected filter. */
export function historySummary(filter, cards = []) {
  const sum = (k) => cards.reduce((n, c) => n + c[k], 0)
  if (filter === 'unanswered') return `${sum('unanswered')} soru yanıt bekliyor · ${cards.length} alıştırmada`
  if (filter === 'answered')
    return `${sum('answered')} soru yanıtlandı${sum('graded') ? ` · ${sum('correct')} doğru` : ''}`
  if (filter === 'exam') return `${cards.length} sınav · ${sum('total')} soru · ${sum('answered')} yanıtlandı`
  return `${cards.length} alıştırma · ${sum('total')} soru · ${sum('answered')} yanıtlandı · ${sum('unanswered')} yanıt bekliyor`
}

/** "20 Kas 15:42" (Turkish), or "" for a missing date. */
export function cardDate(value) {
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
