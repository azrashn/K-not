import { describe, expect, test } from 'vitest'
import { adaptAnswer, cpSlice, pageRange, splitPage } from '../../src/lib/answer'
import { analyze } from '../../src/components/KnotStrength'

import { DOC, grounded } from './answer-fixtures'

describe('GroundedAnswer adapter', () => {
  test('maps claims, citations and sources with chunk ids, physical pages and highlights', () => {
    const a = adaptAnswer(grounded())
    expect(a.state).toBe('SIKI')
    expect(a.claims[0]).toMatchObject({ text: 'İddia metni 1', support: 'SUPPORTED', gap: false })
    expect(a.claims[0].cites[0]).toMatchObject({
      docId: DOC, chunkId: `${DOC}:c1:004`, page: 4, pageEnd: 4, label: 'Slayt · s.4', strength: 'full', quote: 'farkın en fazla 1',
      quoteVerified: true, indexingVersion: 'c1', highlight: { document_char_start: 195, document_char_end: 212 },
    })
    expect(a.sources).toEqual([{ id: DOC, title: 'Hafta 4 — AVL', filename: 'hafta4.pdf', documentType: 'slide', pageCount: 5 }])
    expect(a.extractive).toBe(true)
  })

  test('a citation never upgrades support: UNSUPPORTED stays KOPUK, PARTIAL stays GEVEŞEK', () => {
    const a = adaptAnswer(grounded({ supports: ['PARTIALLY_SUPPORTED', 'UNSUPPORTED'], label: 'GEVEŞEK' }))
    expect(a.claims[0].cites[0].strength).toBe('partial')
    expect(a.claims[0].cites[0].note).toBe('Kaynak yalnızca bir kısmını söylüyor.')
    expect(a.claims[1]).toMatchObject({ gap: true, unsupported: true, support: 'UNSUPPORTED' })
    expect(a.claims[1].cites[0].strength).toBe('none')
    expect(analyze(a.claims, a.state)).toMatchObject({ state: 'GEVESEK', levels: [0.5, 0] })
    // Even if every claim has citations, the overall label comes from the server.
    const all = adaptAnswer(grounded({ supports: ['UNSUPPORTED'], label: 'KOPUK' }))
    expect(analyze(all.claims, all.state).state).toBe('KOPUK')
  })

  test('INSUFFICIENT_EVIDENCE becomes a single no-evidence row, not an error', () => {
    const raw = { ...grounded({ label: 'KOPUK', outcome: 'INSUFFICIENT_EVIDENCE' }), claims: [], evidence: [],
      insufficient_evidence: { reason: 'NO_RETRIEVED_EVIDENCE', message: 'none', missing_information: [] } }
    const a = adaptAnswer(raw)
    expect(a.outcome).toBe('INSUFFICIENT_EVIDENCE')
    expect(a.state).toBe('KOPUK')
    expect(a.claims).toHaveLength(1)
    expect(a.claims[0]).toMatchObject({ gap: true, cites: [] })
  })
})

describe('code-point highlight math (document-contract §10)', () => {
  const page = { page: 2, char_start: 100, char_end: 121, text: 'Değişken 𝑛 için O(𝑛²)' } // 21 code points

  test('cpSlice counts code points, not UTF-16 units', () => {
    expect(cpSlice('a𝑛b', 1, 2)).toBe('𝑛')
    expect('a𝑛b'.slice(1, 2)).not.toBe('𝑛')
  })

  test('document offsets map to the exact page-relative quote', () => {
    const r = pageRange({ document_char_start: 109, document_char_end: 110 }, page)
    expect(r).toEqual({ start: 9, end: 10 })
    expect(splitPage(page.text, r)).toEqual(['Değişken ', '𝑛', ' için O(𝑛²)'])
  })

  test('multi-page highlights are clipped to the page; disjoint ones give null', () => {
    expect(pageRange({ document_char_start: 90, document_char_end: 104 }, page)).toEqual({ start: 0, end: 4 })
    expect(pageRange({ document_char_start: 115, document_char_end: 400 }, page)).toEqual({ start: 15, end: 21 })
    expect(pageRange({ document_char_start: 10, document_char_end: 20 }, page)).toBeNull()
    expect(pageRange(null, page)).toBeNull()
  })
})
