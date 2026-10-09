// WBS-3 GroundedAnswer (rag.v1) → çalışma alanı görünüm modeli.
// Kural: destek durumu YALNIZCA sunucudan gelir (support_status / support_label). Bir alıntının
// varlığı bir iddiayı asla SIKI yapmaz; KOPUK iddia alıntı taşısa bile "kanıt yok" olarak gösterilir.

export const LEVEL = { SUPPORTED: 1, PARTIALLY_SUPPORTED: 0.5, UNSUPPORTED: 0 }
const STATE_OF_LABEL = { SIKI: 'SIKI', 'GEVEŞEK': 'GEVESEK', GEVESEK: 'GEVESEK', KOPUK: 'KOPUK' }
const STATE_OF_STATUS = { SUPPORTED: 'SIKI', PARTIALLY_SUPPORTED: 'GEVESEK', UNSUPPORTED: 'KOPUK' }

/** Unicode kod noktası güvenli dilim (document-contract.md §10). */
export const cpSlice = (text, start, end) => Array.from(text ?? '').slice(start, end).join('')
export const cpLength = (text) => Array.from(text ?? '').length

/**
 * Belge ofsetlerindeki vurguyu sayfa içi [start, end) aralığına çevirir (sayfaya kırpılmış).
 * Vurgu bu sayfayla kesişmiyorsa null.
 */
export function pageRange(highlight, page) {
  if (!highlight || !page || highlight.document_char_start == null || highlight.document_char_end == null) return null
  const len = cpLength(page.text)
  const start = Math.max(0, highlight.document_char_start - page.char_start)
  const end = Math.min(len, highlight.document_char_end - page.char_start)
  return end > start ? { start, end } : null
}

/** Sayfa metnini [önce, vurgu, sonra] parçalarına böler (kod noktası). */
export function splitPage(text, range) {
  if (!range) return [text ?? '', '', '']
  const cps = Array.from(text ?? '')
  return [cps.slice(0, range.start).join(''), cps.slice(range.start, range.end).join(''), cps.slice(range.end).join('')]
}

function citeOf(c, claim, evidenceById, documents) {
  const ev = evidenceById.get(c.evidence_id)
  const loc = c.location ?? ev?.location ?? {}
  const strength = claim.support_status === 'PARTIALLY_SUPPORTED' ? 'partial' : claim.support_status === 'SUPPORTED' ? 'full' : 'none'
  return {
    docId: c.document_id,
    chunkId: c.chunk_id,
    evidenceId: c.evidence_id,
    page: loc.page_start ?? null,
    pageEnd: loc.page_end ?? loc.page_start ?? null,
    label: c.label ?? ev?.label ?? 'Kaynak',
    strength,
    note: strength === 'partial' ? (claim.support_explanation || 'Kaynak bu iddiayı yalnızca kısmen destekliyor.') : undefined,
    quote: c.quote ?? null,
    quoteVerified: Boolean(c.quote_verified),
    highlight: c.highlight ?? null,
    indexingVersion: ev?.indexing_version ?? (c.chunk_id?.split(':')[1] || null),
    excerpt: ev?.text ?? null,
    truncated: Boolean(ev?.truncated),
    title: documents?.[c.document_id]?.title ?? c.document_title ?? ev?.document_title ?? '',
  }
}

export function adaptAnswer(a) {
  const evidenceById = new Map((a.evidence ?? []).map((e) => [e.evidence_id, e]))
  const documents = a.documents ?? {}
  let claims = (a.claims ?? []).map((cl, i) => {
    const cites = (cl.citations ?? []).map((c) => citeOf(c, cl, evidenceById, documents))
    const unsupported = cl.support_status === 'UNSUPPORTED'
    return {
      id: cl.claim_id ?? `c${i + 1}`,
      n: i + 1,
      tag: `İddia ${i + 1}`,
      text: cl.claim_text,
      support: cl.support_status,
      supportLabel: cl.support_label,
      cites,
      gap: unsupported,
      unsupported,
      detail: unsupported ? (cl.support_explanation || 'Kaynaklarda bu iddiayı destekleyen yeterli kanıt bulunamadı. Doğrulanmış sayılmaz.') : undefined,
    }
  })
  const insufficient = a.insufficient_evidence ?? null
  // Selamlaşma / teşekkür: soru değil. Sunucu belge araması yapmaz; kısa yanıtı gösterilir, iddia yoktur.
  const notQuestion = insufficient?.reason === 'NOT_A_QUESTION'
  if (claims.length === 0 && !notQuestion) {
    claims = [{
      id: 'none', n: '–', tag: 'Yanıt', gap: true, unsupported: false, support: 'UNSUPPORTED', cites: [],
      text: 'Yüklediğin materyallerde bu soruyu yanıtlamaya yetecek kanıt bulunamadı.',
      detail: 'Tahmin yürütmek yerine durdum. Kaynağı olmayan bilgi, K-not’ta yanıt sayılmaz.',
    }]
  }
  const state = STATE_OF_LABEL[a.support_label] ?? STATE_OF_STATUS[a.support_status] ?? 'KOPUK'
  const sourceDocs = [...new Set((a.evidence ?? []).map((e) => e.document_id))].map((id) => ({
    id,
    title: documents[id]?.title ?? (a.evidence ?? []).find((e) => e.document_id === id)?.document_title ?? id,
    filename: documents[id]?.original_filename ?? null,
    documentType: documents[id]?.document_type ?? (a.evidence ?? []).find((e) => e.document_id === id)?.document_type ?? 'other',
    pageCount: documents[id]?.page_count ?? null,
  }))
  return {
    question: a.question,
    outcome: a.outcome,
    state,
    supportConfirmed: Boolean(a.support_confirmed),
    verification: a.verification ?? null,
    claims,
    insufficient,
    notQuestion,
    reply: notQuestion ? insufficient.message : null,
    uncovered: a.question_coverage?.uncovered_terms ?? [],
    sources: sourceDocs,
    generation: a.generation ?? null,
    extractive: a.generation?.provider === 'extractive_baseline',
    answerId: a.answer_id ?? null,
    requestId: a.request_id ?? null,
  }
}
