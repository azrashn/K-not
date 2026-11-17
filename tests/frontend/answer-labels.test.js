import { describe, expect, test } from 'vitest'
import { modeLabel, statusLabel } from '../../src/lib/answer-labels'

describe('modeLabel', () => {
  test('names the style the answer was written in', () => {
    expect(modeLabel('short')).toBe('Kısa yanıt')
    expect(modeLabel('detailed')).toBe('Ayrıntılı yanıt')
    expect(modeLabel('step_by_step')).toBe('Adım adım yanıt')
    expect(modeLabel('example')).toBe('Örnekli yanıt')
    expect(modeLabel('default')).toBe('Standart yanıt')
  })
  test('an unknown or missing mode shows nothing instead of a wrong label', () => {
    expect(modeLabel(undefined)).toBeNull()
    expect(modeLabel('weird')).toBeNull()
  })
})

describe('statusLabel', () => {
  test('a model failure says why, and that source sentences (not a model answer) are shown', () => {
    const t = statusLabel({ status: 'GENERATION_FAILED_SOURCE_EXCERPTS', generation_failure: 'UNAVAILABLE' })
    expect(t).toContain('Ollama açık mı')
    expect(t).toContain('model yorumu değil')
    expect(statusLabel({ status: 'GENERATION_FAILED_SOURCE_EXCERPTS', generation_failure: 'TIMEOUT' })).toContain('zamanında yanıt veremedi')
  })
  test('an unknown failure reason still gets an honest generic line', () => {
    expect(statusLabel({ status: 'GENERATION_FAILED_SOURCE_EXCERPTS' })).toContain('tamamlanamadı')
  })
  test('other statuses keep their labels', () => {
    expect(statusLabel({ status: 'GENERATED_UNVERIFIED' })).toBe('Deneysel model açıklaması · doğrulanmadı')
    expect(statusLabel({ status: 'NO_EVIDENCE' })).toBe('Yeterli kaynak bulunamadı')
    expect(statusLabel({ status: 'INVALID_CITATIONS' })).toContain('geçerli kaynak göstermedi')
    expect(statusLabel({})).toBe('Kaynak durumu doğrulanamadı')
  })
})
