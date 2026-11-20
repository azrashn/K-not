# Video ↔ Slayt/PDF eşleme — eşik ayarı

`LINK_MIN_SIMILARITY` (`ai-service/src/knot_rag/links.py`, şu an **0.87**) tek yerde tanımlıdır. Eşleşme bir **tahmindir**;
eşik belirsizlikte boş sonuç verecek şekilde yüksek tutulur. Ortam değişkeni `KNOT_LINK_MIN_SIMILARITY`
ile (örn. başka bir gömme modeli için) geçersiz kılınabilir.

## Nasıl ayarlandı (ve sınırı)

Gerçek bir ders videosu + transkript + çok sayfalı PDF ile uçtan uca deneme **yapılamadı** (bu makinede
backend'in MySQL'i ve video transkripsiyon servisi çalışmıyordu; elde yalnızca 1.5 KB'lık
`calculus-notes.pdf` vardı). Bu yüzden eşik, elde olan gerçek yazılı veriyle **vekil (proxy)** bir
ölçümle ayarlandı:

- Model: `intfloat/multilingual-e5-small` (`ai-service/.env`'deki gerçek gömme modeli).
- Veri: `ai-service/tests/fixtures/corpus_v2.json`, `veri-yapilari` dersi. "Sayfa" yerine slayt parçaları
  (Hafta 4–7, 19 parça), "videonun konuşması" yerine aynı dersin not/ders kitabı parçaları (yazılı metin).
- Doğru etiket: AVL/BST konulu slayt (Hafta 4, 5; 10 parça) için ağaç konulu not parçası; Hash (Hafta 6) ve
  Yığın (Hafta 7) slaytları için notlarda karşılığı yok, **doğru cevap boş**.
- Ölçüt: her slayt parçası için gömme benzerliği en yüksek aday + ortak anahtar terim kuralı.

| Eşik | Dönen | Doğru | Yanlış |
|-----:|------:|------:|-------:|
| 0.80 | 14 | 9 | 5 |
| 0.84 | 12 | 9 | 3 |
| 0.85 | 9 | 8 | 1 |
| 0.86 | 8 | 7 | 1 |
| 0.865 | 6 | 5 | 1 |
| **0.87** | 6 | 5 | 1 |
| 0.88 | **4** | **4** | **0** |
| 0.89 | 2 | 2 | 0 |

Gözlem: e5-small kosinüs skorları ilgisiz çiftlerde bile 0.79–0.85 arasındadır (skorlar sıkışıktır); bu
yüzden mutlak benzerlik tek başına yetmez, ortak anahtar terim şartı ayrıca uygulanır. Yanlış pozitifi
sıfıra indiren en düşük eşik 0.88 seçildi (geri çağırma bu vekil veride ~%40).

## Bilinen eksik / yapılacak

- Gerçek ders videosu transkripti **konuşma dili** olduğundan skorları yazılı metinden düşük çıkabilir;
  0.88 gerçek videoda çok sık boş sonuç verebilir. Gerçek videoyla en az 5 sayfalık tabloyla (sayfa →
  önerilen an → doğru/yanlış) yeniden ayarlanmalı; değer `KNOT_LINK_MIN_SIMILARITY` ile denenebilir.
- Hashing gömme (testler) kendi skor ölçeğine sahiptir; testler eşiği 0.45'e çeker.

## Ekran görüntüleri

`docs/screenshots/esleme-acik.jpg` (açık), `esleme-koyu.jpg` (koyu), `esleme-mobil-390.jpg` (390 px),
`esleme-video-koyu-mobil.jpg` ("Bu anın slaydı", koyu, 390 px). Görüntüler, sahte yanıtlı bir bileşen
deneme sayfasından alındı; gerçek ders verisi değildir.

## Gerçek veriyle kontrol (Chapter_1 PDF ↔ "1.1 Introduction" videosu)

İndeksteki gerçek PDF sayfaları ve video transkripti, e5-small ile. En iyi video anı ve elle yargı:

| Sayfa | En iyi an | Benzerlik | Yargı |
|---:|---:|---:|---|
| 6 (Internet: nuts and bolts) | 419 sn ("links, routers, switches, hosts") | 0.877 | doğru |
| 11 (What's a protocol?) | 615 sn ("So what is the protocol here?") | 0.879 | doğru |
| 10 (What's a protocol?) | 772 sn | 0.860 | belirsiz (transkript bozuk) |
| 8 (network of networks) | 772 sn | 0.862 | yanlış |
| 5 (Chapter goal) | 772 sn | 0.859 | yanlış (konuşulan an ~40 sn, transkript bozuk) |

İki doğru eşleşme 0.877–0.879'da, bilinen yanlışlar 0.862 ve altında; bu yüzden eşik 0.88'den **0.87**'ye
çekildi. Not: videonun ilk ~3 dakikasının transkripti yanlış dilde (Türkçe) çözülmüş, anlamsız; bu bölüm
için hiçbir eşikle doğru sonuç çıkmaz ve boş dönmesi doğrudur. Asıl iyileştirme transkripsiyon dilinin
doğru seçilmesidir.
