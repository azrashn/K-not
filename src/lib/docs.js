import { DOCS } from '../data/mock'

// Bir kanıtın belgedeki gerçek metni (quiz geri bildirimi, analitik ayrıntısı için)
export function excerpt(cite) {
  const page = DOCS[cite.doc]?.pages[cite.page]
  return page?.blocks.find((b) => b.id === cite.seg)?.text || ''
}

export const docFile = (id) => DOCS[id]?.filename
