// Exam builder helpers. The server decides what is a valid exam; these only describe and bound input.
import { hashParam, hashWith, rememberInHash } from './page-query'

export const EXAM_MAX_QUESTIONS = 20
export const EXAM_TEXT_LIMIT = 20000
export const EXAM_FILE_LIMIT = 5 * 1024 * 1024

export const KIND_LABELS = {
  MULTIPLE_CHOICE: 'Çoktan seçmeli',
  TRUE_FALSE: 'Doğru / yanlış',
  CLOZE: 'Boşluk doldurma',
  SHORT_ANSWER: 'Kısa yanıt',
  OPEN: 'Açık uçlu',
}

const STATUS_TEXT = {
  GENERATING: 'Hazırlanıyor',
  READY: 'Hazır',
  PARTIAL: 'Kısmen hazır',
  FAILED: 'Hazırlanamadı',
}

export function examStatusText(exam) {
  if (!exam) return ''
  const base = STATUS_TEXT[exam.status] || exam.status
  return `${base} · ${exam.produced}/${exam.requested} soru`
}

/** One topic per line or comma separated; trims, drops blanks and duplicates, at most 12. */
export function topicsFromText(text) {
  const seen = new Set()
  const out = []
  for (const part of String(text || '').split(/[\n,;]+/)) {
    const topic = part.trim().slice(0, 200)
    const key = topic.toLocaleLowerCase('tr')
    if (topic && !seen.has(key)) { seen.add(key); out.push(topic) }
  }
  return out.slice(0, 12)
}

/** At most this many past exams are combined into one new exam (the server enforces the same). */
export const EXAM_STYLES_MAX = 5

/** Suggested size of the new exam: the average question count of the selected past exams, 1..20. */
export function averageExamCount(profiles) {
  const list = (profiles || []).filter(Boolean)
  if (!list.length) return null
  const total = list.reduce((sum, p) => sum + (Number(p.question_count) || 0), 0)
  return Math.max(1, Math.min(EXAM_MAX_QUESTIONS, Math.round(total / list.length)))
}

export function examFormProblem({ styleIds, count, hasStyleTopics, topics }) {
  if (!styleIds?.length) return 'En az bir geçmiş sınav seçin ya da yeni bir sınav ekleyin.'
  if (styleIds.length > EXAM_STYLES_MAX) return `En fazla ${EXAM_STYLES_MAX} geçmiş sınav seçilebilir.`
  const n = Number(count)
  if (!Number.isInteger(n) || n < 1 || n > EXAM_MAX_QUESTIONS) return `Soru sayısı 1 ile ${EXAM_MAX_QUESTIONS} arasında olmalı.`
  if (!topics.length && !hasStyleTopics) return 'Seçilen sınavlarda yeterli terim yok; en az bir konu yazın.'
  return ''
}

export function fileProblem(file) {
  if (!file) return 'Bir dosya seçin.'
  if (!/\.(pdf|docx|txt|md)$/i.test(file.name)) return 'Yalnızca PDF, DOCX veya TXT yüklenebilir.'
  if (file.size > EXAM_FILE_LIMIT) return 'Dosya en fazla 5 MB olabilir.'
  if (file.size === 0) return 'Dosya boş.'
  return ''
}

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E']

// ── The open exam in the address ("#/dersler/<id>/sinavlar?exam=<id>") ───────────
/** The exam id in a hash, or null. */
export const examFromHash = (hash) => hashParam(hash, 'exam')

/** The exam page address for a course, with the open exam when there is one. */
export const examHash = (courseId, examId) => hashWith(`#/dersler/${courseId}/sinavlar`, { exam: examId })

/** Writes the open exam into the address (only on this course's exam page); see rememberInHash. */
export const rememberExam = (courseId, examId) => rememberInHash(examHash(courseId, null), { exam: examId })

/** Summary after the last question: only what was recorded (honest-evidence rule). Open answers are saved
 *  but not graded, so they count as answered, not as right or wrong. */
export function examSummary(questions, results) {
  const answered = questions.filter((q) => results[q.id])
  const correct = answered.filter((q) => results[q.id].score === 1)
  const wrong = answered.filter((q) => results[q.id].score === 0)
  return {
    total: questions.length,
    answered: answered.length,
    correct: correct.length,
    ungraded: answered.length - correct.length - wrong.length,
    wrong: wrong.map((q) => ({ id: q.id, index: questions.indexOf(q), question: q.question })),
  }
}
