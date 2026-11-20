# Öğrenme bağlamı: gözlem ve çıkarım ayrımı

Gözlenen video aralıkları mevcut VideoProgress'te kalır. positionMs, toplam
yüzde, PDF açma veya bir slayta tıklama konu hâkimiyetine dönüştürülmez.
Bu sürüm PDF okundu / öğrendi şeklinde yeni ölçüm kaydetmez.

Unified video_learning kaydı yalnız source_id ile belirtilen gerçek video
span'ını anlatır: WATCHED, PARTIALLY_WATCHED, UNWATCHED, UNKNOWN ve coverage.
Başka materyaller için bu dört video sınıfı kullanılmaz. Eksik kayıt UNKNOWN,
bilinen boş aralık UNWATCHED'dır. Atlanan boşluk izlenmiş sayılmaz.

Yalnız video kanıtı varsa ve ilgili aralık tam izlenmemişse önce GUIDANCE;
Şimdi açıkla erişimi açar. İlgili PDF/PPTX/TXT varsa kaynaklı açıklama hemen
alınabilir; videonun izlenmediği ayrıca gösterilir. Kullanıcının konuyu hiç
bilmediği varsayılmaz. Sınıfları frontend gönderemez; SQL yeniden okunur.

Konuşma: kullanıcı/ders bağlı opaque UUID, 10 dakika, RAM'de en fazla 128.
Son çözülmüş soru 900 karakter ve önceki tek cevap en fazla 3000 karakter;
tüm geçmiş sonsuzca modele gönderilmez. Takip referansları mevcut konuya
bağlanır; ikinci adımın gerçekten doğru yorumlandığı garanti edilmez.
Önceki model cevabı kanıt sayılmaz; güncel kaynaklar yeniden aranır.
Yetki/sürüm/silme kontrolleri soru öncesi ve üretim sonrası tekrar edilir.
Restart/expiry sonrası yeni konuşma gerekir. Tarayıcı en çok 8 tur gösterir;
bu bir kalıcı sohbet arşivi değildir.

Kaynaklı pratik: kısa literal boşluk doldurma. Doğru terim gerçek kaynak
metninden seçilir, cevap değerlendirmesi yalnız ifade eşleşmesidir. Yanlışta
kaynak bağlantısı ve kaynak ifadesi sunulur. mastery_estimated=false,
persisted=false. Ders/sahip/sürüm kontrolü pratiği cevaplandırırken tekrarlanır.
Kavramsal puanlama, uzun cevap rubriği ve kalıcı öğrenme analitiği tamamlanmadı.

Gelecekte observed_activity ve estimated_understanding ayrı modeller olmalı;
quiz performansı/güven aralığı olmadan mastery puanı üretilemez. Konu ilişkisinin
tahmini olması, öğrencinin eksik öğrenmesinin kanıtı değildir.
