# Türkçe ses — ölçülen durum ve adaylar

31 Ekim 2026. Kalite artışı iddiası yoktur. Yeni ses modeli indirilmedi.

## Mevcut, doğrulanan seçenek

Tarayıcı `speechSynthesis`, yalnız `localService` Türkçe ses: bu Windows/Edge
oturumunda bir ses görüldü. Gerçek başlat/duraklat/devam/durdur/baştan dinle
kontrolleri geçti. Hız 0,8/1/1,2 seçilebilir; yeni seslendirmede uygulanır.
Metinle aynı yanıt seslendirilir, otomatik oynatma yoktur. Ses bulunamaz veya
12 saniyede başlayamazsa yazılı açıklama kalır ve açık durum gösterilir.
Kontroller yanıtın üstündedir. Fiziksel ses kalitesi, telaffuz, doğallık ve
ilk-ses gecikmesi sayısal olarak ölçülmedi. İşletim sisteminin lisans/voice
bulunabilirliği geçerlidir; uygulama bulut ses hizmeti açmaz.

## Araştırılan alternatifler — kurulmadı

[Piper güncel motoru](https://github.com/OHF-Voice/piper1-gpl) yerel sinir ağı
ses motorudur; depo GPL3 bildirir. Windows bağımsız süreç/ayrı Python ortamı
uyumluluğu ayrıca sınanmalı; mevcut Python 3.14 ortamına kontrolsüz kurulmadı.
[CLI belgesi](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md)
tekrarlanan kullanımda modelin her çağrıda yüklenmesi yerine web sunucusunu
önerir. CPU adayının VRAM ihtiyacını artırmaması beklenir; bu makinede latency,
RAM, telaffuz ve doğallık ölçülmüş değildir.

[Türkçe dfki-medium dosyası](https://huggingface.co/rhasspy/piper-voices/tree/main/tr/tr_TR/dfki/medium)
yaklaşık 63,2 MB ONNX'tir. Depo üst etiketi MIT olsa da
[sesin kendi model kartı](https://huggingface.co/rhasspy/piper-voices/blob/main/tr/tr_TR/dfki/medium/MODEL_CARD)
veri kümesi için CC BY-NC-SA4.0 bağlantısı verir, tek konuşmacı/22050Hz bildirir.
Bu fark çözülmeden ürün için koşulsuz izinli sayılmadı. Daha doğal olduğuna dair
bu projeye ait kör dinleme ölçümü yoktur; varsayılan yapılmadı.

[XTTS-v2 model kartı](https://huggingface.co/coqui/XTTS-v2) Türkçe desteği ve
Coqui Public Model License bildirir. Ücretsiz indirme, koşulsuz ürün lisansı
anlamına gelmez. Windows bağımlılık uyumu, model boyutu, ilk-ses gecikmesi ve
RAM/VRAM bütçesi bu makinede ölçülmedi. Paylaşılan8GB GPU'ya ek yük ve lisans
incelemesi gerektiğinden indirilmedi/etkinleştirilmedi. Ses klonlama yapılmadı.

## Sonraki kabul testi

Lisansı uygun aday belirlendiğinde ayrı ortamda 20 Türkçe akademik cümle:
matematik sembolleri, kısaltmalar, yabancı terimler ve uzun cümleler. Aynı
görüntülenen metinde OS sesiyle kör dinleme/telaffuz puanı; ilk-ses ve toplam
üretim süresi, RAM/VRAM, iptal/tekrar testleri. Ölçüm olmadan "iyileştirildi"
denmeyecek. Kullanıcı yalnız kurulu ve doğrulanmış sağlayıcıyı seçebilecek;
hazır olmayan motor için göstermelik ayar/düğme eklenmeyecek.
