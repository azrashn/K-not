# Video öğrenme API eki

Mevcut PDF API sözleşmeleri değişmedi. Bütün Knot video uçları JWT, ders üyeliği
ve yükleyen sahipliğiyle korunur. Başka kullanıcı/ders 404, oturumsuz 401.

## GET /courses/:courseId/videos/:videoId/progress

İlk çağrıda motorun /api/local/metadata/:engineId ucundan doğrulanmış süre
okunur ve Video.durationMs saklanır. Sonraki okumalar yalnızca MySQL'dendir.

Yanıt alanları: video_id, duration_ms, position_ms, intervals
(`[{start_ms,end_ms}]`), watched_ms, watched_percent, revision,
observation=`MEDIA_PLAYBACK_ONLY`. Yüzde interval union toplamından hesaplanır.
Örnek: konum 90.000ms, yalnızca `[0,5000)` izlenmişse izlenen 5.000ms'dir.

## PUT /courses/:courseId/videos/:videoId/progress

Gövde: `{position_ms:100000, intervals:[{start_ms:0,end_ms:3500}]}`.
Bu tam snapshot değildir; intervals alanı yeni gözlem deltasıdır. İdempotent
union yapılır. İstemciden duration, user_id, owner veya negatif/NaN değer kabul
edilmez. Position gerçek süreyi aşamaz. Bütün zamanlar tamsayı milisaniyedir.
Batch 60 aralık, her biri 120s üst sınırı. Sunucu 2000 ayrık union aralığı sınırlar.

Yanıt GET ile aynı; revision artırılır. Çoklu yazmada optimistic retry vardır;
çözülemeyen yarış 409, girdi hatası 422, süre servisi erişim hatası 503.
İzleme verisi bir erişim izni veya sınav/konu puanı üretmez.

## Diğer video uçları

Liste/yükleme/link/retry/transkript/kare/cevap/silme sözleşmeleri için
../video-integration.md. Progress, son referans video silinirken SQL cascade
ile yalnızca ilgili videodan kaldırılır. Aktif iş iptali henüz yoktur.

## Yerel motor metadata köprüsü

GET /api/local/metadata/:engineId: video_id, duration_ms, width, height,
size_bytes, has_audio. Sunucu dosyasından FFprobe; path/secret dönmez. Dosya
değişimi mtime/size ile cache anahtarına katılır; cache en çok 128 metadata kaydı.
Yalnızca hazırlanmış yerel motorda; internet API'si olarak yayımlanmaz.
