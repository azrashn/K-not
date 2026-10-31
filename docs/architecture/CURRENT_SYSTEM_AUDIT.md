# K-NOT mevcut sistem incelemesi

Tarih: 31 Ekim 2026. İnceleme başlangıcı: `feature/video-integration`, `6401c29`.
Bu belge geliştirme öncesi başlangıç durumudur; sonraki işler
`docs/development/IMPLEMENTATION_STATUS.md` içinde izlenir. README iddiaları yerine
kaynak kodu, test ve yerel servis çıktıları esas alınmıştır.

## Korunan sınırlar

Mevcut kullanıcı değişiklikleri yok; kullanıcıya ait izlenmeyen AGENTS.md, .codex/
ve iki .agents/skills dizini korunuyor. Kaynak/reset/force-push/volume silme yok.
OpenTutor ve DocsGPT yalnızca salt okunur Docker durumunda görüldü; değiştirilmedi.
Knot UI 5174, Nest 3100, Knot Python AI 8110, MomentSearch 7862; dördü HTTP 200.
Knot MySQL 3306 ve ayrı motor PostgreSQL 15433 / Qdrant 16433 çalışıyor.

## Doğrulanmış yapı

- Frontend: React 19 + Vite + Tailwind, JSX, hash routing. Next.js değildir.
  `src/pages/Workspace.jsx` PDF çalışma alanı, `Videos.jsx` video çalışma alanıdır.
- Backend: NestJS 11; `backend/src/app.module.ts`. JWT global guard, girdi
  doğrulaması, hata zarfı, ders üyeliği ve sahiplik kontrolleri mevcut.
- MySQL/Prisma: User, Course, CourseMembership, Document, ProcessingJob,
  IndexVersion ve Video tabloları. QuizAttempt, WatchProgress, topic/video
  eşleştirmesi başlangıçta yok. Video yalnızca yükleyen kullanıcıya özel.
- PDF: `backend/src/documents/`, `jobs/`, `ai-service/src/knot_ingest/`.
  pypdf 6.17.0, sürümlü chunk/embedding sözleşmesi; persist edilmiş Chroma.
  PDF sayfa/alıntı desteği var; PPTX dosyasının kendisini kabul eden parser yok.
- PDF RAG: `ai-service/src/knot_rag/`: yetkili kapsam, dense + lexical retrieval,
  bütçeli context, kaynak eşleme ve ayrı destek değerlendirmesi. Mock/extractive
  sağlayıcılar gerçek üretici model değildir; test/demoda açıkça etiketlenir.
- Video: Knot VideosModule → hazırlanmış yerel MomentSearch motoru.
  Motor `local/windows-dev`, son değişiklik `2e6b587`. Lisans/NOTICE korunuyor.
  FFmpeg, CPU faster-whisper base, E5 small 384, CLIP 512, Qdrant; cevap için
  ayrı Ollama 11436 / Qwen3-VL 2B Instruct. Model sunucusu ayarları değişmiyor.
- Motor işler: PostgreSQL kalıcı kuyruk + tek yerel worker; ingest/retry/purge
  advisory lock'u. Video yüklenince işlem HTTP isteğinden bağımsız sürer.
  Linkten indirme ise halen en çok 180s senkron; uzun link işi için kalıcı
  indirme job'u ayrı performans açığıdır.

## Gereksinimlerin başlangıç durumu

- FR-01 video yükleme/işleme: PARTIAL. Gerçek video → ASR → timestamp →
  kare/text indeksleri, yeniden açma ve retry mevcut ve önceki gerçek testlerde
  doğrulandı. Tam metadata API/persist edilmiş süre yok; 100 MB bellek sınırı var.
- FR-02 materyaller arası ilişki: MISSING. PDF/Chroma ve video/Qdrant ayrı
  sorgulanıyor. PPTX parser, ortak evidence veya kavram eşleştirmesi yok.
- FR-03 izleme ilerlemesi: MISSING. `Videos.jsx` yalnızca anlık oynatıcı zamanını
  yerel state'te tutuyor. DB'de izlenen aralıklar veya kaldığı yer tutulmuyor.
- FR-04 izlenmemiş konu yönlendirmesi: MISSING. İzleme kaydı ve konu aralığı
  karşılaştırması yok. Erişim hakkı ile öğrenme durumunu birleştirmemek gerekiyor.
