# Kalan işler — Unified learning

Bu kayıt tamamlanmamış işleri çalışıyormuş gibi göstermemek içindir.

## İlk öncelik

- Yeni birleşik yolu demo materyalleri dışında etiketli gerçek ders setleriyle
  değerlendirmek; semantic-only abstention nedeniyle eşanlamlı/çok dilli recall.
- Küçük modelin kesilmiş/tekrarlayan cevapları; gerçek alıntı fallback'i korunmalı.
- Projection için kalıcı job/status/retry. Şimdi ilk soru değişen metni indeksler;
  mevcut PDF/video ASR iş kuyruğu korunur, PPTX/TXT extraction senkrondur.
- Büyük kurs profili (15 PDF/12 PPTX/8 video) dağılım ölçümü ve streaming.
- Kalıcı/gözden geçirilebilir konu ilişkileri; SAME_TOPIC/PREREQUISITE/EXAMPLE_OF
  çıkarımları ve genel semantic conflict/entailment doğrulaması.
- Gerçek transcript revision/edit/reprocess modeli. Orijinal ve düzeltilmiş
  metin ayrı kalmalı; sürüm değişmeli. Var olan kaynak hash'i değiştirilmeden
  transcript düzeltmesi yayınlanmamalı.

## Ürün genişletmeleri

- PPTX özgün görsel slayt render'ı ve diyagram/OCR; şu an slayt metni/notu
  konumuyla açılır, özgün PPTX indirilebilir. Renk/yerleşim yeniden üretilmez.
- Seçili video karesi/bölgesiyle unified QA. Mevcut kare çıkarma korunur;
  yeni ortak indeks metin kanalıdır, tam görsel anlayış değildir.
- TTS: yalnız yerel Türkçe browser voice mevcutsa play/pause/resume çalışır.
  İlk turlarda voice listesi boştu; son Edge turunda 1 voice ve gerçek STARTED,
  pause/resume doğrulandı. Taşınabilir motor, telaffuz/ses kalite testi gerekiyor.
- Kalıcı quiz/attempt, rubrikli kavramsal değerlendirme, kapsam/zorluk seçimi,
  çok materyalli gerçek soru üretimi. Mevcut literal cloze pratik bunlar değildir.
- Kalıcı sohbet, konu seçimi ve daha uzun follow-up referans çözümü.
- Eski PDF/video özel QA rotalarının yeni sözleşmeye tam taşınması. Varsayılan
  ders çalışma alanı unified'dır; geriye uyumluluk rotaları şimdilik korunur.
  Eski video API'sindeki dar algoritma denetimi unified yolda kullanılmaz;
  genel kalite doğrulandığında ayrı migration ile kaldırılmalı.
- Çok replica kilitleri, projection koleksiyonu emekliliği/GC, tam üretim ağı
  ve servis kimliği; mevcut localhost geliştirme profilini internet servisi sayma.

OpenTutor/DocsGPT entegrasyonu yoktur; kaynakları, servisleri ve modelleri değiştirilmez.
