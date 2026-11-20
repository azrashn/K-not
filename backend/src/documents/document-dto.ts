/** `DocumentDto` and the public status mapping (document-contract.md §9, lifecycle §5). */
import type { Document } from '../generated/prisma/client';

export const DOCUMENT_TYPES = ['slide', 'notes', 'textbook', 'past_exam', 'other'] as const;

const UI_STATE: Record<string, string | null> = {
  UPLOADED: 'uploaded',
  EXTRACTING: 'reading',
  CHUNKING: 'preparing',
  EMBEDDING: 'preparing',
  INDEXING: 'preparing',
  READY: 'ready',
  FAILED: 'error',
  DELETING: null,
};

const RETRYING_TR = 'Hazırlanırken bir sorun oluştu; tekrar deneniyor.';

/** Python messages are never shown to users; this table is (document-lifecycle.md §5). */
export const MESSAGE_TR: Record<string, string> = {
  SOURCE_NOT_FOUND: 'Dosya bulunamadı. Lütfen yeniden yükle.',
  SOURCE_CHECKSUM_MISMATCH: 'Dosya bulunamadı. Lütfen yeniden yükle.',
  UNSUPPORTED_FORMAT: 'Bu dosya biçimi desteklenmiyor. PDF yükleyebilirsin.',
  ENCRYPTED_PDF: 'Dosya parola korumalı. Korumasız bir kopya yükleyebilirsin.',
  CORRUPT_PDF: 'Dosya bozuk görünüyor. Yeniden yüklemeyi dene.',
  NO_TEXT_LAYER: 'Taranmış sayfalar okunamadı. Metin içeren bir PDF yükleyebilirsin.',
  EMPTY_DOCUMENT: 'Dosyada okunabilir metin bulunamadı.',
  TOO_LARGE: 'Dosya çok uzun (en fazla 400 sayfa).',
  UNSUPPORTED_INDEXING_VERSION: 'Bir sistem sorunu oluştu.',
  INDEX_CONFIG_MISMATCH: 'Bir sistem sorunu oluştu.',
  EMBEDDING_FAILED: RETRYING_TR,
  INDEX_UNAVAILABLE: RETRYING_TR,
  VERIFICATION_FAILED: RETRYING_TR,
  STORAGE_WRITE_FAILED: RETRYING_TR,
  STALLED: RETRYING_TR,
  WORKER_SHUTDOWN: RETRYING_TR,
  INTERNAL: RETRYING_TR,
};

export function documentDto(d: Document, opts: { canDelete: boolean; notices?: string[] }) {
  const processing = ['EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING'].includes(d.status);
  return {
    id: d.id,
    course_id: d.courseId,
    owner_id: d.ownerId,
    visibility: d.visibility,
    document_type: d.documentType,
    title: d.title,
    original_filename: d.originalFilename,
    mime_type: d.mimeType,
    size_bytes: d.sizeBytes,
    page_count: d.pageCount,
    created_at: d.createdAt.toISOString(),
    status: {
      state: d.status,
      ui_state: UI_STATE[d.status],
      stage: processing ? d.status : null,
      updated_at: d.updatedAt.toISOString(),
      error: d.status === 'FAILED' && d.errorCode
        ? { code: d.errorCode, message_tr: MESSAGE_TR[d.errorCode] ?? 'Bir sistem sorunu oluştu.', retryable: Boolean(d.errorRetryable) }
        : null,
    },
    can_delete: opts.canDelete,
    notices: opts.notices ?? [],
  };
}