- FR-05 bağlamsal soru: MISSING. Video soru DTO'su sadece question alıyor;
  oynatıcı zamanı, konuşma geçmişi ve seçili kare soruya gönderilmiyor.
- FR-06 kaynak anına gitme: IMPLEMENTED. Gerçek Edge testinde transkript,
  kare ve kaynak tıklamaları 47.84s / 10.043s / 40.073s konumuna gitti.
  Kanıtlar `data/video-tests/browser-run.json` (Git dışında).
- FR-07 öğretici açıklama: PARTIAL. Gerçek yerel model cevabı var; küçük modelin
  matematik yöntem/formül hataları gözlendi. `support_confirmed:false`, deneysel
  uyarısı korunuyor. Bir kaynağın varlığı cevap doğruluğu kanıtı değildir.
  Öğretici modlar, semantik destek ölçümü ve takip soruları eksik.
- FR-08 sesli cevap: MISSING. Cevaba bağlı TTS/pause/resume kontrolleri yok.
- FR-09 öğrenme arayüzü: PARTIAL. Gerçek yükleme/player/transkript/kare/QA,
  390px mobil ve erişilebilir etiketler var. Öğrenme ilerlemesi, konu timeline'ı,
  ortak kaynak ve kalıcı video konuşması yok.
- FR-10 quiz/geri bildirim: PARTIAL. `src/pages/Quiz.jsx` akademik örnek
  soru bankasını kullanıyor; açık cevap değerlendirmesi anahtar kelime kuralı.
  Gerçek video tabanlı quiz, kalıcı attempt ve kanıta dayalı video önerisi yok.
- Analitik: PARTIAL. `Analytics.jsx` örnek konu/puan verisini açıkça belirtiyor;
  gerçek video izleme ile bağlı değil. Öğrenme hâkimiyeti ölçülmüş değildir.
- Video ekleme/silme: IMPLEMENTED. Gerçek link ve silme tarayıcı testleri
  geçti. Son referansta gerçek dosya/transkript/kare, motor manifesti ve iki
  Qdrant indeksi temizlendi; başka kullanıcı referansı korundu. Bu incelemede
  kullanıcı videosu silinmedi. `data/video-tests/link-browser-run.json`,
  `deletion-run.json` yerel kanıttır.

## Test ve işletim kanıtı

Bu incelemede `node node_modules/vitest/vitest.mjs run`: 69/69 geçti;
backend `node node_modules/jest/bin/jest.js --config jest.config.js
--selectProjects unit --runInBand`: 59/59 geçti. Bunlar birim/sözleşme testleridir,
gerçek AI kalitesinin ölçümü değildir. Python tam suite ayrıca başlatıldı;
sonucu ilerleme belgesine kaydedilecek, henüz geçti denmiyor.

API suite gerçek MySQL test DB'si oluşturur ve fixture tablolarını temizler.
`backend/test/support/db.ts` eski TABLES listesinde Video yok; yeni ilişkilere
uyarlanmalı. Üretim/yerel kullanıcı DB'sini sıfırlayarak çalıştırılmayacak.
CI yalnızca `.github/workflows/secret-scan.yml` ile gizli bilgi/yasak dosya
kontrolü yapıyor; kapsamlı uygulama test CI'ı başlangıçta yok.

## Ölçülen sınırlar ve ilk karar

Önceki gerçek 414.75s integral videosu: soğuk işleme 52.085s, 42 kare / 19 metin
parçası; yerel cevap örneği 2.352s, restart sonrası 7.404s. Bunlar az sayıda örnek;
P50/P95 veya bütün videolar için performans garantisi değildir. Büyük dosyada
Blob/memory oynatma, 3s liste polling'i ve küçük model kalite sınırı biliniyor.
OCR metin indeksi, görsel bölge QA, semantik konu etiketleri ölçülmüş değil.

İlk yeni ürün dilimi: FR-03 gerçek izlenen aralıkların kullanıcı/video bazında
MySQL'e eklemeli migrasyonla yazılması, atlamanın izleme sayılmaması, kaldığı yere
dönme, görünür ilerleme ve gerçek medya süresi. Mevcut RAG/izin sözleşmeleri
korunacak. Bu veri FR-04/05 için temel olacak; watch kaydı öğrenme kanıtı sayılmayacak.
