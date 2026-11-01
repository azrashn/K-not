# Kritik düzeltme: izleme farkında video soru-cevap

Tarih: 31 Ekim 2026. Başlangıç: feature/video-integration / 769941a.
Yeni özellik kapsamı genişletilmedi; mevcut video, ilerleme ve QA yolları bağlandı.
Knot kökü: `C:/Users/ASUS/K-not`. Motor kökü:
`C:/Users/ASUS/Documents/Codex/MomentSearch`.

## Kök nedenler — dokuz sorunun kod karşılığı

1. İlerleme `backend/prisma/schema.prisma` içindeki VideoProgress'te tutuluyor:
   `(videoId,userId)`, intervals JSON, positionMs, revision. İzleme temeli doğru;
   son konum izlenen aralıkların yerine kullanılmamalı.
2. `video-progress.service.ts:get/save` yetkili aralıkları doğru saklayıp okuyor.
   Önceki QA yolu bu servisi veya VideoProgress'i hiç sorgulamıyordu.
3. Önceki `src/pages/Videos.jsx:ask` → `src/api/endpoints.js:videoAnswer`
   yalnızca question gönderiyordu. Course/video ID URL'de, kimlik JWT'deydi;
   playback position yoktu. Kimlik frontend gövdesinden alınmamalı.
4. Önceki `backend/src/videos/videos.service.ts:ask`, doğrudan motorun
   `/api/ask` ucuna `{question,video_ids:[yetkiliEngineId]}` gönderiyordu.
   İlerleme okuma/karşılaştırma ve pedagojik karar yoktu. Eski doğrudan yol kaldırıldı.
5. Motor `src/rag/search.py:retrieve` gerçek t_start/t_end ve frame ms döndürüyor.
   Timestamp eksikliği ana neden değildi; Node bu alanları yalnızca kaynak kartına taşıyordu.
6. Retrieved segment'ler izleme union'ıyla karşılaştırılmıyordu. Yeni
   `backend/src/videos/learning-state.ts:classifyLearning` bu eksik bağlantıdır.
7. Eski motor CLIP görsel ve E5 transcript retrieval'ını birleştiriyor;
   `_build_moments` frame + transcript bağlamı, `_answer` küçük VLM çağrısı yapıyor.
   Yani eski akış yalnızca transkript değildir. Yeni öğrenme kararı için güvenilir
   kaynak aralığı, gerçek kayıtlı transcript span'ından alınır; frame-only benzerlik
   bir konu zamanı diye uydurulmaz.
8. Önceki `_LOCAL_SYSTEM` kaynaklı kısa cevap ve bozuk ASR uyarısı içeriyordu,
   fakat öğrenme durumu promptta yoktu. Daha önemlisi model çağrısından ÖNCE
   izleme kararı yoktu; yalnızca prompt eklemek bu problemi çözmezdi.
9. Bildirilen Prim tanımı gerçek kayıtlı otomatik transkriptin ilk parçasında
   zaten “en kısa yol bulma algoritması” şeklinde bulunuyor. Video başlık karesi
   Prim adını doğruluyor. Bu nedenle sorun yalnızca modelin genel bilgisi veya
   sadece retrieval diye etiketlenemez: kirli kaynak + doğrulamasız üretim var.
   ASR mı özgün anlatım mı yanlış, ses bağımsız doğrulanmadan kesin söylenmedi.

Prim konusu bu materyalde başlangıçtaki gerçek kaynak parçasında, yaklaşık
0:00.05–0:21.36 aralığında geçiyor. Yaklaşık bir saniyelik kayıt bu aralığa
çakıştığı için PARTIALLY_WATCHED olabilir. Toplam %0.2 diye UNWATCHED zorlanmaz;
ilgili kaynak videonun ilerisine taşınarak sahte timestamp oluşturulmaz.
Öğrenci kimlikleri ve gerçek özel izleme snapshot'ları Git'e alınmaz.

## Uygulanan akış

