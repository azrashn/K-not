# K-NOT geliştirme ilerlemesi

Son güncelleme: 31 Ekim 2026. Dal: feature/video-integration.
Başlangıç commit'i: 6401c29. Ana talep: video merkezli, bağlam ve öğrenme
durumu farkında akademik asistan. Bu dosya sonraki oturumun giriş noktasıdır.

## Son tamamlanan düzeltme — bağlama ve izlemeye bağlı video QA

31 Ekim kritik hata talebi, 769941a üzerine uygulandı. Ayrıntılı kök neden,
dosya/fonksiyonlar, istenen 10 senaryo ve sınırlar:
[CONTEXT_VIDEO_RAG_FIX.md](CONTEXT_VIDEO_RAG_FIX.md).

- Eski QA ilerlemeyi hiç okumuyordu. Yeni VideoLearningService kaynak bulur,
  MySQL'den ilgili kullanıcı/video aralıklarını yeniden okur, ana kaynak span'ı
  için WATCHED / PARTIALLY_WATCHED / UNWATCHED / UNKNOWN hesaplar.
- İzlenmemiş/kısmi/bilinmeyen kaynakta otomatik LLM çağrısı yapılmaz. Gerçek
  timestamp'e giden “İlgili bölüme git” ve kaynaklı “Şimdi açıkla” çalışır.
  WATCHED açıklamaya geçebilir; kaynak çelişkisi ayrıca engellenir.
- current_time_ms “burada/az önce” bağlamına taşınır; kayıtlı aralıklar
  tarayıcıdan kabul edilmez. Evidence seçimi kullanıcı/ders/video/soruya bağlıdır.
- Prim kaynağının kendi ASR metninde yanlış shortest-path tanımı bulundu.
  Dar Prim/Dijkstra kontrolü ve video alıntısından ayrılan doğrulanmış başvuru
  eklendi. ASR ile özgün konuşmanın hangisinin hatalı olduğu kesinleştirilmedi.
- Gerçek tarayıcı regresyonunun bulduğu erken kaynak tıklaması da düzeltildi:
  dosya henüz hazır değilse seek saklanır ve metadata yüklenince uygulanır.
- Yeni model/paket/servis/migrasyon yok. Motor gereken commit: **7abba5b**,
  local/windows-dev. OpenTutor/DocsGPT ve model ayarları değiştirilmedi.

Son otomatik doğrulama: frontend **77/77**, Nest unit **91/91**, izole gerçek
MySQL/fake-AI API **95/95**, Knot Python **402/402**, motor **26/26** ve gerçek
Python/MySQL entegrasyonu **1/1**: toplam **692**. Ayrıca mevcut PDF tarayıcı
E2E **16/16 adım** geçti. Frontend/backend build ve backend typecheck geçti. API forceExit,
39 Python deprecation, mevcut lint/bundle uyarıları sürüyor; gizlenmedi.

Gerçek servis/Edge testleri: test-learning-video.cjs, test-video-browser.cjs,
test-video-progress.cjs geçti. Temiz integral kaynağında gerçek yerel model
47.840–68.700s alıntısı ile açıklama verdi: ilk tur 4.224s, sıcak tekrar 0.857s;
bu iki örnek performans garantisi veya doğruluk puanı değildir. Prim hatalı
kaynağında model çağrılmadan SOURCE_CONFLICT ve ayrı MST başvurusu gösterildi.
Mobil 390px taşma/JS hatası yok. Bildirilen asıl videonun ilerlemesi önce/sonra
aynı kaldı; sınıflandırma senaryoları ayrı özel test video kayıtlarında çalıştı.
Kanıtlar Git dışı data/video-tests/learning-run.json, browser-run.json,
progress-run.json ve learning-*.png. Komutlar EVALUATION_RESULTS.md'de.
Eski PDF E2E betiğinin Windows'taki npx/head bağımlılıkları yerel Node CLI/dosya
okumasıyla düzeltildi. Test runner --integration/--e2e ile de ayrı boş şema
kurar; mevcut PDF kullanıcı/veritabanı değiştirilmez. Bunlar test altyapısıdır.

