# K-NOT ürün deneyimi — yerel kullanım

31 Ekim 2026. Dal: `feature/video-integration`. Bu aşamanın başlangıcı d2d6c3d.

## Başlatma

Docker Desktop açıkken K-NOT klasöründe:

```powershell
.\scripts\Start-KnotVideo.ps1
```

[K-NOT](http://127.0.0.1:5174/) → Ana Sayfa → Ders oluştur → belge/video/bağlantı
ekle → kaynak seç → sağdaki asistanla konuş → Alıştırma yap → Öğrenme Analizi.
Önceden oluşturulmuş kendi hesabını kullan. Hesap/parola veya yerel `.env`
dosyaları kaynak kontrolüne eklenmez.

Yeni kişisel dersleri ad/açıklama/alanla oluşturup ders kartından düzenleyebilir,
arşivleyebilir veya dersin adını yazarak silebilirsin. Arşivleme yalnız kendi
listeni etkiler. Eski, sahibi tanımlanmamış/paylaşılan dersler otomatik olarak
sahiplenilmez ve silinmez. Diğer üyeleri/verileri olan dersin kalıcı silinmesi
reddedilir. Başarısız temizlik, görünür DELETING durumuyla yeniden denenebilir.

Çalışma ekranı: belge/video/YouTube–Drive ekleme sekmeleri, kaynak arama,
durum yenileme, özgün sayfa/slayt görüntüsü, video ve bağımsız sohbet kaydırması.
Asistan daraltılabilir. Küçük ekranlarda alanlar alt alta geçer. Cevaptan kaynağa
gitmek gerçek sayfa/slayt/zaman konumunu açar. Sohbet seçimi ve yeni konuşma,
sunucuda kullanıcı/ders kapsamında saklanır; tarayıcıda yalnız konuşma kimliği
tutulur. Kaynağı kaldırılan/güncellenen eski yanıtlar tekrar açılırken gizlenir.

## Yerel bağımlılıklar

- Mevcut Node/React19/Vite8, Nest11/Prisma7/MySQL8 korunur. Yeni npm paketi yok.
- Mevcut `ai-service/.venv` Python 3.14 korunur; global paket kurulmaz.
- `python-pptx==1.0.2` yalnız geliştirme gereksinimidir: gerçek test sunumu üretir.
- Mevcut Poppler `pdftoppm.exe`: PATH veya yerel Codex runtime önbelleği üzerinden
  bulunur. Taşınan bilgisayarda Poppler ayrıca sağlanmalıdır; metin çıkarma ile
  görsel görüntüleyici ayrı bağımlılıklardır. Eksik araçta sahte görüntü gösterilmez.
- `knot-office-renderer:local-v1`: başlatıcı yoksa yalnız kendi Dockerfile'ından
  oluşturur. Mevcut makinede yaklaşık 180 MB. Debian tabanı digest ile sabit;
  LibreOffice paketleri Debian güvenlik deposundan gelir. Yeni makine ilk build'de
  ağa ihtiyaç duyar. Elle yeniden oluşturma:

```powershell
docker build -t knot-office-renderer:local-v1 -f tools/office-renderer/Dockerfile tools/office-renderer
```

PPTX → LibreOffice PDF → Poppler PNG. Her dönüştürme tek kullanımlık, UUID adlı
K-NOT container'ıdır: ağ yok, salt okunur kök, ayrı tmpfs, yalnız kendi iş klasörü
mount edilir, 2GB/2CPU/128PID sınırı, yetkisiz kullanıcı. Kalıcı servis/port veya
başka projeye ait volume eklenmez. Önbellek `STORAGE_ROOT/.previews` altında
ders/materyal/sürüm kapsamında tutulur ve kaynak temizlenirken kaldırılır.
Font eşleştirme farklılıkları olabilir; animasyon/video oynatımı render edilmez.

Portlar: UI5174, Nest3100, Python8110. MomentSearch7862, özel Ollama11436,
PG15433/Qdrant16433 önceki kurulumdan kullanılır. Paylaşılan Ollama11434,
OpenTutor ve DocsGPT değiştirilmez. Yeni AI model indirmesi veya ücretli API yok.
Mevcut yerel E5 ve Qwen3-VL2B Instruct kullanılır.

## Veriler ve sınırlar

Altı eklemeli migrasyon uygulanmış durumda. Yeni migrasyon
`20261031190000_product_learning_loop`: kişisel ders, arşiv, sohbet/mesaj/kaynak,
alıştırma/yanıt ve gerçek etkinlik kayıtları. Eski yerel Course.description alanı
koşullu olarak korunup genişletilir; eski createdById alanına dokunulmaz.
Veritabanı sıfırlanmaz. Başarısız ilk description migrasyonu yalnız kendi adıyla
rolled-back işaretlenip düzeltilmiş sürümle uygulanmıştır.

PDF 30 MB, PPTX/TXT 2 MB, video 100 MB / 2 saat mevcut sınırları korunur. Ders başına
en çok 100 materyal; görsel sayfa isteği1–500. Drive bağlantısı herkese açık
dosya bağlantısı olmalıdır; OAuth dosya seçicisi yoktur. Linkten alınabilme,
başarılı transkript veya görsel anlayış kanıtı değildir. Mevcut sağlayıcı erişim
engellerini aşan bir yöntem eklenmedi.

Görsel render, AI görsel anlayışı değildir. Ortak retrieval metin projeksiyonu
kullanır; videonun mevcut görsel motoru ayrı korunur. Ad değişikliği özgün
dosya baytlarını değiştirmez. Başarılı dosyayı yerinde değiştirme ve yeniden
işleme henüz yoktur: yeni dosyayı ayrı ekleyip doğruladıktan sonra eskisini
onayla kaldır. Başarısız PDF/video için mevcut retry yolu görünürdür.

Beş soru türü kaydedilir. Model MCQ'su deneysel; doğrulanamazsa açıkça etiketli
çoktan seçmeli kaynak hatırlama sorusuna dönülür. Doğru/yanlış kaynak doğrulama,
cloze literal hatırlama, kısa cevap eşleşmesi sınırlıdır. Farklı kısa yanıt ve
açık uçlu yanıt otomatik yanlış/başarı puanı almaz; inceleme/yanıt kaydı tutulur.
Sonuçlar ve kaynakları kalıcıdır. Analiz, izlemeyi konu hâkimiyeti saymaz.

## Test ve günlükler

```powershell
npm test
npm run build
cd backend
npm run typecheck
npm run test:unit -- --runInBand
cd ..
node scripts/test-backend-api.cjs
node scripts/test-backend-api.cjs --integration
cd ai-service
.venv\Scripts\python.exe -X utf8 -m pytest -q
cd ..
ai-service\.venv\Scripts\python.exe -X utf8 scripts/create-product-fixtures.py
node scripts/test-product-local.cjs
node scripts/test-unified-voice.cjs
```

API test runner yeni, rastgele adlı kendi test şemasını kullanır; mevcut veriyi
truncate etmez. İsteğe bağlı gerçek kullanıcı testi, önceki yerel test hesabına
ve kendi gerçek integral videosuna ihtiyaç duyar; bunların yolları ignored
`data/video-tests/last-run.json` içindedir. Aynı ürün test dersini yeniden kullanır.
Yalnız bu testin oluşturduğu geçici silme dersi, tarayıcıda ad yazma onayıyla
silinir. Önceden var olan demo dersler temizlenmez. `data/product-tests` kanıtları
ve `logs/product-*` sonuçları kaynak kontrolü dışındadır.

`verify-product-restart.cjs`, K-NOT yeniden başlatıldıktan sonra kalıcı sohbet ve
alıştırmayı tekrar açar. Durdurma yalnız `scripts/Stop-KnotVideo.ps1` ile:
veritabanı/volume/MomentSearch korunur. Eski genel `dev.ps1 -Stop` kullanılmaz.
