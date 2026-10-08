import { describe, expect, test } from 'vitest'
import { guessDocumentType, MAX_UPLOAD_BYTES, readiness, toMaterial, uiType, validatePdf } from '../../src/lib/materials'
import { doc } from './fake-api'

const file = (name, size = 10, type = 'application/pdf') => ({ name, size, type })

describe('upload validation (client side; the server re-checks %PDF- and size)', () => {
  test.each([
    [file('notlar.pdf'), null],
    [file('NOTLAR.PDF', 10, ''), null],
    [file('sunum.pptx', 10, 'application/vnd.ms-powerpoint'), 'Yalnızca PDF dosyaları yüklenebilir.'],
    [file('resim.pdf', 10, 'image/png'), 'Yalnızca PDF dosyaları yüklenebilir.'],
    [file('bos.pdf', 0), 'Dosya boş.'],
    [file('buyuk.pdf', MAX_UPLOAD_BYTES + 1), 'Dosya çok büyük (en fazla 30 MB).'],
  ])('%o → %s', (f, msg) => expect(validatePdf(f)).toBe(msg))
})

test('document types follow the contract mapping', () => {
  expect(['slide', 'notes', 'past_exam', 'textbook', 'other'].map(uiType)).toEqual(['slayt', 'not', 'sinav', 'kitap', 'belge'])
  expect(guessDocumentType('Hafta4_AVL.pdf')).toBe('slide')
  expect(guessDocumentType('Vize_2024.pdf')).toBe('past_exam')
  expect(guessDocumentType('Ders_Notlari.pdf')).toBe('notes')
  expect(guessDocumentType('rastgele.pdf')).toBe('other')
})

test('DocumentDto → material row; failed rows carry the server Turkish message', () => {
  const failed = toMaterial(doc('d1', 'FAILED', { status: { state: 'FAILED', ui_state: 'error', stage: null, updated_at: '', error: { code: 'NO_TEXT_LAYER', message_tr: 'Taranmış sayfalar okunamadı.', retryable: false } } }))
  expect(failed).toMatchObject({ status: 'error', issue: 'Taranmış sayfalar okunamadı.', retryable: false, errorCode: 'NO_TEXT_LAYER', type: 'slayt' })
  expect(readiness([toMaterial(doc('a', 'READY')), toMaterial(doc('b', 'EMBEDDING'))])).toMatchObject({ tone: 'busy', ready: 1, total: 2 })
})
