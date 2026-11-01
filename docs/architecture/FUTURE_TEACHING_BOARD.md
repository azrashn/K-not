# Sonraki aşama: kaynaklı öğretim tahtası

Bu aşamada uygulanmadı; çalışmayan bir arayüz düğmesi eklenmedi.

Mevcut kurs/özel materyal yetkisi, LearningConversation, kalıcı quiz ve kaynak
sözleşmesi korunmalı. Yeni bir uygulama/ikinci veritabanı kurmak yerine aynı
çalışma alanında isteğe bağlı öğretim paneli önerilir. Gerçek ürün akışı bu
panel olmadan çalışır.

İstek: ders, kullanıcıdan bağımsız sunucu kimliği, konuşma, soru, seçili materyal,
güncel kaynak kimliği/sürümü ve varsa video zamanı. Çıkış: sıralı açıklama
adımları, her adımda gerçek source IDs, metin ve opsiyonel çizim yönergeleri.
Model, veri kaynakları içinde talimat gibi görünen içerikleri çalıştıramaz.
Bir diyagramın görsel olarak anlaşılmış olduğu, yalnız çıkarılmış metinle
iddia edilemez. Görsel model yolu eklenirse görüntü kaynağı/izin/bölge/sürüm
ayrıca taşınmalı; kaynak dosya ve video zamanı değiştirilmemeli.

Adım sözleşmesi: `step_id`, `text`, `source_ids[]`, `material_id`, `version`,
`location{kind,page|slide|start_ms,end_ms}`, `assessment_mode` ve ses durumu.
Mevcut kaynak doğrulaması her gösterim/yeniden açmada devam eder. Silinen
kaynağa bağlı açıklama/çizim/ses önbelleği geçersizleşir. Kalıcı kayıtların
yeniden üretimi, orijinal ile AI çizimini açıkça ayırır.

Ses, görüntülenen adım metninden üretilir; play/pause/stop/replay aynı durum
makinesine bağlanır. Kullanıcı başlatır, adım değişince eski ses durdurulur.
Yerel motor kurulmadan üretim düğmesi açılmaz. Çoklu adım akışı için önce
sunucu streaming/iptal sözleşmesi ve sıralı olay kimlikleri eklenmelidir.

Kabul: sayfa/slayt/video kaynak sıçraması doğru; kullanıcı/ders izolasyonu;
yenileme/restart sonrası adımlar; kaynak kaldırmada redaction; uzun üretimde
iptal; düşük VRAM'de CPU geri dönüşü; ayrı etiketli ses/doğruluk ölçümleri.
Quiz geri bildirimi ve analiz kaynak dönüşü, tahtanın mevcut çalışma bağlamına
bağlanmalı; sırf oynatma süresinden öğrenme başarısı üretilmemeli.