Student question + active video/time → scoped evidence retrieval → gerçek
transcript span → MySQL'den taze user/video progress → coverage sınıfı → guidance
veya izinli açıklama. Controller aynı `/courses/:courseId/videos/:videoId/answers`
ucunu kullanır; eski question-only istemciler de kontrolü atlayamaz.

- `VideoLearningService.ask`: ders üyeliği/sahiplik, kaynak kapsam/zaman
  doğrulaması, her istekte server progress okuması. Position/global percent kullanılmaz.
- `classifyLearning`: tüm kaynak aralığı kapsanırsa WATCHED, bir kısmı kapsanırsa
  PARTIALLY_WATCHED, bilinen boş/çakışmayan kayıtsa UNWATCHED. Progress veya güvenilir
  aralık eksikse UNKNOWN. Öncelik birincil retrieved span'dır; tüm konu hâkimiyeti değildir.
- `useVideoProgress.flushForQuestion`: bekleyen yazmayı bekler ve kısa deltayı
  gönderir. Açık hiç-izlenmedi gözlemi gerektiğinde boş kayıt oluşturulur.
  Sunucuda kayıt gerçekten bulunamıyorsa bunun yerine [] uydurulmaz: UNKNOWN kalır.
- UNWATCHED/PARTIALLY_WATCHED/UNKNOWN ilk aşamada LLM çağırmaz. İlgili bölüme git
  gerçek start_ms'ye gider; Şimdi açıkla aynı sunucu kaynak seçimini kullanır.
- WATCHED otomatik açıklamaya geçebilir; kaynak tutarsızsa bu da doğru kabul edilmez.
- Frontend active course/video/time taşır, kimlik JWT'den gelir. user_id,
  watched_percent veya intervals göndererek sınıfı değiştirmek DTO tarafından reddedilir.
- Seçim kimlikleri owner/course/video/question'a bağlıdır; iki aşamada da yetki
  yeniden kontrol edilir. Kaynak hash'i değişirse seçim reddedilir.

## Kaynak doğruluğu ve Prim/Dijkstra

Motor `src/rag/learning_video.py:retrieve/explain/concept_conflict`:

- Tanım sorularında ismi gerçek transkriptte bulur; olmayan algoritmayı benzer
  graf karesinden varmış gibi göstermez. Diğer topical sorularda mevcut multimodal
  retrieval kullanılır; deictic soruda aktif ana ait transcript seçilir.
- Bilinen Prim→shortest paths / Dijkstra→MST karışıklıklarını dar kuralla kontrol
  eder. Negatif cümle ve doğru karşılaştırma regresyonları vardır.
- Kaynak çelişiyorsa SOURCE_CONFLICT uyarısı ve gerçek alıntı gösterilir;
  o yanlış tanım için model çağrılmaz. Model doğru kaynakla yine karıştırırsa
  REJECTED_CONCEPT_CONFLICT ile o açıklama gösterilmez.
- Doğru temel bilgi **VERIFIED_BACKGROUND / video alıntısı değildir** kartında,
  ayrı birincil başvuru linkiyle gösterilir. Video kaynak numarası bu bilgiye yapıştırılmaz.
- Model yoksa/kanıt yetmezse dürüst kaynak modu; üretim varsa bile
  support_confirmed=false ve deneysel uyarısı korunur.

