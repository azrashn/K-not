// DocumentDto (document-contract.md §9) → materyal satırı; yükleme ön doğrulaması.
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

// Sözleşme document_type ↔ arayüz türü (WBS-5 eşlemesi)
export const DOC_TYPES = [
  { id: 'slide', ui: 'slayt', label: 'Slayt' },
  { id: 'notes', ui: 'not', label: 'Not' },
  { id: 'past_exam', ui: 'sinav', label: 'Geçmiş sınav' },
  { id: 'textbook', ui: 'kitap', label: 'Kitap' },
  { id: 'other', ui: 'belge', label: 'Belge' },
]
export const TYPE_LABEL = Object.fromEntries(DOC_TYPES.map((t) => [t.ui, t.label]))
export const uiType = (documentType) => DOC_TYPES.find((t) => t.id === documentType)?.ui ?? 'belge'
export const CITE_PREFIX = { slide: 'Slayt', notes: 'Notlar', textbook: 'Kitap', past_exam: 'Sınav', other: 'Belge' }

/** Dosya adından makul bir varsayılan tür (kullanıcı değiştirebilir). */
export function guessDocumentType(name) {
  const n = name.toLocaleLowerCase('tr')
  if (/vize|final|çıkmış|cikmis|sınav|sinav|exam/.test(n)) return 'past_exam'
  if (/not|notes/.test(n)) return 'notes'
  if (/hafta|slayt|slide|ders/.test(n)) return 'slide'
  if (/kitap|book|bölüm|bolum|chapter/.test(n)) return 'textbook'
  return 'other'
}

/** İstemci tarafı kontrol (sunucu yine de %PDF- imzası ve boyutu doğrular). */
export function validatePdf(file) {
  if (!file) return 'Bir PDF dosyası seç.'
  const isPdfName = /\.pdf$/i.test(file.name)
  const isPdfType = !file.type || file.type === 'application/pdf'
  if (!isPdfName || !isPdfType) return 'Yalnızca PDF dosyaları yüklenebilir.'
  if (file.size === 0) return 'Dosya boş.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Dosya çok büyük (en fazla 30 MB).'
  return null
}

const DATE = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' })
const PROCESSING = new Set(['UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'])

export const isProcessing = (dto) => PROCESSING.has(dto.status?.state)

export function toMaterial(dto) {
  return {
    id: dto.id,
    name: dto.original_filename,
    title: dto.title,
    documentType: dto.document_type,
    type: uiType(dto.document_type),
    visibility: dto.visibility,
    pages: dto.page_count,
    sizeBytes: dto.size_bytes,
    added: DATE.format(new Date(dto.created_at)),
    status: dto.status?.ui_state ?? 'uploaded',
    state: dto.status?.state,
    issue: dto.status?.error?.message_tr ?? null,
    errorCode: dto.status?.error?.code ?? null,
    retryable: Boolean(dto.status?.error?.retryable),
    canDelete: Boolean(dto.can_delete),
    notices: dto.notices ?? [],
  }
}

/** Ders hazırlık özeti (gerçek sayılarla). */
export function readiness(list) {
  const total = list.length
  const ready = list.filter((m) => m.status === 'ready').length
  const error = list.filter((m) => m.status === 'error').length
  const busy = total - ready - error
  if (total === 0) return { tone: 'busy', text: 'Henüz materyal yok', ready, total }
  if (busy > 0) return { tone: 'busy', text: `${busy} materyal hazırlanıyor`, ready, total }
  if (error > 0) return { tone: 'error', text: `${error} materyalde sorun var`, ready, total }
  return { tone: 'ready', text: 'Tüm materyaller hazır', ready, total }
}
