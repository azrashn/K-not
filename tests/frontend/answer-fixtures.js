// Shared GroundedAnswer (rag.v1) fixtures for the mocked frontend tests.
export const DOC = 'cdoc000000000000000000avl'
const loc = (p, s, e) => ({ page_start: p, page_end: p, char_start: s, char_end: e, section_title: null })
const evidence = (id, page, text) => ({
  evidence_id: id, chunk_id: `${DOC}:c1:00${page}`, document_id: DOC, course_id: 'c', document_title: 'Hafta 4', document_type: 'slide',
  indexing_version: 'c1', location: loc(page, 0, text.length), label: `Slayt · s.${page}`, text, score: 0.9, rank: 1, truncated: false,
})
const citation = (ev, quote, highlight = null) => ({
  evidence_id: ev.evidence_id, chunk_id: ev.chunk_id, document_id: DOC, document_title: 'Hafta 4', location: ev.location, label: ev.label,
  quote, quote_verified: Boolean(highlight), highlight,
})

export function grounded({ supports = ['SUPPORTED'], label = 'SIKI', outcome = 'ANSWERED', provider = 'extractive_baseline' } = {}) {
  const e1 = evidence('E1', 4, 'AVL Ağaçları: Denge Koşulu\nfarkın en fazla 1 olduğu ağaç.')
  return {
    schema_version: 'rag.v1', answer_id: 'a1', request_id: 'r1', question: 'AVL?', course_id: 'c', outcome,
    support_status: { SIKI: 'SUPPORTED', 'GEVEŞEK': 'PARTIALLY_SUPPORTED', KOPUK: 'UNSUPPORTED' }[label], support_label: label,
    answer_text: 'x',
    claims: supports.map((s, i) => ({
      claim_id: `c${i + 1}`, claim_text: `İddia metni ${i + 1}`, cited_evidence_ids: ['E1'],
      citations: [citation(e1, 'farkın en fazla 1', { chunk_char_start: 27, chunk_char_end: 44, document_char_start: 195, document_char_end: 212 })],
      support_status: s, support_label: { SUPPORTED: 'SIKI', PARTIALLY_SUPPORTED: 'GEVEŞEK', UNSUPPORTED: 'KOPUK' }[s],
      support_explanation: s === 'SUPPORTED' ? null : 'Kaynak yalnızca bir kısmını söylüyor.',
    })),
    evidence: [e1], insufficient_evidence: null, citation_issues: [], support_confirmed: false, verification: 'HEURISTIC',
    generation: { provider, model: 'extractive-baseline-v1' }, question_coverage: { uncovered_terms: ['Dijkstra'] },
    documents: { [DOC]: { title: 'Hafta 4 — AVL', original_filename: 'hafta4.pdf', document_type: 'slide', page_count: 5 } },
  }
}

