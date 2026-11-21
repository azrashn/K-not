// Yanlış defteri yardımcıları: yalnızca kayıtlı konumu ve etiketi biçimler. Tahmin ya da puan üretmez.

/** Kaynak kaydı (kind + location) -> sayfa ya da zaman; konumu olmayan kaynak için null. Sayfa uydurmaz. */
export function locatorOf(kind, location) {
  const page = kind === 'PDF' ? location?.page : kind === 'PPTX' ? location?.slide : null
  if (Number.isSafeInteger(page) && page >= 1 && page <= 100000) return { type: 'page', page }
  const t = location?.start_ms
  if (kind === 'VIDEO' && Number.isSafeInteger(t) && t >= 0) return { type: 'time', start_ms: t }
  return null
}

export function timeText(ms) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const two = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`
}

export function locatorText(loc) {
  if (!loc) return ''
  return loc.type === 'page' ? `Sayfa ${loc.page}` : timeText(loc.start_ms)
}

/** "Kaynak: Chapter_3 · Sayfa 4"; konum yoksa yalnızca materyal adı. */
export function sourceBadgeText(title, loc) {
  const where = locatorText(loc)
  return `Kaynak: ${title || 'Materyal'}${where ? ` · ${where}` : ''}`
}

export const openLabel = (loc) => (loc?.type === 'time' ? 'Bölüme git' : 'Sayfaya bak')

export const STATUS_LABEL = { OPEN: 'Yanlış', LAST_CORRECT: 'Son denemede doğru' }
export const PURPOSE_LABEL = { EXAM: 'Sınav', PRACTICE: 'Alıştırma' }
