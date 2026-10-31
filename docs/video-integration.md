# Knot video — ilk çalışan yerel sürüm

Dal: `feature/video-integration`. Temel commit: `2fdc005`.

## Açma ve kullanım

Mevcut Knot bağımlılıkları ve yerel ortam dosyaları hazır olmalıdır. Yeni global
Python/Node paketi kurulmaz. Docker Desktop açıkken repo kökünden:

```powershell
.\scripts\Start-KnotVideo.ps1
```

Arayüz `http://127.0.0.1:5174/#/dersler`. Kendi hesabınla giriş yap, bir ders aç,
**Ders videoları** → **Video yükle**. MP4 / WebM, en fazla 100 MB.
Alternatif: **YouTube veya Drive bağlantısı** alanına video URL'sini yapıştır,
**Bağlantıdan ekle** düğmesine bas. Drive için “Bağlantıya sahip herkes” erişimi
gerekir; hesapla Drive seçicisi bu sürümde yok. Yalnızca tek video alınır;
klasör/playlist, giriş isteyen veya canlı videolar desteklenmez. Bilinen süresi
iki saati aşan ve 100 MB üstü dosyalar reddedilir. İndirme en fazla üç dakika;
indirme bitene kadar sayfayı açık tut. Ardından normal işleme arka planda sürer.
YouTube bot/erişim engeli halinde dosyayı kendin indirip yükleyebilirsin.
İşleme bitince video, zaman damgalı transkript ve kareler açılır. Transkript,
kare veya cevap kaynağına tıklamak oynatıcıyı ilgili zamana götürür.
Sorular yalnızca seçili videoda aranır. Cevaplar deneysel olarak etiketlenir.

`Stop-KnotVideo.ps1` yalnızca bu profilin kaydı ve süreç başlangıç saati
doğrulanan frontend/backend/AI süreçlerini durdurur. MySQL, MomentSearch ve
volume'lar korunur. Genel `dev.ps1 -Stop` video profilinin durdurucusu değildir.

Geliştirme portları: Knot UI 5174, NestJS 3100, Python AI 8110. Mevcut `.env`
dosyaları yeniden yazılmaz. Özel başlatıcı yalnızca alt süreç ortamını ayarlar.
OpenTutor 3001/8100 ve DocsGPT 5173/7091 kullanılmaz veya durdurulmaz.

## Video motoru bağımlılığı

Bu ilk sürüm mevcut hazırlanmış yerel MomentSearch kurulumunu kullanır:
`C:\Users\ASUS\Documents\Codex\MomentSearch`, `local/windows-dev` dalı.
Knot kaynak koduna model veya üçüncü taraf repo kopyalanmadı; REST adaptörü var.
`VIDEO_SERVICE_URL` NestJS tarafından okunur, tarayıcıya gönderilmez.

Motor 7862'de, kendine ait Qdrant 16433, PostgreSQL 15433 ve Ollama 11436 ile
çalışır. Whisper base, E5 small, CLIP ve Qwen3-VL 2B Instruct yereldir;
ücretli API çağrısı yapılmaz. Motorun bağımsız başlatıcısı çalıştırılır.

Standart bulut odaklı upstream MomentSearch doğrudan tak-çalıştır değildir:
önceki Windows yerel runner/ASR/embedding profilimiz gerekir. Ek köprü ucu
`GET /api/local/frames/{video_id}` gerçek `(idx, ms)` çiftlerini okur. Bu küçük
ek kaynak değişikliği MomentSearch reposunda `c53a8e9` commit'inde sürümlenir. Başka makinede
kurulum için hem Knot dalı hem hazırlanmış motor profili gerekir; otomatik
kurulumcu veya yayımlanmış Docker dağıtımı bu sürümün parçası değildir.
YouTube/Drive indiricisi ve konuşmasız video düzeltmesi motorun `7c59ecf`
commit'indedir; bağlantı özelliği için bu sürüm de gereklidir.

## Yetki ve veri sözleşmesi

Tarayıcı yalnızca `/api` üzerinden NestJS'ye konuşur. JWT hiçbir video URL'sine
eklenmez. Video dosyası ve kareler kimlik doğrulamalı istekle Blob'a alınır;
nesne URL'leri seçim değişince/ekran kapanınca iptal edilir. 100 MB sınırı bu
ilk sürümün bellekte yükleme/oynatma yaklaşımını sınırlar. Büyük video için
parçalı yükleme ve yetkili Range oynatma bir sonraki iştir.