Doğrulanmış başvurular: Princeton Algorithms 4/e'nin
[PrimMST kaynağı](https://github.com/kevin-wayne/algs4/blob/master/src/main/java/edu/princeton/cs/algs4/PrimMST.java)
minimum kapsayan ağacı;
[DijkstraSP kaynağı](https://github.com/kevin-wayne/algs4/blob/master/src/main/java/edu/princeton/cs/algs4/DijkstraSP.java)
negatif olmayan kenarlarda tek kaynaktan en kısa yolları tanımlar. Kod kopyalanmadı,
bu iki temel bilgi kendi özetimizle ayrı gösteriliyor. Harici ücretli API yok.

## Gerçek tarayıcıda yakalanan ek zamanlama hatası

Eski `seek`, player henüz yoksa isteği atıyordu. Transkript dosyadan önce
açıldığında tıklama boşa gidiyordu; eski browser regression bunu timeout ile
yakaladı. Videos.jsx artık seçime bağlı Blob kimliği tutar, önceki videonun
Blob'unu yeni videoda göstermez; pendingSeek onLoadedMetadata'da uygulanır.
Yükleme öncesi kaynak tıklaması için ayrı frontend regresyonu eklendi.

## Testler ve somut kanıt

Backend birim: learning-video.spec + mevcut scope testleri. Gerçek MySQL API:
video-learning.spec. UI: videos.test.jsx. Motor: test_learning_video.py.
Önceki PDF, auth, upload/delete, progress ve kaynak testleri de çalıştırıldı.
Komutlar ve son toplamlar IMPLEMENTATION_STATUS.md ve EVALUATION_RESULTS.md'de.

İstenen 10 senaryo:

1. Bilinen boş izleme → UNWATCHED; açıklama çağrısı yok.
2. Tam kaynak aralığı → WATCHED; kaynak uygunsa açıklama yolu.
3. Kaynağın bir kısmı → PARTIALLY_WATCHED; önce yönlendirme.
4. İleri sarılarak atlanan span → UNWATCHED; yüksek son konum sonucu değiştirmez.
5. Progress kaydı yok → UNKNOWN; [] varsayımı yapılmaz.
6. Güvenilir timestamp yok → UNKNOWN; jump veya sahte kaynak yok.
7. Şimdi açıkla → seçili kaynak + fresh progress; temiz gerçek materyalde
   yerel model ilk tur 4.224s, sıcak tekrar 0.857s; 1 gerçek kaynak,
   47.840–68.700s, GENERATED_UNVERIFIED. Bu iki örnek hız garantisi değildir.
8. Gerçek Edge jump → beklenen 0.05s, gerçek 0.05s. Erken tıklama ayrı testte.
9. Prim hatalı kaynak uyarısı; ayrı MST başvurusu. Dijkstra, Prim videosuna
   ait uydurma timestamp almadı. İki kavramın ters eşlemesi regresyonla korunuyor.
10. Başka user 404, anonymous 401; aynı fiziksel asset bile receipt'i paylaşamaz.

`scripts/test-learning-video.cjs` aynı fiziksel kaynakları yalnızca yeni özel test
kayıtlarına bağlar. Sınıflandırma gözlemleri bilinçli **scripted test fixtures**;
insan izleme/öğrenme sonucu diye sunulmaz. Tarayıcı, metadata, zamanlama ve temiz
kaynaktaki LLM çağrısı gerçektir. Bildirilen asıl videonun ilerlemesi önce/sonra
aynı kaldı. Kanıtlar data/video-tests/learning-run*.json ve learning-*.png içinde
Git dışındadır; öğrenci içeriği/kimlik bilgisi commit edilmez.

## Sınırlar

- Dar Prim/Dijkstra denetimi genel bir anlamsal doğruluk/entailment sistemi değildir.
  Diğer ASR/LLM/formül hataları mümkündür; bütün cevaplar doğrulandı denmez.
- Görsel-only kaynakta güvenilir transcript span yoksa UNKNOWN seçilir. OCR/görsel
  bölge modülü bu hata düzeltmesine eklenmedi.
- Ana kaynak span'ı kapsamak, konuyu öğrenmiş olmak değildir; birincil retrieved
  span yanlış/eş anlamı zayıfsa sınıflandırma pedagojik açıdan da sınırlıdır.
- Evidence seçimleri RAM'de, en çok 128 ve 10 dakika; restart/expiry sonrası
  soru yeniden gönderilir. Yeni kalıcı şema/worker/model gerekmedi.
- Eski lint/bundle/deprecation uyarıları ve API runner forceExit borcu sürer.
  OpenTutor, DocsGPT, mevcut modeller/ayarlar ve kullanıcı verileri korunur.