FR-04 ana kaynak kapsamıyla uygulanmıştır. FR-05 aktif zaman bağlamı uygulanmış,
sohbet geçmişiyle anlam çözümü eksiktir. Genel kaynak doğruluk kontrolü, görsel
bölge QA, ortak materyal/TTS/quiz bu düzeltmenin parçası değildir. Aşağıdaki
başlangıç kayıtları tarihseldir; güncel sonuç ve öncelik bu bölümdür.

## Önce okunacaklar

1. docs/architecture/CURRENT_SYSTEM_AUDIT.md — kod değiştirmeden yapılan inceleme.
2. Bu dosyadaki son doğrulama ve sonraki adım.
3. docs/video-integration.md — çalışan Windows profili ve sınırları.

## Tamamlanan başlangıç doğrulaması

- Repo/branch ve kullanıcı dosyaları incelendi, korunuyor.
- Başlangıçta frontend 69/69, Nest unit 59/59 geçti. Python suite'in ilk
  sonucu ve düzeltilmiş son sonucu aşağıdaki doğrulama kaydında ayrılır.
- UI 5174, Nest 3100, Python 8110, MomentSearch 7862 HTTP 200.
- PDF/video çalışıyor; quiz ve analitiğin örnek kısımları açıkça ayrıldı.
- Audit ilk yeni dosya olarak oluşturuldu. Ürün kodu henüz değiştirilmedi.

## Tamamlanan ilk yeni ürün dilimi — FR-03

FR-03: gerçek video metadata/süre; kullanıcı-video bazlı izlenen aralıklar ve
son konum; interval union + eşzamanlı yazma koruması; seek/pause/rate/visibility
olayları; kaldığı yere dönme; birim ve gerçek tarayıcı/persistence testleri.
Yeni paket veya büyük model gerekmiyor. Eklemeli migrasyon; mevcut veriler silinmez.

Uygulandı: Video.durationMs + VideoProgress modeli ve migrasyon; scoped GET/PUT
progress API; watch-intervals ve video-progress service/controller; tarayıcıda
watch-tracker ve useVideoProgress; gerçek izleme çizgisi ve kaldığı yere dönme.
Motor metadata köprüsü gerçek FFprobe dosya bilgisini verir. Sıcak GET P50 7.02ms,
P95 10.79ms (30 örnek). Modeller bu okuma için yüklenmez.

Son başarılı gerçek Edge testi: 3.400s + 3.402s ayrı izleme, 96.6s atlama boşluğu
izlenmemiş; toplam 6.802s, replay toplamı artırmadı; reload sonrası konum 100s, revision 8.
390px mobilde taşma veya JS hatası yok. Kanıt: data/video-tests/progress-run.json.
Son tur ayrıca gerçek HTTP yüklemesinde Türkçe video adının korunduğunu doğruladı.
Önceden mevcut ders/video ilerlemeleri kullanılmadı; ayrı demo dersi eklendi.

Son otomatik sonuçlar: frontend 74/74, Nest unit 76/76, gerçek MySQL/fake-AI
API 87/87, Knot Python 402/402, motor 11/11. Frontend/backend derlemeleri ve
backend typecheck geçti. Yeni runner `node scripts/test-backend-api.cjs` her
seferinde ayrı test şeması ve sınırlı test kullanıcısı üretir. Yalnızca yeni
progress API suite'i taze şemada tekrar 5/5 doğrulandı. Test şemaları sentetiktir.

## Bulunan ve giderilen sorunlar

- Windows symlink testi WinError1314: güvenlik ayarı/privilege değiştirilmedi;
  aynı gerçek path escape kontrolü Windows junction ile çalıştırıldı. 402 test geçti.
- PDF boyut limiti: destroyed output stream, Multer callback'ini tamamlamıyor ve
  istek asılı kalıyordu. close+temp cleanup sonrası callback settle ediliyor.
  Aynı mevcut 413/partial-file testi artık geçiyor; limit yükseltilmedi.