Yeni MySQL `Video` tablosu `courseId`, `ownerId`, hash ve motor kimliğini tutar.
Ekleme migrasyonu yalnızca bu tabloyu ve ilişkileri oluşturur; eski belge ve
indeks tablolarını sıfırlamaz. Aynı kullanıcı/ders/hash üçlüsü yeniden yüklemeyi
tek kayda indirir. Motorun aynı fiziksel dosyayı paylaşması Knot yetkisi vermez.
Knot'taki her okuma/sorgu ders üyeliği VE yükleyen kullanıcıyla sınırlandırılır.
Ders genelinde paylaşım ve aktif işi iptal etme uçları henüz sunulmaz.

## Kalıcı video kaldırma

Kartın **Kaldır** düğmesi inline onay açar: **Kalıcı olarak sil** veya **Vazgeç**.
`DELETE /courses/:courseId/videos/:videoId` ders üyeliği ve yükleyen sahipliğiyle
korunur. Son referansta kaynak video, transkript, kareler, iki Qdrant indeksindeki
kayıtlar, motor manifesti ve Knot kaydı temizlenir. Yükleme için seçilmiş orijinal
bilgisayar dosyası kapsam dışıdır; uygulamanın sakladığı kopya kaldırılır.

Aynı fiziksel dosyayı başka bir Knot kaydı veya motor oturumu kullanıyorsa yalnızca
seçili Knot kaydı kaldırılır; diğer kaydın verisi korunur ve bu durum ekranda yazılır.
Yükleme ve silme aynı hash için tek Nest sürecinde sıraya alınır. Bekleyen dosya da
paylaşılır; ikinci upload'ın motor dedup aşamasında kopuk kayıt oluşturması önlenir.
Çok Nest replikalı dağıtımdan önce bu kuyruk dağıtık kilit/outbox'a taşınmalıdır.

Motor ingest/retry/silme arasında PostgreSQL advisory lock kullanır. Aktif işlemde
motor sürümü `2e6b587` veya sonrası gerekir (API ve worker birlikte güncellenir).
409 ve bekleme mesajı döner; işlem bittikten sonra yeniden kaldırılabilir. Bekleyen
iş silinirse worker manifesti yeniden kontrol eder. Temizleme başarısızsa başarı
mesajı verilmez ve Knot kaydı korunur. Motor silinip Knot kaydı kalırsa tekrar DELETE
404'ü tamamlanmış motor temizliği kabul eder; UI bu kaydı kaldırılabilir biçimde listeler.
Silinen seçimin oynatıcısı ve Blob URL'si temizlenir; eski poll kartı geri getiremez.

Gerçek test: `node scripts/test-video-delete.cjs data/video-tests/deletion-test.mp4`.
Yalnızca yeni, test için ayrılmış 18s integral kesiti kullanıldı. İki özel kullanıcı
aynı dosyayı ekledi: 2 kare + 1 gerçek ASR transkript parçası, disk üzerinde 4 dosya.
İlk silme ikinci kullanıcıyı korudu. Gerçek PG lease ile aktif iş testi 409 verdi.
Son kullanıcı Edge'de onayı iptal etti, sonra onaylayarak sildi. Sonuç: MySQL kayıtları
yok, motor manifesti yok, video dizini yok, dosya listesi boş, iki Qdrant sayacı da 0.
Önceden var olan tüm Video kayıtları korundu; 390px mobilde taşma ve JS hatası yok.
Kanıtlar Git dışı `data/video-tests/deletion-run.json`, `video-delete-confirm.png` ve
`video-delete-complete.png`. İlk iki test aracı hatası (ayrı DB ortamı, aynı adlı
kart seçicisi) düzeltildi; yalnızca bu denemelerin oluşturduğu kayıtlar temizlendi.
Bu test yeni bir LLM yanıt kalitesi testi değildir. Başarı yalnızca son geçen turdan raporlanır.

