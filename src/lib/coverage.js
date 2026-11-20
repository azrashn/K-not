// Kapsam haritası yardımcıları: yalnızca kayıtlı sayıları biçimler. Tahmin ya da puan üretmez.
import { userScopedKey } from '../api/session'

/** [1,2,3,5,9,10] -> [[1,3],[5,5],[9,10]] (ardışık sayfalar aralık olur). */
export function pageRanges(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const out = []
  for (const p of sorted) {
    const last = out[out.length - 1]
    if (last && p === last[1] + 1) last[1] = p
    else out.push([p, p])
  }
  return out
}

/** [[4,4],[9,12]] -> "4, 9–12" */
export const rangesText = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ')

/** Öğrencinin girdiği sınav tarihi (HomeDashboard ile aynı anahtar); yoksa null. */
export function readExamDate() {
  try {
    const e = JSON.parse(localStorage.getItem(userScopedKey('knot-exam')) || 'null')
    return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) ? e : null
  } catch {
    return null
  }
}

const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
/** Bugünden sınav gününe kalan gün (geçmişse negatif). */
export const daysUntil = (dateText, now = new Date()) =>
  Math.round((day(new Date(dateText + 'T00:00:00')) - day(now)) / 86400000)

export function pageLabel(p) {
  if (p.asked && p.practiced) return `Sayfa ${p.page}: soruldu, alıştırmada çıktı`
  if (p.asked) return `Sayfa ${p.page}: soruldu`
  if (p.practiced) return `Sayfa ${p.page}: alıştırmada çıktı`
  return `Sayfa ${p.page}: dokunulmadı`
}
export const pageMark = (p) => (p.asked && p.practiced ? 'SA' : p.asked ? 'S' : p.practiced ? 'A' : '')
