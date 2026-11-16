// Exam builder helpers. The server decides what is a valid exam; these only describe and bound input.
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

export function examFormProblem({ styleId, count, hasStyleTopics, topics }) {
  if (!styleId) return 'Önce bir sınav stili seçin ya da geçmiş sınav ekleyin.'
  const n = Number(count)
  if (!Number.isInteger(n) || n < 1 || n > EXAM_MAX_QUESTIONS) return `Soru sayısı 1 ile ${EXAM_MAX_QUESTIONS} arasında olmalı.`
  if (!topics.length && !hasStyleTopics) return 'Bu stilde yeterli terim yok; en az bir konu yazın.'
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
