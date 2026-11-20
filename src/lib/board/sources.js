import { videoTime } from '../video'

// Adımdaki bir kaynağı cevabın kanıtlarına bağlar. Sıra: kanıt id'si → "[n]" numarası → "mm:ss".
// Kanıt iki biçimde gelebilir: çalışma alanı { id, n, location: { kind, start_ms | page | slide } },
// video sayfası { n, timestamp_ms }.
// Dönen nesne: { source, label, evidence, ms, page, slide }; çözülemezse yalnızca { source, label }.

const TIME = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/

export function parseTime(text) {
  const m = TIME.exec(String(text).trim())
  if (!m) return null
  const [, h, min, sec] = m
  if (Number(sec) > 59) return null
  return ((Number(h || 0) * 60 + Number(min)) * 60 + Number(sec)) * 1000
}

// Birden çok belge açıkken "Sayfa 3" tek başına belirsiz; belge adı kısaltılıp öne eklenir.
function docPrefix(e) {
  const t = String(e.title || '').replace(/\.[a-z0-9]{2,4}$/i, '').trim()
  if (!t) return ''
  return (t.length > 22 ? `${t.slice(0, 21)}…` : t) + ' · '
}

function fromEvidence(source, e) {
  const loc = e.location || {}
  const ms = loc.kind === 'video' ? loc.start_ms : e.timestamp_ms
  if (Number.isFinite(ms)) return { source, evidence: e, ms, label: videoTime(ms / 1000) }
  if (loc.kind === 'page') return { source, evidence: e, page: loc.page, label: `${docPrefix(e)}Sayfa ${loc.page}` }
  if (loc.kind === 'slide') return { source, evidence: e, slide: loc.slide, label: `${docPrefix(e)}Slayt ${loc.slide}` }
  return { source, evidence: e, label: e.n != null ? `[${e.n}]` : source }
}

export function resolveSource(source, evidence = []) {
  const text = String(source ?? '').trim()
  const byId = evidence.find((e) => e.id != null && String(e.id) === text)
  if (byId) return fromEvidence(text, byId)
  const n = /^\[(\d+)\]$/.exec(text)
  if (n) {
    const byN = evidence.find((e) => Number(e.n) === Number(n[1]))
    if (byN) return fromEvidence(text, byN)
  }
  const ms = parseTime(text)
  if (ms !== null) {
    // Aynı ana denk gelen kanıt varsa onu kullan (sayfa ona gidebilsin).
    const near = evidence.find((e) => {
      const at = e.location?.kind === 'video' ? e.location.start_ms : e.timestamp_ms
      return Number.isFinite(at) && Math.abs(at - ms) < 1000
    })
    return near ? { ...fromEvidence(text, near), ms } : { source: text, ms, label: videoTime(ms / 1000) }
  }
  return { source: text, label: text }
}

export const isResolved = (r) => Boolean(r.evidence || Number.isFinite(r.ms) || r.page != null || r.slide != null)

// Adım adım kaynak listesi: [{ step, items: [resolved] }], kaynaksız adımlar dahil değil.
export function stepSources(steps, evidence = []) {
  return steps
    .map((s, step) => ({ step, items: (s.sources || []).map((src) => resolveSource(src, evidence)) }))
    .filter((row) => row.items.length > 0)
}