`POST /courses/:courseId/videos/import-link {url}`: JWT ve ders üyeliğiyle korunur.
Sunucu YouTube/Drive video kimliğini ayıklar, izinli sabit HTTPS URL'si kurar;
yerel adresler ve benzer alan adları indiriciye verilmez. Kullanıcı başına tek
etkin indirme, motor genelinde tek indirme; 100 MB akış sınırı hem indirme hem
Knot tarafında uygulanır. Ham motor hatası veya yerel dosya yolu gösterilmez.
Alınan video mevcut özel yükleme/dedup yolunu izler; kaynak URL veya motor ID'si
yetki yerine geçmez. Drive hesabı çerezi, Google OAuth veya ücretli API kullanılmaz.
Motorun `POST /api/local/import-file` eklentisi ve yt-dlp-ejs 0.8.0 gerekir;
motorun `requirements.windows.lock.txt` dosyasında kilitlidir, Node zaten kuruludur.

Uçlar (`/courses/:courseId/videos` altında):

- `GET /`: özel video listesi ve güncel motor durumları.
- `POST /`: `file` alanıyla multipart yükleme; üyelik kontrolü gövde okunmadan yapılır.
- `POST /:videoId/retry`: yalnızca başarısız iş için yeniden deneme.
- `GET /:videoId/transcript`: `{chunks:[{text,start_seconds,end_seconds}]}`.
- `GET /:videoId/frames`: zaman sıralı `{frames:[{index,timestamp_ms}]}`.
- `GET /:videoId/file`, `GET /:videoId/frames/:index`: kimlik doğrulamalı medya.
- `POST /:videoId/answers`: `{question}`; kapsam sunucuda tek yetkili video olarak kurulur.

Cevap: `answer`, `llm_used`, `experimental:true`, `support_confirmed:false`,
`note`, `citations:[{n,video_id,timestamp_ms,start_seconds,end_seconds,frame_index,transcript}]`.
Motorun başka videoya ait kaynak döndürmesi işlemi kapalı biçimde reddettirir.
İç URL ve engine kimlikleri tarayıcıya geçirilmez. Videoda bir kaynak bulunması
cevabı otomatik olarak SIKI veya doğrulanmış yapmaz. Mevcut PDF RAG/kanıt
sözleşmesi değiştirilmedi; PDF ve video ortak sorgusu henüz yoktur.

## Doğrulama

Frontend testleri `npm test`, backend unit `cd backend; npm run test:unit`.
Video testleri sözleşme/erişim regresyonlarında kontrollü fake kullanır; bunlar
gerçek AI testi değildir. Genel seed testinde mevcut sahte Prisma nesnesinin
eksik `update` metodu tamamlandı; gerçek seed/hesap parolaları değiştirilmedi.

Gerçek test (sahte model yok):

```powershell
node scripts/test-video-local.cjs <yerel-mp4-yolu>
```

Betik yalnızca kendi test dersini ve iki hesabı ekler; mevcut hesapları, dersleri
ve veritabanını sıfırlamaz. Parolalar repo DIŞINDA geçici bir dosyada tutulur ve
ekrana yazılmaz. Hesap dosyasının yolu test sonunda belirtilir. Kanıtlar yerel
`data/video-tests/last-run.json` ve `logs/video-*-e2e.log` içinde, Git dışındadır.

414,75 saniyelik gerçek integral videosuyla önbelleksiz testte yükleme 423 ms,
hazır duruma ulaşma 52.085 ms; 42 kare, 19 transkript parçası. Yerel model cevabı
2.352 ms, 6 zamanlı kaynak, `support_confirmed:false`. Önbellekli ayrı testte
kayıt yaklaşık 157 ms idi; bunu yeni video işleme süresi olarak göstermiyoruz.
Oturumsuz erişim 401; aynı dersteki diğer öğrencinin listelemesi boş, transkript,
dosya, kare ve soru uçları 404. Dosya/kareler gerçekten okunup doğrulandı.

İlk denemelerde yakalanıp düzeltilen hatalar: kare rotasındaki `index` alanının
DTO'da eksik olması (422), motorun köprü endpoint'indeki eksik vector_store
importu (503), kare listesinin zaman sıralı olmaması. Servis hataları kullanıcıya
gösterilir; soru hataları periyodik liste yenilemesiyle gizlenmez.

