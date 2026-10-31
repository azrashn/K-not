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

## POST /courses/:courseId/videos/:videoId/answers

Gövde: `{question, current_time_ms?, explain_now?, evidence_id?}`. question-only
istemci de aynı server kontrolünden geçer. current_time_ms tamsayı ve gerçek
video süresi içinde olmalıdır; kullanıcı/izleme aralıkları/yüzdesi kabul edilmez.
JWT ve sahiplik iki aşamada yeniden kontrol edilir.

İlk çağrı model üretmeden kanıtı bulur, ana transcript span'ını MySQL progress
union'ıyla karşılaştırır. Yanıt: question, learning_state (WATCHED,
PARTIALLY_WATCHED, UNWATCHED, UNKNOWN), observed_coverage, progress_revision,
learning_basis=PRIMARY_RETRIEVED_TRANSCRIPT_SPAN, relevant_segment
({start_ms,end_ms,video_id,title} veya null), citations, context_resolution,
source_warnings, background_references, evidence_id, answer, status, llm_used.
Video kimlikleri Knot'a aittir; motorun özel seçim kimliği açığa çıkmaz.

İzlenmemiş/kısmi/bilinmeyende status=GUIDANCE ve llm_used=false. Güvenilir
zaman yoksa NO_RELIABLE_EVIDENCE, UNKNOWN, relevant_segment=null. WATCHED
otomatik EXPLANATION yoluna geçer. Açık açıklama için aynı question ve alınmış
evidence_id ile explain_now=true gönderilir; fresh progress yeniden okunur.
Seçim kullanıcı/ders/video/soruya bağlı, 10 dakika, RAM'de en çok 128'dir.
Restart/expiry/kaynak değişimi sonrası NOT_RETRYABLE ile soru yeniden istenir.

EXPLANATION generation_status: GENERATED_UNVERIFIED, SOURCE_CONFLICT,
REJECTED_CONCEPT_CONFLICT, MODEL_UNAVAILABLE veya INSUFFICIENT_SUPPORT.
Çelişkili kaynağı açıklamak için model çağrılmaz. Video dışı başvuru
VERIFIED_BACKGROUND/is_video_evidence=false olarak ayrı taşınır.
support_confirmed=false ve experimental=true korunur; alıntı doğruluk kanıtı değildir.
Sınır: kullanıcı başına dakikada 12 çağrı. İzleme sınıfı erişimi engellemez.

## Diğer video uçları

Liste/yükleme/link/retry/transkript/kare/cevap/silme sözleşmeleri için
../video-integration.md. Progress, son referans video silinirken SQL cascade
ile yalnızca ilgili videodan kaldırılır. Aktif iş iptali henüz yoktur.

## Yerel motor metadata köprüsü

GET /api/local/metadata/:engineId: video_id, duration_ms, width, height,
size_bytes, has_audio. Sunucu dosyasından FFprobe; path/secret dönmez. Dosya
değişimi mtime/size ile cache anahtarına katılır; cache en çok 128 metadata kaydı.
Yalnızca hazırlanmış yerel motorda; internet API'si olarak yayımlanmaz.
