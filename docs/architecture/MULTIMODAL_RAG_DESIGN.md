# Ortak materyal RAG — uygulanmamış sonraki dilim

Durum: PLANNED. Bu belge çalışan özellik iddiası değildir. Mevcut PDF/Chroma
ve video/Qdrant indeksleri silinmeyecek veya yeniden birleştirilerek dönüştürülmeyecek.

Önce FR-05 için aktif video + gerçek playback zamanını alan geriye uyumlu bir
soru bağlamı eklenecek. Belirsiz “burada” sorusu yalnızca o anın gerçek zamanlı
transkript/kare kanıtına bağlanacak; kanıt yoksa açıklama istenecek. FR-04,
bulunan kaynak aralığını VideoProgress union'ıyla karşılaştıracak; izlenmemiş
olması erişimi engellemeyecek. Model çıktısı semantic certainty sayılmayacak.

Ardından Nest yetkili ders kapsamından PDF ve video kaynaklarını ayrı adapter'larla
paralel alacak. Skorlar doğrudan karşılaştırılamaz; RRF/kalibre edilmiş reranking
küçük etiketli veriyle ölçülmeli. Birleştirilmiş kaynak sözleşmesi material_id,
type, course_id ve page/slide veya start_ms/end_ms içerecek. Alıntı kaynak metniyle
yeniden kontrol edilmeli; destek durumu PDF/video arasında otomatik yükseltilmemeli.

PPTX girişi henüz yok. Parser/lisans araştırması ve gerçek slayt numarası koruyan
ayrı ingest adapter gerekir. Aynı topic_id atamak için yalnızca modelin genel
bilgisi yeterli değildir; gerçek kaynak eşleşmesi ve değerlendirme gerekir.

Kabul testi: aynı özel derste kontrollü PDF + konuşmalı/slaytlı video; ilgili iki
kaynak birlikte gelmeli, yabancı ders/owner asla gelmemeli, bilinmeyen soruda
cevap/kaynak uydurulmamalı. Bu senaryo şu an geçmiş kabul edilmez.
