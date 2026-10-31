# Sonuçlar ve ölçülmeyenler

## Son kritik video QA düzeltmesi — 31 Ekim 2026

Önceki sayılar aşağıda tarihsel kayıt olarak korunur. Güncel regresyon:

- `npm test -- --reporter=dot`: frontend 77/77, 9 dosya; erken seek,
  guidance/explicit explain ve UNKNOWN dahil. Son tur 18.28s.
- Backend `npm run test:unit -- --runInBand`: 91/91. Kaynak kapsamı,
  interval union sınıfları, private evidence ve kavram kontrolleri.
- `node scripts/test-backend-api.cjs`: 95/95, 9 suite, 63.341s.
  Her tur ayrı sentetik MySQL şeması/hesap; AI boundary fake.
- Knot Python tam pytest suite: 402/402, 44.98s, 39 mevcut deprecation.
- `node scripts/test-backend-api.cjs --integration`: 1/1, 8.227s; gerçek
  MySQL + ayrı gerçek Python/Chroma callback/ingest/QA, hashing embedding ve
  extractive baseline. Gerçek üretken LLM testi diye sunulmaz. Python PATH'i
  yalnızca bu komutun ortamında ai-service/.venv/Scripts ile öne alındı.
- MomentSearch: `. .\Local-Processes.ps1; Set-LocalEnvironment`, ardından
  `.venv\Scripts\python.exe -m pytest tests -q`: 26/26. Model boundary mock;
  bu sayılar gerçek AI başarımı değildir.
- `npm run build`, backend `npm run typecheck` ve `npm run build` geçti.
  Frontend büyük bundle/esbuild-oxc uyarısı ve mevcut lint uyarıları sürer.

Toplam 692 otomatik test geçti. Bunlar ürün/regresyon kontrolleridir;
pedagojik başarı, doğruluk, hallucination oranı veya retrieval recall değildir.

Gerçek video/servis/tarayıcı testleri (kurulu Edge, ayrı test kayıtları):

- `node scripts/test-backend-api.cjs --e2e`: mevcut PDF tarayıcı E2E
  **16/16 adım geçti**. Login, özel ders listesi, gerçek PDF ingestion,
  scanned/non-PDF reddi, bearer indirme, extractive kaynaklı QA, alıntı
  highlight, yetersiz kanıt, greeting, test dosyasını silme, session ve
  yetkisizlik/proxy kontrolleri. Yeni boş sentetik MySQL şeması ve geçici
  servisler kullanıldı. Windows'ta npx spawn ve Linux head bağımlılığı
  yerel Node CLI ve readFileSync ile değiştirildi; ilk tur indirme testinde
  eksik head yüzünden başarısızdı, uygulamanın indirmesi değil test bozulmuştu.
  İkinci tur tamamı geçti. logs/pdf-e2e-tests.log yerel kayıt; screenshot ve
  ayrıntılar geçici knot-e2e dizininde. Yeni runner bu şemayı incelemeye bırakır.

- `node scripts/test-learning-video.cjs`: geçti. Gerçek Prim video kaynağı,
  gerçek metadata/transkript/MySQL üzerinden dört durum, seek boşluğu,
  eksik progress/timestamp, farklı kullanıcı 404/anonymous 401 doğrulandı.
  Sınıflandırma aralıkları açıkça scripted fixtures; insan izledi denmiyor.
  Jump beklenen/gerçek 0.05s. Yanlış Prim tanımı SOURCE_CONFLICT, model
  çağrısı yok; MST bilgisi ayrı birincil başvuru kartında. Temiz integral
  kaynağında gerçek yerel Qwen çağrısı 1 alıntı, 47.840–68.700s döndürdü:
  ilk tur 4.224s, sıcak tekrar 0.857s, GENERATED_UNVERIFIED. Anlamsal kalite
  notlandırılmadı; iki süre performans garantisi değildir.
- `node scripts/test-video-browser.cjs`: ilk tur transkript yüklenip dosya
  hazır değilken yapılan seek timeout verdi. Kök neden: player yoksa tıklama
  atılıyordu. Pending seek/Blob video kimliği düzeltildi ve UI regresyonu
  eklendi. Yeniden gerçek test geçti: transkript 47.84s, kare 10.043s,
  önce UNWATCHED guidance, açık istekten sonra gerçek LLM/3 kaynak,
  kaynak tıklaması 47.84s. 390px taşma/JS hatası yok.
