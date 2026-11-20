# Kalıcı video izleme tasarımı — FR-03

Uygulanan kapsam: tek kullanıcının yetkili özel videosunda medya oynatım
gözlemlerini saklamak. Dikkat, anlama veya konu hâkimiyeti ölçülmez.

## Veri ve bütünlük

Video.durationMs ilk metadata okumasında motorun gerçek yerel dosyasında
FFprobe ile ölçülür, MySQL'de önbelleklenir. İstemci süre gönderemez.
VideoProgress anahtarı `(videoId,userId)`, alanları positionMs, intervals JSON,
revision, updatedAt. Yalnızca bu videonun silinmesinde CASCADE uygulanır.
Migration `20261031000200_add_video_progress` eklemelidir; veri reseti yoktur.

İzlenen aralıklar milisaniye `[start_ms,end_ms)` biçimindedir. Çakışan/bitişik
aralıklar birleşir; pozitif boşluklar doldurulmaz. Tekrar izleme toplamı
artırmaz. Son konum 20:00 olsa da yalnızca 0:00–5:00 izlendiyse toplam 5:00 kalır.
Eşzamanlı sekmelerde revision karşılaştırmalı updateMany ve en çok 5 retry ile
interval union korunur. Son konum son commit edilen isteğe aittir.

## Oynatıcı gözlemi

`src/lib/watch-tracker.js`: oynatma açıkken ve sekme görünürken ardışık
timeupdate örnekleri toplanır. Seek, pause, waiting, rate değişimi ve görünürlük
değişimi anchor'ı sıfırlar. Askıya alınmış timer boşluğu 2.5s üstündeyse kredi
yazılmaz. Medya farkı wall-clock × playbackRate sınırını aşarsa atlama kabul edilir.
Örnekler arasındaki küçük son kesitlerin muhafazakâr biçimde eksik sayılması mümkündür.

`useVideoProgress`: 5s batch, pause/seeked/end/pagehide'da flush, keepalive,
başarısız yazmada görünür hata ve açık sekmede retry. Saved snapshot ve bekleyen
delta ayrılır; in-flight request bitince son unmount delta'sı da gönderilir.
İlk açılışta durmuş player=0, kayıtlı konumu 0'a sıfırlamaz. Devam kontrolü
oynatmayı kendiliğinden başlatmaz; yalnızca kayıtlı ana gider.

API batch en çok 60 aralık; bir gözlem en çok 120s; union en çok 2000 ayrık
aralık. Büyük offline aralıklar 120s parçalara bölünür. Kullanıcı isteğiyle
gönderilmiş medya gözlemi anti-cheat/attention sistemi değildir; sunucu aralık
ve yetki doğrular, öğrencinin gerçekten baktığını doğrulayamaz.

## Sınırlar

- Güç kesintisi/ağ kaybı/tarayıcının zorla kapatılması son kaydedilmemiş batch'i
  kaybettirebilir. Keepalive mutlak teslim garantisi değildir.
- Ağ hatasındaki pending delta yalnızca açık sekmede tutulur; kalıcı offline
  kuyruk yok. Hata asla “kayıtlı” diye gösterilmez.
- Çoklu sekmede interval union korunur; son konum için son commit kazanır.
- Watch durumu erişim iznini değiştirmez. Başka kullanıcı ve ders 404/401 ile
  korunur. Video hâlen yalnızca yükleyene özeldir.
- Konu etiketleri, watched/unwatched semantik soru yönlendirmesi ve quiz
  uyarlaması sonraki dilimdir; FR-03 bunları kendi başına sağlamaz.

Kanıt: backend unit interval/metadata/owner/revision testleri; gerçek MySQL API
tests; `scripts/test-video-progress.cjs` gerçek Edge + player + MySQL testi.
