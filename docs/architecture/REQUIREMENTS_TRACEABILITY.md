# Gereksinim izlenebilirliği

Durumlar: IMPLEMENTED = bu yerel kapsamda kod + entegrasyon + test kanıtı;
PARTIAL = yalnızca belirtilen alt kapsam; MISSING = ürün davranışı yok.
Öncelik sırası önce mevcut video temeli, sonra öğrenme bağlamı, ortak materyal,
öğretici deneyim ve değerlendirmedir.

- FR-01 / P0 / PARTIAL: VideosModule + MomentSearch ingest; gerçek upload,
  ASR, kare, retry ve kalıcılık testleri mevcut. Metadata köprüsü eklendi.
  100 MB sınırı, senkron link indirme ve kalite kısıtları sürüyor.
- FR-02 / P1 / MISSING: ortak video/PDF/PPTX evidence henüz yok.
  Tasarım: MULTIMODAL_RAG_DESIGN.md. Mevcut iki RAG dalı ayrı çalışır.
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
  çok turlu anlam çözümü yok. CONTEXT_VIDEO_RAG_FIX.md kanıtları açıklar.
- FR-06 / P0 / IMPLEMENTED (kaynağa atlama): transkript/kare/citation →
  player.currentTime. Gerçek browser-run ve progress-run kaynak konumu kanıtı.
  Retrieval'ın her soruyu doğru bulduğu anlamına gelmez.
- FR-07 / P1 / PARTIAL: yerel deneysel açıklama ve kaynak kartları var.
  Model küçük ve matematik hataları gözlendi; öğretici modlar/kalite eşiği eksik.
- FR-08 / P1 / MISSING: cevaba bağlı gerçek TTS/player yok.
- FR-09 / P1 / PARTIAL: responsive player, transkript, kaynaklar, yükleme,
  kaldırma ve gerçek izleme timeline'ı çalışır. Konu haritası/ortak evidence yok.
- FR-10 / P2 / PARTIAL: örnek quiz ekranı var; video tabanlı gerçek quiz,
  kalıcı attempt ve kaynağa bağlı geri bildirim yok; SampleNotice korunuyor.
- NFR güvenlik/gizlilik / PARTIAL: JWT + ders/owner scope, gerçek negatif
  testler, secret/file taraması. Çok kullanıcılı motor servisi auth'ı üretim işi.
- NFR performans / PARTIAL: sıcak progress GET P50/P95 ölçüldü; LLM/ASR ve
  bütün uygulamanın dağılım ölçümleri tamamlanmadı. PERFORMANCE_BENCHMARK.md.
- INN-01..05 / PARTIAL/PLANNED: ana kaynak izleme farkındalığı ve dar
  Prim/Dijkstra çelişki kontrolü var. Genel kavram alignment, öğrenme açığı,
  semantik groundedness ve seçili görsel bölge davranışları eksiktir.