- Türkçe video adı: Multer Latin1 varsayımı; UTF-8 param charset ve test eklendi.
- Eski API test temizliği Video/VideoProgress'i bilmiyordu; FK sırası düzeltildi,
  test DB adı ve client kökeni sınırı eklendi. Yerel kullanıcı DB'si sıfırlanmadı.
- Tam API testleri ilk root/bağlantı denemesinde engellendi; üretim verisine
  yönlendirilmedi. İzole şema yetkili kullanıcıyla test edildi. Son 87 test geçti.
- API runner Jest çıkışı için forceExit kullanıyor; açık handle araştırması ayrı
  teknik borçtur. Başarılı test, temiz uygulama shutdown ölçümü sayılmaz.
- Hedef frontend lint: hata yok, 3 set-state-in-effect uyarısı (2 var olan video
  effect'i, 1 yeni progress effect reset'i). Suppression eklenmedi. Üretim
  frontend build'inde büyük bundle uyarısı da sürüyor; render dağılımı ölçülmedi.

## Bir sonraki somut adım

Bu kritik düzeltme tamamlandı; bu turda yeni özellik eklenmez. Sonraki dilimde
önce gerçek referans sorularla retrieval/ASR/cevap doğruluğu ölçülmeli. Dar
Prim/Dijkstra koruması genel doğruluk çözümü sayılmamalı. Sohbet geçmişiyle
bağlam çözümü ve FR-02 ortak materyal ayrı iş olarak planlanmalı.

## Teknik kararlar

- Nest/MySQL + mevcut Python ve MomentSearch sınırları korunur; yeni servis yok.
- İzleme, zaman aralığı birleşimiyle ölçülür. Son konum izlenen süre değildir.
- Süre istemciden güvenilir kabul edilmez; FFprobe ile motorun dosyasından alınır.
- İzleme kaydı yalnızca medya oynatım gözlemidir; öğrenme veya dikkat kanıtı değildir.
- İzlenmemiş bilgiye erişim engellenmez. Kaynak yoksa modelin tamamlaması istenmez.
- Özel video ve ders üyeliği bütün yeni uçlarda korunur.
- Motor kaynak/açıklama commit'i: `7abba5b` (local/windows-dev). Knot'un bu sürümü
  o hazırlanmış motoru gerektirir; model ve lisans bildirimleri değişmedi.

## Açık kalanlar

FR-05 sohbet geçmişi, genel kaynak doğruluğu; FR-02 ortak PDF/video/PPTX;
FR-07 öğretici modlar ve kalite değerlendirmesi; FR-08 TTS;
FR-10 gerçek video quiz/kalıcı değerlendirme; kalıcı indirme job'u, Range oynatma,
tam uygulama CI'ı ve çok replikada asset kilidi. Bunlar tamamlanmış sayılmaz.

## Devam etmek için

1. `git status`, bu dosya ve CURRENT_SYSTEM_AUDIT.md ile başla; kullanıcıya ait
   AGENTS.md/.codex/.agents dosyalarını sahipleme veya stage etme.
2. Docker açıkken scripts/Start-KnotVideo.ps1; 5174/3100/8110/7862'yi doğrula.
   OpenTutor/DocsGPT servislerine dokunma. Eski dev.ps1 -Stop'u kullanma.
3. Çalışan FR-03/04 ve aktif zaman bağlamını koru. İzleme tablosu
   öğrenme puanı değildir. Yeni büyük model veya ücretli API için mevcut izin yok.
4. Her yeni dilimden sonra bu kaydı, traceability ve test sonuçlarını güncelle.

## Doğrulama kaydı

Her dilimde komut, veri, beklenen/gerçek sonuç ve sınır burada veya bağlantılı
test belgesinde tutulacak. Öğrenci materyali, parola, token ve ham LLM içeriği
Git'e/loglara eklenmez. Gerçek test kanıtları data/video-tests içinde Git dışıdır.
