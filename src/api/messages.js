// Genel hata kodları (api-contracts.md §7) → kullanıcıya gösterilen Türkçe metin.
// Sunucunun İngilizce teknik mesajları kullanıcıya gösterilmez.
const TEXT = {
  NETWORK_ERROR: 'Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.',
  VALIDATION_ERROR: 'İstek geçersiz. Girdiğin bilgileri kontrol et.',
  UNAUTHENTICATED: 'Oturumun sona erdi. Lütfen yeniden giriş yap.',
  FORBIDDEN: 'Bu işlem için yetkin yok.',
  NOT_FOUND: 'Aradığın içerik bulunamadı ya da görme yetkin yok.',
  DUPLICATE_DOCUMENT: 'Bu dosyayı bu derse zaten yüklemişsin.',
  JOB_ALREADY_RUNNING: 'Bu materyal zaten hazırlanıyor.',
  NOT_RETRYABLE: 'Bu dosya yeniden denenemez. Silip düzeltilmiş bir kopya yükleyebilirsin.',
  NO_READY_DOCUMENTS: 'Bu derste soru yanıtlamaya hazır materyal yok. Önce bir PDF yükle ve hazır olmasını bekle.',
  DOCUMENT_NOT_READY: 'Bu materyal henüz hazır değil; sayfaları okunduktan sonra görüntülenebilir.',
  PAYLOAD_TOO_LARGE: 'Dosya çok büyük (en fazla 30 MB).',
  UNSUPPORTED_MEDIA_TYPE: 'Yalnızca PDF dosyaları yüklenebilir.',
  RATE_LIMITED: 'Çok sık istek gönderdin. Bir dakika sonra tekrar dene.',
  INTERNAL_ERROR: 'Beklenmeyen bir hata oluştu. Tekrar dene.',
  GENERATION_FAILED: 'Yanıt üretilemedi. Bu bir hizmet sorunu; kaynaklarla ilgili değil. Tekrar dene.',
  AI_SERVICE_UNAVAILABLE: 'Yapay zekâ hizmetine şu an ulaşılamıyor. Birazdan tekrar dene.',
  INDEX_VERSION_MISMATCH: 'Arama dizini bakımda. Birazdan tekrar dene.',
  PROVIDER_TIMEOUT: 'Yanıt zamanında üretilemedi. Tekrar dene.',
}

export const errorText = (e) => TEXT[e?.code] ?? TEXT.INTERNAL_ERROR

/** Yapay zekâ hizmeti hataları: kanıt yokluğundan (KOPUK) ayrı gösterilir. */
export const isServiceError = (e) =>
  ['AI_SERVICE_UNAVAILABLE', 'GENERATION_FAILED', 'PROVIDER_TIMEOUT', 'INDEX_VERSION_MISMATCH', 'NETWORK_ERROR', 'INTERNAL_ERROR'].includes(e?.code)
