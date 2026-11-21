// Past-exam style helpers. The server derives the profile; these only describe and validate it.
export const EXAM_TEXT_LIMIT = 20000

/** `withCount: false` leaves out the leading "N soru" (for places that show the count separately). */
export function describeExamStyle(profile, { withCount = true } = {}) {
  if (!profile) return ''
  const f = profile.formats || {}
  return [
    withCount ? `${profile.question_count} soru` : null,
    f.MULTIPLE_CHOICE ? `çoktan seçmeli ${f.MULTIPLE_CHOICE}` : null,
    f.TRUE_FALSE ? `doğru/yanlış ${f.TRUE_FALSE}` : null,
    f.CALCULATION ? `hesaplama ${f.CALCULATION}` : null,
    f.SHORT_ANSWER ? `kısa yanıt ${f.SHORT_ANSWER}` : null,
    f.CLOZE ? `boşluk doldurma ${f.CLOZE}` : null,
    f.OPEN ? `açık uçlu ${f.OPEN}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function examStyleProblem({ name, text }) {
  if (!name?.trim()) return 'Sınava bir ad verin.'
  if (name.trim().length > 120) return 'Sınav adı en fazla 120 karakter olabilir.'
  if ((text || '').trim().length < 20) return 'Sınav metnini yapıştırın (en az 20 karakter).'
  if (text.length > EXAM_TEXT_LIMIT) return 'Sınav metni en fazla 20.000 karakter olabilir.'
  return ''
}
