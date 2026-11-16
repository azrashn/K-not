// Practice history helpers. The server returns one row per generated question; these helpers
// only label and filter it, so an unanswered question is never shown as answered.
export const HISTORY_FILTERS = [
  { id: 'all', label: 'Tümü' },
  { id: 'unanswered', label: 'Yanıt bekleyen' },
  { id: 'answered', label: 'Yanıtlanan' },
]

const outcomeLabels = {
  CORRECT: 'Doğru',
  REVIEW_SOURCE: 'Kaynağı incele',
  REVIEW_REQUIRED: 'Gözden geçir',
  REFLECTION_SAVED: 'Yanıt kaydedildi',
}

export function historyLabel(item) {
  if (item?.status !== 'ANSWERED') return 'Yanıt bekliyor'
  return outcomeLabels[item.latest_outcome] || 'Yanıtlandı'
}

export function filterHistory(items = [], filter = 'all') {
  if (filter === 'unanswered') return items.filter((i) => i.status !== 'ANSWERED')
  if (filter === 'answered') return items.filter((i) => i.status === 'ANSWERED')
  return items
}

export function summarizeHistory(items = []) {
  const answered = items.filter((i) => i.status === 'ANSWERED')
  return {
    total: items.length,
    answered: answered.length,
    unanswered: items.length - answered.length,
    correct: answered.filter((i) => i.latest_outcome === 'CORRECT').length,
  }
}
