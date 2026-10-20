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
  DOCUMENT_NOT_READY: 'Seçilen materyal henüz hazır değil ya da bu işlem için kullanılamıyor. Hazır olanları seçip tekrar dene.',
  PAYLOAD_TOO_LARGE: 'Dosya çok büyük (en fazla 30 MB).',
  UNSUPPORTED_MEDIA_TYPE: 'Yalnızca PDF dosyaları yüklenebilir.',
  RATE_LIMITED: 'Çok sık istek gönderdin. Bir dakika sonra tekrar dene.',
  INTERNAL_ERROR: 'Beklenmeyen bir hata oluştu. Tekrar dene.',
  GENERATION_FAILED: 'Yanıt üretilemedi. Bu bir hizmet sorunu; kaynaklarla ilgili değil. Tekrar dene.',
  AI_SERVICE_UNAVAILABLE: 'Yapay zekâ hizmetine şu an ulaşılamıyor. Birazdan tekrar dene.',
  INDEX_VERSION_MISMATCH: 'Arama dizini bakımda. Birazdan tekrar dene.',
  CONFLICT: 'Bu kod ve dönem için zaten bir ders var. Farklı bir kod ya da dönem dene.',
  DUPLICATE_COURSE: 'Bu kod ve dönem için zaten bir ders var. Farklı bir kod ya da dönem dene.',
  ROUTE_NOT_FOUND: 'Sunucu bu özelliği tanımıyor: arka uç eski bir sürümle çalışıyor olabilir. Uygulamayı `npm run dev:all` ile yeniden başlat.',
  DATABASE_NOT_MIGRATED: 'Veritabanı şeması güncel değil. `npm run dev:all` (ya da backend klasöründe `npx prisma migrate deploy`) çalıştırıp yeniden dene.',
  QUIZ_GENERATION_FAILED: 'Seçtiğin materyallerden güvenilir soru çıkarılamadı. Daha fazla metin içeren materyaller seçmeyi dene.',
  QUIZ_ALREADY_SUBMITTED: 'Bu quiz denemesi zaten teslim edildi.',
  PROVIDER_TIMEOUT: 'Yanıt zamanında üretilemedi. Tekrar dene.',
}

const NOT_FOUND_TEXT = {
  course: 'Ders bulunamadı ya da bu derse erişimin yok.',
  document: 'Materyal bulunamadı ya da erişimin yok.',
  quiz: 'Quiz bulunamadı.',
  attempt: 'Quiz denemesi bulunamadı.',
  page: 'Bu sayfa bulunamadı.',
}

export const errorText = (e) => {
  if (e?.code === 'ROUTE_NOT_FOUND' || (e?.status === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE) /.test(e?.message ?? ''))) {
    return TEXT.ROUTE_NOT_FOUND
  }
  if (e?.code === 'NOT_FOUND') return NOT_FOUND_TEXT[e?.details?.resource] ?? TEXT.NOT_FOUND
  if (e?.code === 'AI_SERVICE_UNAVAILABLE' && e?.details?.reason === 'ai_service_outdated') {
    return 'Yapay zekâ servisi eski bir sürümle çalışıyor. Uygulamayı `npm run dev:all` ile yeniden başlat.'
  }
  return TEXT[e?.code] ?? TEXT.INTERNAL_ERROR
}

/** Yapay zekâ hizmeti hataları: kanıt yokluğundan (KOPUK) ayrı gösterilir. */
export const isServiceError = (e) =>
  ['AI_SERVICE_UNAVAILABLE', 'GENERATION_FAILED', 'PROVIDER_TIMEOUT', 'INDEX_VERSION_MISMATCH', 'NETWORK_ERROR', 'INTERNAL_ERROR'].includes(e?.code)
