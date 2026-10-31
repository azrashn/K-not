# Video entegrasyonu — 5 kişilik sonraki iş dağılımı

Bu liste önerilen gerçek iş paketleridir; yapılmış işler veya ekip üyelerinin
katkıları uydurulmamıştır. İsimler belli olmadığından Kişi 1–5 kullanılmıştır.
Mevcut ilk sürüm `feature/video-integration` dalındadır.

## Kişi 1 — Video çalışma ekranı

Sahiplik: `src/pages/Videos.jsx`, video bileşenleri ve frontend testleri.
Uzun transkriptte arama, seçili kare paneli, küçük ekranda sekmeler, klavye ile
oynatıcı/kaynak gezintisi ve yüklemede iptal/ilerleme tasarımı.
Teslim: erişilebilir, mobil uyumlu video ekranı ve bileşen testleri.
Kabul: transkript ve kaynak tıklaması doğru ana gider; seçim değişince eski
videonun cevabı/kareleri görünmez; hata ve yüklenme durumları ayırt edilir.
Kişi 2'nin yeni API sözleşmesiyle çalışır.

## Kişi 2 — Video API ve yaşam döngüsü

Sahiplik: `backend/src/videos/`, Prisma video modeli/migrasyonları.
Bellekte tek parça yükleme yerine parçalı yükleme; yetkili Range oynatma;
kullanıcı onaylı silme/iptal; paylaşım yetkileri; motor dedup/refcount ve kopan
kayıtların uzlaştırılması. İç servisi kimlik doğrulamayla koruma.
Teslim: sürümlü API sözleşmesi, eklemeli migrasyon ve erişim testleri.
Kabul: başka ders/öğrenci verisi sızmaz; paylaşılan fiziksel kayıt bir kullanıcı
sildiğinde diğer kullanıcıyı bozmaz; reset/volume silme gerektirmez.

## Kişi 3 — Transkript ve görsel çıkarım kalitesi/hızı

Sahiplik: video motorunun ASR, kare örnekleme, dedup ve işçi kuyruğu.
Türkçe matematik transkriptinde hata analizi, kısa slaytları kaçırmayan örnekleme,
opsiyonel OCR, iş aşamalarının süre/bellek ölçümü ve kesintiden toparlanma.
Teslim: aynı test videolarında karşılaştırmalı süre/kalite ölçümü ve kayıtlı çıktılar.
Kabul: zamanlar gerçek kaynak PTS ile uyuşur; model sürümleri/embedding boyutları
kayıtlıdır; 8 GiB VRAM'de ağır işler sınırlanır. Büyük model indirmeden önce boyut
ve onay alınır; ücretli API varsayılan olmaz.

## Kişi 4 — Kaynaklı cevap ve kalite değerlendirmesi

Sahiplik: video arama/cevap adaptörü, kaynak sözleşmesi ve değerlendirme kümesi.
Konuşma ve görsel sorgular için ölçülen retrieval kalitesi; cümlenin kaynakla
uyumunu denetleme; yetersiz kanıtta çekinme; sonrasında ortak PDF/video arama.
Teslim: en az 10 elle doğrulanmış soru ve kaynak zamanı, doğru/yanlış/kanıtsız
ayrımı olan rapor. Doğrulanmış öğretim içeriği repo'ya hak sahibi izni olmadan girmez.
Kabul: kaynak bulunması doğruluk garantisi sayılmaz; mevcut yanlış yöntem adı ve
yanlış formül örnekleri regresyon kümesindedir; doğrulanmayan yanıt SIKI olamaz.
Kişi 3'ün zamanlı çıktılarını ve Kişi 2'nin yetkili kapsamını kullanır.

## Kişi 5 — Uçtan uca test ve çalıştırma

Sahiplik: yerel başlat/durdur betikleri, CI ve gerçek video test altyapısı.
Temiz kurulum tarifi, motor sürümleme/sağlık kontrolü, başarısız upload/retry,
yeniden başlatma kalıcılığı, erişim ve kaynak oynatma tarayıcı testleri.
Teslim: tek yönergede tekrarlanabilir geliştirme kurulumu ve test kanıtları.
Kabul: fake testler gerçek AI testlerinden ayrıdır; sırlar/materyaller Git'e girmez;
testler mevcut kullanıcı verisini sıfırlamaz; OpenTutor/DocsGPT port ve süreçlerine
dokunulmaz. Bütün kişilerin teslimlerini aynı gerçek video senaryosunda doğrular.
