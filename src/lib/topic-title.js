// A material title as a quiz topic, when the server has no topic suggestions. Video titles are written to
// attract viewers ("2 Dakikada Java   Java Nedir, Ne İşe Yarar…"): the topic is the first part that names a
// subject, not the whole title.

const SEPARATORS = /\s*[|–—:,;]\s*|\s+-\s+|\s{2,}/
// Parts that only say where or how long, never what: "2 Dakikada Java", "Hafta 4", "Ders 3", "Bölüm 2".
const NOT_A_SUBJECT = /^(\d|(hafta|ders|bölüm|ünite|week|lecture|chapter|unit|part)\s*\d+$)/i
export const TOPIC_TITLE_MAX = 40

export function cleanTitle(title) {
  const base = String(title || '').replace(/\.[A-Za-z0-9]{2,4}$/, '').trim()
  const parts = base.split(SEPARATORS).map((p) => p.trim()).filter((p) => /\p{L}{2}/u.test(p))
  const part = parts.find((p) => !NOT_A_SUBJECT.test(p)) ?? parts[0] ?? ''
  if (part.length <= TOPIC_TITLE_MAX) return part
  const cut = part.slice(0, TOPIC_TITLE_MAX)
  return cut.slice(0, cut.lastIndexOf(' ') > 10 ? cut.lastIndexOf(' ') : TOPIC_TITLE_MAX).trim()
}
