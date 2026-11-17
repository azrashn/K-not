// Practice-set helpers: question count rules, labels and answer progress. No UI, no network.
export const COUNT_MIN = 5
export const COUNT_MAX = 25
export const COUNT_DEFAULT = 10
export const COUNT_PRESETS = [5, 10, 15, 20, 25]

export const DIFFICULTY_LABELS = { easy: 'Kolay', medium: 'Orta', hard: 'Zor', unknown: 'Belirsiz' }
export const FOCUS_LABELS = {
  definition: 'Tanım',
  relation: 'İlişki',
  difference: 'Fark',
  application: 'Uygulama',
  scenario: 'Senaryo',
  code_output: 'Kod / çıktı',
  unknown: 'Genel',
}
export const KIND_LABELS = { MULTIPLE_CHOICE: 'Çoktan seçmeli', TRUE_FALSE: 'Doğru / yanlış', CLOZE: 'Boşluk doldurma', SHORT_ANSWER: 'Kısa yanıt', OPEN: 'Açık uçlu' }

/** Whole numbers from 5 to 25 only. Returns the number, or a message the student can act on. */
export function parseCount(text) {
  const raw = String(text ?? '').trim()
  if (!/^\d+$/.test(raw)) return { value: null, error: `Soru sayısı ${COUNT_MIN} ile ${COUNT_MAX} arasında bir tam sayı olmalı.` }
  const value = Number(raw)
  if (value < COUNT_MIN || value > COUNT_MAX) return { value: null, error: `Soru sayısı ${COUNT_MIN} ile ${COUNT_MAX} arasında olmalı.` }
  return { value, error: '' }
}

/** Several topics can be typed at once, separated by comma, semicolon or new line. */
export function parseTopics(text) {
  const seen = new Set()
  return String(text ?? '')
    .split(/[,;\n]/)
    .map((t) => t.trim().slice(0, 200))
    .filter((t) => t && !seen.has(t.toLocaleLowerCase('tr')) && seen.add(t.toLocaleLowerCase('tr')))
    .slice(0, 12)
}

export function answerStats(questions, answers) {
  const unansweredIndexes = []
  questions.forEach((q, i) => { if (!String(answers[q.id] ?? '').trim()) unansweredIndexes.push(i) })
  return {
    total: questions.length,
    answered: questions.length - unansweredIndexes.length,
    unanswered: unansweredIndexes.length,
    unansweredIndexes,
  }
}

/** Topics to repeat (below 60%) and topics that went well (80% and above). */
export function topicVerdict(byTopic = []) {
  return {
    weak: byTopic.filter((t) => t.percent < 60).map((t) => t.key),
    strong: byTopic.filter((t) => t.percent >= 80).map((t) => t.key),
  }
}
