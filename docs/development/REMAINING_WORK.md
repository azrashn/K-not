# Kalan işler — Unified learning

Bu kayıt tamamlanmamış işleri çalışıyormuş gibi göstermemek içindir.

## Ürün deneyimi sonrası öncelikler — 31 Ekim 2026

- Yerinde dosya değiştirme/başarılı materyali yeniden işleme: atomik orijinal+
  indexrevision değişimi, eski kaynak/chat/quiz geçersizleştirme ve başarısız
  işlemde geri dönüş tasarlanmalı. Şimdilik yeni dosya ayrı eklenip doğrulanır,
  eski dosya sonra açık onayla kaldırılır. Başarısız PDF/video retry görünür.
- Genel kavramsal quiz kalitesi ve rubrikli kısa/açık cevap değerlendirmesi.
  Beş soru türü ve kalıcı attempt çalışır; kaynak hatırlama/karşılaştırma ile
  kavramsal öğrenme aynı şey değildir. Doğrulanamayan model MCQ'sunda açık
  etiketli literal soru var. Açık uçlu yanıta otomatik puan verilmez.
- Türkçe sesin telaffuz/doğallık/ilk-ses ölçümü. Yeni üstteki kontroller ve
  gerçek Edge start/pause/resume/stop/replay geçti; kalite artışı ölçülmedi.
  Piper Türkçe model kartının CC BY-NC-SA veri lisansı ile depo MIT etiketinin
  farkı çözülmeden koşulsuz ürün bileşeni sayılmamalı. Araştırma ayrı raporda.
- Öğretim tahtası: ayrı gelecek aşama, mimarisi FUTURE_TEACHING_BOARD.md.
- Streaming/iptal, giriş paketi code-splitting, fontparitesi/uzunPDF/görsel
  sunum kabul seti, büyük ders profili performans testi ve işlem kilitlerinin
  çoklu süreçte kalıcı/dağıtık karşılığı.
- Yeni ürün ekranında gerçek YouTube/Drive ağ indirme turu ayrıca yapılmalı;
  link akışı ve önceki adaptör güvenlik/regresyonları korunmuştur.

Tamamlanan ve artık aşağıdaki eski listede kalanlar: özgünPDF/PPTXrender,
kalıcısohbet, kalıcıquiz/attempt, gerçekHome/Analytics, kaynaklıtekrardöngüsü.
Aşağıdaki liste önceki unified aşamasının daha geniş araştırma kapsamıdır.

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
