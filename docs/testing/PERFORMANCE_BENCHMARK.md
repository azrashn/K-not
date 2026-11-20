# Ölçüm kaydı — 31 Ekim 2026

Warm GET video progress, aynı yerel demo kaydı, ardışık 30 HTTP isteği:
P50 **7.02ms**, P95 **10.79ms**, max **11.47ms**. Header/JWT, Nest, MySQL ve JSON
okuma dahil; model ve video yüklemesi dahil değil. Kanıt: Git dışı
data/video-tests/progress-benchmark.json. Tek bilgisayarda küçük örneklemdir;
çok kullanıcılı veya cold-start performans garantisi değildir.

Sıcak progress yolu yalnızca scoped MySQL sorgularını kullanır. Metadata ilk
kez gerçek dosyadan FFprobe ile alınır; daha sonra video süresi DB'dedir.
İzleme yazmaları event başına değil, 5s batch ve pause/seek/end flush şeklindedir.

Önceki video ölçümü: 414.75s integral videosu, yeni işleme 52.085s, 42 kare ve
19 chunk; örnek yerel LLM cevabı 2.352s. Farklı güne ait tek örneklerdir; P50/P95
diye gösterilmez. Raw LLM içeriği burada yayımlanmaz.

Henüz ölçülmeyenler: güncel PDF yükleme dağılımı, ayrı embedding/retrieval/LLM
dağılımı, ses üretimi (özellik yok), frontend render dağılımı, çok kullanıcılı
yük. Ölçülmeyen alanlar için hız veya doğruluk yüzdesi verilmez.