Son gerçek tarayıcı testi: `node scripts/test-video-browser.cjs`. Kurulu Edge ile
geçici, bağımsız tarayıcı oturumunda gerçek kullanıcı girişi, dosya yükleme/dedup,
transkript/kare/kaynak tıklaması ve soru-cevap test edildi. Transkript tıklaması
47,84s, kare 10,043s, cevap kaynağı 40,073s konumuna gitti. 390px mobil görünümde
yatay taşma ve JavaScript hatası yok. Bu test akışın çalışmasını doğrular; model
cevabının matematiksel doğruluğunu kanıtlamaz. Kanıt: `data/video-tests/browser-run.json`,
`knot-video-desktop.png`, `knot-video-mobile.png`; tamamı yerel ve Git dışında.
Ön yüz 69, backend unit 59 test geçti. Hedef lint'te iki state-in-effect uyarısı
kalır; derlemeleri engellemez. Genel lint önceki skill/Quiz uyarılarını da içerir.

31 Ekim bağlantı testi: `node scripts/test-video-links.cjs` gerçek Edge oturumunda
Drive ve YouTube eklemeyi doğruladı. Yerel rapor `data/video-tests/link-browser-run.json`.
Drive Big Buck Bunny kesiti 45,047s / 10.294.477 byte / 5 kare; YouTube resmi Blender
Big Buck Bunny videosu 634,578s / 28.523.658 byte / 48 kare. İkisinde de konuşma
algılanmadı: 0 transkript parçası açıkça gösterildi, sahte metin üretilmedi.
Kare indeksleri ve oynatıcı gerçek dosyadan doğrulandı. Sessiz/konuşmasız videonun
transkript eksikliğini 503 gibi gösteren eski motor davranışı da düzeltildi.
Başka kullanıcı dosyayı okuyamadı (404), oturumsuz import 401, izinsiz URL 422.
390px mobil genişlikte taşma ve JavaScript hatası yok. Drive 7,723s / YouTube
16,514s süreleri başarılı tarayıcı turuna aittir; Drive daha önce indekslendiği
için bu sayılar her yeni videonun işleme performansı vaadi değildir.
Bu test yeni bir konuşma/LLM kalite testi değildir; önceki integral testi ayrı kalır.
Motor regresyonları yerel FFmpeg PATH profiliyle 5/5 geçti; ilk profilsiz deneme
FFmpeg bulunamadığı için başarısızdı. Global bir bağımlılık değiştirilmedi.

## İzleme farkında soru-cevap düzeltmesi — 31 Ekim 2026

Motorun hazırlanmış commit'i **7abba5b** gerekir. Soru artık aktif zamanı taşır;
backend kendi MySQL izleme aralıklarını gerçek kaynak span'ıyla karşılaştırır.
İzlenmemiş/kısmi/bilinmeyende önce yönlendirme, ardından “İlgili bölüme git” ve
“Şimdi açıkla” vardır. Kaynak seçimi kullanıcıya bağlıdır; timestamp yoksa
uydurulmaz. Prim/Dijkstra kaynak çelişkileri dar regresyon kontrolüyle belirtilir;
doğrulanmış dış bilgi video alıntısından ayrı gösterilir. Genel doğruluk çözülmedi.
Erken kaynak tıklaması metadata hazır olunca uygulanır; eski video Blob'u yeni
seçimde oynatılmaz. Yeni model/ücretli API/migrasyon yok. Güncel 692 otomatik
test, PDF E2E 16/16 adım ve üç gerçek video testi için docs/testing/EVALUATION_RESULTS.md;
kök neden/fonksiyonlar için docs/development/CONTEXT_VIDEO_RAG_FIX.md.

## Kalite sınırları

Bu bir çalışan entegrasyon MVP'sidir. Küçük Türkçe ASR matematik terimlerini
bozabilir, 2B görsel model yanlış yöntem veya katsayı söyleyebilir. Önceki gerçek
kalite testlerinde böyle hatalar gözlendi ve çözülmüş kabul edilmiyor.
Tam OCR metin indeksi, slayt geçiş tespiti, seçili kare/bölge QA, quiz, ortak
PDF/video sorgusu ve üretim düzeyi çok kullanıcılı motor izolasyonu sonraki işlerdir.
Motor yalnızca yerelde kullanılmalıdır. Knot, motorun kendi localhost arayüzünü
üretim erişim sınırı hâline getirmez; uzaktaki dağıtımda motorun da ağ ve servis
kimlik doğrulamasıyla korunması gerekir.