- `node scripts/test-video-progress.cjs`: geçti. 3413ms + 3398ms gerçek
  oynatma = 6811ms; ileri sarma boşluğu sayılmadı, replay toplamı artırmadı,
  reload konum100000ms/revision8. Mobil390px hatasız.

Beklenen/gerçek değerler ve durumlar yerel data/video-tests/learning-run.json,
browser-run.json, progress-run.json dosyalarında; screenshot'lar learning-*.png.
Bu veriler, hesaplar ve ham öğrenci metinleri Git'e alınmaz. Bildirilen asıl
Prim videosunun ilerleme kaydı önce/sonra aynı kaldı. Testler yeni özel ders ve
video referansları bırakır; mevcut materyali silmez. Son tam API turunda eski
forceExit borcu vardır; temiz kapanış ölçülmüş sayılmaz.

Dar Prim/Dijkstra kontrolü genel anlamsal doğruluk sistemi değildir. Genel
ASR hataları, formül doğruluğu, görsel-only bağlam ve çok turlu history çözümü
çözülmüş sayılmaz. Kök nedenler ve istenen 10 test eşlemesi:
../development/CONTEXT_VIDEO_RAG_FIX.md. OpenTutor/DocsGPT değiştirilmedi.

## Önceki FR-03 doğrulaması (tarihsel)

31 Ekim 2026 başlangıç regresyonu: frontend 69, Nest unit 59 geçti.
Yeni ilerleme sonrası frontend **74/74**, Nest unit **76/76**, motor **11/11**
geçti. Bunlar regresyon testleridir; AI doğruluğu veya öğrenme başarısı değildir.
Knot Python suite ilk tam çalışmada **401 geçti / 1 Windows symlink kurulum
hatası** verdi. Gerçek Windows junction fallback'iyle güvenlik sınırı korunarak
tekrarlandı: **402/402 geçti**, 39 mevcut bağımlılık deprecation uyarısı.

İzole gerçek MySQL ilerleme API testleri ilk turda **4/4 geçti**. Geniş API
regresyonunda **85 geçti / 1 mevcut PDF upload boyut sınırı testi timeout** verdi.
Kök neden: limit olayı output stream'i destroy edip Multer storage callback'ini
tamamlamıyordu. Callback artık close+cleanup sonrası tamamlanıyor. Türkçe video
dosya adında Latin1 varsayımı da tarayıcı ekran görüntüsünde saptandı; UTF-8
multipart ayarı ve test eklendi. Düzeltmeler sonrası tam API sonucu **87/87 geçti**
(8 suite, 54.487s); bu testlerde MySQL gerçek, AI servisi fake'tir.
Root hesabıyla ilk test bağlantısı başarısızdı; kullanıcı DB'sine geçilmedi,
yalnızca izole test şemasına yetkili yeni test hesabıyla doğrulama yapıldı.

Son gerçek Edge medya testi başarılı: 414742ms doğrulanmış süre; ilk oynatma 3400ms,
ikinci oynatmayla toplam 6802ms. Aralıklar `[0,3400)` ve `[100000,103402)`;
arada 96.6s boşluk izlenmiş sayılmadı. Replay sonrası toplam 6802ms kaldı.
Reload ve 5.5s durmuş bekleme kayıtlı 100000ms konumunu bozmadı; MySQL revision 8.
Başka kullanıcı 404, anonymous 401; 390px mobilde taşma ve JS hatası yok.
Ham kanıtlar Git dışı data/video-tests içindedir.
Son tur Türkçe dosya adını da gerçek HTTP upload ve UI üzerinde doğruladı.

Bu iterasyonda yeni LLM cevap kalitesi metriği üretilmedi. Accuracy, groundedness,
retrieval recall, topic classification, hallucination ve öğrenci memnuniyeti
UNMEASURED. Eski küçük modelin matematik hataları çözülmüş sayılmaz.
