import { DOCS } from '../data/mock'

// Bir kanıtın belgedeki gerçek metni (quiz geri bildirimi, analitik ayrıntısı için)
export function excerpt(cite) {
  const page = DOCS[cite.doc]?.pages[cite.page]
  const b = page?.blocks.find((x) => x.id === cite.seg)
  if (!b) return ''
  if (b.type === 'table') return b.rows.map((r) => r.join(' · ')).join('  —  ')
  return b.text || ''
}

export const docFile = (id) => DOCS[id]?.filename
