// Yanıtın altındaki etiketler: hangi biçimde üretildi, ne kadar güvenilir, model neden başarısız oldu.

const MODE_LABELS = {
  default: 'Standart yanıt',
  short: 'Kısa yanıt',
  detailed: 'Ayrıntılı yanıt',
  step_by_step: 'Adım adım yanıt',
  example: 'Örnekli yanıt',
}

/** "Kısa yanıt", "Ayrıntılı yanıt"… Bilinmeyen/boş biçim için null. */
export function modeLabel(mode) {
  return MODE_LABELS[mode] || null
}

const FAILURE_REASONS = {
  TIMEOUT: 'Model zamanında yanıt veremedi (bilgisayar yavaş ya da model yükleniyor olabilir; tekrar deneyin).',
  UNAVAILABLE: 'Model servisine ulaşılamadı (Ollama açık mı?).',
  TRUNCATED_OUTPUT: 'Model yanıtı yarıda kaldı.',
  REQUEST_REJECTED: 'Model isteği reddetti (model adı doğru mu?).',
  AUTH: 'Model servisi kimlik doğrulamayı reddetti.',
  RATE_LIMIT: 'Model servisi şu an çok yoğun.',
}

const STATUS_LABELS = {
  SOURCE_EXCERPTS: 'Gerçek kaynak alıntıları · model üretimi değil',
  GENERATED_UNVERIFIED: 'Deneysel model açıklaması · doğrulanmadı',
  NO_EVIDENCE: 'Yeterli kaynak bulunamadı',
  GUIDANCE: 'İlgili video bölümüne dön veya açıklama iste',
  SOURCE_REMOVED: 'Kaynak kaldırıldı',
  CLARIFICATION: 'Bağlamı netleştirelim',
  MODE_NOT_SATISFIED: 'İstenen biçim üretilemedi',
  VISUAL_UNAVAILABLE: 'Görüntü analiz edilemedi',
}

/** Yanıt durumu satırı. Model başarısız olduysa nedenini ve neyin gösterildiğini söyler. */
export function statusLabel(turn) {
  const status = turn?.status
  if (status === 'GENERATION_FAILED_SOURCE_EXCERPTS') {
    const reason = FAILURE_REASONS[turn.generation_failure]
    return `${reason ? `${reason} ` : 'Model açıklaması tamamlanamadı. '}Kaynaktaki ilgili cümleler gösteriliyor, model yorumu değil.`
  }
  if (status === 'INVALID_CITATIONS') return 'Model geçerli kaynak göstermedi; kaynaktaki ilgili cümleler gösteriliyor, model yorumu değil.'
  return STATUS_LABELS[status] || 'Kaynak durumu doğrulanamadı'
}
