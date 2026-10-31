# Sonuçlar ve ölçülmeyenler

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
