# Gereksinim izlenebilirliği

Durumlar: IMPLEMENTED = bu yerel kapsamda kod + entegrasyon + test kanıtı;
PARTIAL = yalnızca belirtilen alt kapsam; MISSING = ürün davranışı yok.
Öncelik sırası önce mevcut video temeli, sonra öğrenme bağlamı, ortak materyal,
öğretici deneyim ve değerlendirmedir.

- FR-01 / P0 / PARTIAL: VideosModule + MomentSearch ingest; gerçek upload,
  ASR, kare, retry ve kalıcılık testleri mevcut. Metadata köprüsü eklendi.
  100 MB sınırı, senkron link indirme ve kalite kısıtları sürüyor.
- FR-02 / P1 / PARTIAL: KnowledgeService + unified.py ile ortak PDF/PPTX/TXT/video
  transcript metin indeksi ve aynı cevapta gerçek kaynaklar çalışır. PPTX slide
  ve notes ayrı konumda; görsel/OCR ve bölge QA eksiktir. Yeni /ogrenme varsayılan
  ortak ekrandır; eski özel uçlar geriye uyumluluk için korunur.
- FR-03 / P0 / IMPLEMENTED (medya gözlemi): VideoProgress modeli,
  video-progress service/controller, watch-intervals, useVideoProgress,
  watch-tracker, Videos.jsx. Tests: backend video-progress unit/API,
  frontend watch-tracker/videos, scripts/test-video-progress.cjs.
  Kanıt: data/video-tests/progress-run.json, gerçek MySQL, reload/seek/replay.
  Öğrenme hâkimiyeti ve anti-cheat kapsam dışıdır.
- FR-04 / P0 / IMPLEMENTED (ana kaynak span'ı): VideoLearningService,
  classifyLearning ve gerçek MySQL progress; dört sınıf, guidance/explicit explain,
  owner-bound evidence. learning-video unit/API, engine ve gerçek Edge testleri.
  Toplam yüzde/son konum kullanılmaz; sınıf konu hâkimiyeti değildir.
- FR-05 / P0 / PARTIAL: current_time_ms taşınır; “burada/az önce” gerçek
  transcript span'ına çözülür. Zaman/kanıt yoksa UNKNOWN. Sohbet geçmişiyle
  anlam çözümü unified yolda son soru/cevapla sınırlı uygulanır; kalıcı sohbet
  ve uzun history çözümü yok. LEARNING_CONTEXT_MODEL.md sınırları açıklar.
- FR-06 / P0 / IMPLEMENTED (kaynağa atlama): transkript/kare/citation →
  player.currentTime. Gerçek browser-run ve progress-run kaynak konumu kanıtı.
  Retrieval'ın her soruyu doğru bulduğu anlamına gelmez.
- FR-07 / P1 / PARTIAL: yerel deneysel açıklama ve kaynak kartları var.
  Model küçük ve matematik hataları gözlendi; öğretici modlar/kalite eşiği eksik.
- FR-08 / P1 / PARTIAL: görüntülenen açıklama için yalnız yerel Türkçe browser
  voice varsa play/pause/resume ve hata modu var. Ses kalitesi/taşınabilir TTS
  motoru doğrulanmış sayılmaz; yoksa yazılı cevap devam eder.
- FR-09 / P1 / PARTIAL: responsive player, transkript, kaynaklar, yükleme,
  kaldırma ve gerçek izleme timeline'ı çalışır. Konu haritası/ortak evidence yok.
- FR-10 / P2 / PARTIAL: birleşik cevap kaynağından literal cloze pratik ve
  kaynak bağlantılı geri bildirim var. Kalıcı attempt/rubrik/kavramsal değerlendirme
  yok. Eski örnek Quiz ekranının SampleNotice bildirimi korunur.
- NFR güvenlik/gizlilik / PARTIAL: JWT + ders/owner scope, gerçek negatif
  testler, secret/file taraması. Çok kullanıcılı motor servisi auth'ı üretim işi.
- NFR performans / PARTIAL: sıcak progress GET P50/P95 ölçüldü; LLM/ASR ve
  bütün uygulamanın dağılım ölçümleri tamamlanmadı. PERFORMANCE_BENCHMARK.md.
- INN-01..05 / PARTIAL/PLANNED: ana kaynak izleme farkındalığı ve dar
  Prim/Dijkstra çelişki kontrolü var. Genel kavram alignment, öğrenme açığı,
  semantik groundedness ve seçili görsel bölge davranışları eksiktir.
