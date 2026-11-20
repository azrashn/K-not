# Kalan işler — Unified learning

Bu kayıt tamamlanmamış işleri çalışıyormuş gibi göstermemek içindir.

## Bağlam/kalite düzeltmesi sonrası — 31 Ekim 2026

- **PARTIAL — Vision doğruluğu:** gerçek page/region/video-frame girişi var;
  bildirilen BFS/DFS grafiği güvenilir çözülemedi. CLARIFICATION, görsel çözüm
  başarısı değildir. Yön/kenar/simge/başlangıç çıkarımı farklı belgelerle
  ölçülmeli. Daha büyük model kullanıcı onayı olmadan indirilmemeli.
- **PARTIAL — Quiz semantiği:** v2 kaynak/tek-şık/per-option kör audit çalışır;
  gerçek MCQ ve feedback doğrulandı. Gerçek izlenmiş video span'ının MCQ'su
  reddedildi. Farklı Türkçe derslerde öğretmen/rubrik değerlendirmesi gerekir;
  aynı modelin ikinci geçişi tek doğru cevabın kanıtı değildir. Yeni literal
  MCQ fallback yok; eski sorular silinmeden LEGACY_NOT_REVIEWED görünür.
- **PARTIAL — Background gerçek tarayıcı:** hidden/suspended-gap politikası
  unit testli; headless test masaüstü tab görünürlüğünü kanıtlamaz.
- **MISSING — Offline outbox:** ağ hatası mounted session'da tutulur/retry
  edilir. Hiç sunucuya ulaşmamış gözlemlerin offline refresh/close sonrasında
  diskten garantili yeniden gönderimi yoktur. User/video izolasyonlu outbox,
  sıra/revision ve logout cleanup ayrıca tasarlanmalı.
- **MISSING — PDF text layer:** çıkarılmış gerçek kaynak metninden seçim ve
  görüntüde region seçimi var; özgün canvas'ta karakter koordinatlı seçim yok.
- **PARTIAL — Retrieval/ASR:** çeşitlilik ve tekrar eleme/debug var; text-first
  E5/Chroma lexical guard recall'ı sınırlayabilir. Genel ASR düzeltmesi,
  bağımsız görsel ANN indeksi ve alan benchmark'ı ayrı iş.
- **IMPLEMENTED — P0:** typed viewport, authorized multi-scope/references,
  mesajlık explanation, progress union/timeline/resume/retry, kaynak gezintisi
  ve response_mode. Detaylar CONTEXT_QUALITY_TEST_REPORT.md,755otomatik test.
- Sonraki oturum: `git status`, IMPLEMENTATION_STATUS ve
  CONTEXT_QUALITY_TEST_REPORT; ardından `Start-KnotVideo.ps1`. Private kanıtlar
  ignored data/context-tests altında. Başka uygulamaları veya ilerleme
  kayıtlarını resetleyerek test tekrarlama.

## Ürün deneyimi sonrası öncelikler — 31 Ekim 2026

- Yerinde dosya değiştirme/başarılı materyali yeniden işleme: atomik orijinal+
  indexrevision değişimi, eski kaynak/chat/quiz geçersizleştirme ve başarısız
  işlemde geri dönüş tasarlanmalı. Şimdilik yeni dosya ayrı eklenip doğrulanır,
  eski dosya sonra açık onayla kaldırılır. Başarısız PDF/video retry görünür.
- Genel kavramsal quiz kalitesi ve rubrikli kısa/açık cevap değerlendirmesi.
  Beş soru türü ve kalıcı attempt çalışır; kaynak hatırlama/karşılaştırma ile
  kavramsal öğrenme aynı şey değildir. Eski literal MCQ yaklaşımı sonraki
  context-quality düzeltmesinde kaldırıldı; kaliteyi geçmeyen yeni soru
  yayınlanmaz. Açık uçlu yanıta otomatik puan verilmez.
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
