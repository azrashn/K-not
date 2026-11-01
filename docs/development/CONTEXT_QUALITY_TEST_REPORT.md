# Bağlam, multimodal kanıt, ilerleme ve quiz — doğrulama

31 Ekim 2026. Başlangıç `cfb4a81`; dal `feature/video-integration`.
Talep: 80b47abd eki. Bu rapor önceki ürün test raporunu silmez veya onun
sonuçlarını yeni test gibi saymaz. Kod ve çalışan yerel servisler kullanıldı.

## Sonuç ve sınır

Bağlam/scope/izleme politikası ve ilerleme altyapısı uygulandı. PDF sayfası,
PPTX slaytı, gerçek video zamanı, seçili metin/bölge ve kalıcı mesaj referansı
sunucuda yetki/sürüm/konum açısından doğrulanır. Varsayılan kapsam hazır ders
materyalleridir; aktif viewer tek başına ders kapsamını daraltmaz.

Vision gerçek görüntü alır ama mevcut 2B modelin uzamsal/algoritmik doğruluğu
**PARTIAL**. Bildirilen grafik çözülemedi. Yanlış BFS/eksik DFS üreten ilk tur
başarı sayılmadı; yeniden kurulum/belirsizlik ve ikinci model geçişi kapıları
eklendi. Son gerçek test kesin sıra yerine `CLARIFICATION` döndürdü. Başlangıç
ve oklar görselde bulunsa bile küçük model bunları yanlış okuyabilir; açıklama
istemesi grafiği doğru anladığının kanıtı değildir. Üretimde BFS/city-specific
çözüm, fake vision veya yeni büyük model yoktur.

Quiz pipeline ve reddetme mekanizması çalışır; pedagojik/anlamsal doğruluk
**PARTIAL**, öğretmen onayı değildir. İki geçiş aynı yerel modeldedir.
Bir gerçek v2 MCQ kabul edildi; başka bir aday reddedildi. Gerçekten oynatılmış
video span'ından MCQ kalite kapısını geçemedi, soru yayınlanmadı.

## Kök neden → uygulanan değişiklik

- Viewer yalnız segment ID gönderiyordu; boş sayfa ve açık sayfa/slayt zamanı
  kaybolabiliyordu. `DocumentCanvas` ayrı viewport bildirir; boş PDF sayfası
  açık `empty` işaretli konum alır. İşaret, OCR/transkript gibi sunulmaz.
- Active material, arama kapsamı ve karşılaştırma referansı karışıyordu.
  `knowledge/context.ts` bunları ayrı doğrular; çoklu seçim ve source pin
  kontrolleri bağlandı. Foreign course/user/source/version kabul edilmez.
- Deiktik sorularda dar regex + zorunlu sözcük kesişimi bağlamı düşürüyordu.
  Tipli viewport kanıtı sözcük kesişiminden bağımsız olarak önceliklenir;
  genel mekânsal/zamansal ifade kökleri ve açık reference_mode desteklenir.
  Genel dil/anaphora çözümü hâlâ kestirimdir; belirsizlikte soru sorulur.
- PDF/PPTX render edilmesi vision anlamına gelmiyordu. Bounded PNG/JPEG,
  gerçek crop, source image hash/dimensions ve video frame_ms/image_source_id
  ile özgün pixel girişi eklendi. Açık bölge/etiket/bağlantı belirsizliğinde
  hesaplanmış cevap yayınlanmaz. İkinci denetim de doğruluk ispatı değildir.
- Genel kurs retrieval'ı vardı, fakat seçilen6kanıtın ilk3'ü modele giriyordu.
  Şimdi seçilen6–8kanıt üretim sözleşmesine girer. Aday bütçesi60, materyal
  çeşitliliği, tam tekrar ve örtüşen yakın video tekrarını eleme vardır.
  Kanıt dışlama gerekçeleri/debug ve gerçekten kullanılan atıflar ayrıdır.
- `onlyVideo` politikası PDF olduğunda rehberliği atlayabiliyordu. Açık hedef
  video veya pin, daha yüksek sıralanmış yardımcı PDF nedeniyle atlanmaz.
  Salt dokümanla çalışma gereksiz video kilidine alınmaz. Şimdi açıkla izni
  tek kullanıcı isteğine aittir; yeni konuya taşınmaz.
- Açıklama düğmeleri textarea dolduruyordu. Şimdi explicit response_mode,
  önceki özgün soru, kaynak snapshot'ı ve parent_message_id taşınır. Kısa
  çıktı uzunsa yalnız tam üretilmiş cümleler korunur; kaynak/citation korunur,
  rastgele sözcükten veya formülden kesilmez. Yetersiz biçim açıkça reddedilir.
- İlerleme union hesabı sunucuda zaten vardı; ortak viewer'da görünür değildi,
  pause tail eksikti. Son gerçek sample kapanışı, ayrı position/unique time,
  timeline, save status, retry ve görünür resume eklendi. Seek izleme değildir.
- Quiz ilk kaynağı kullanıyor, düşük kaliteli üretim literal MCQ'ya düşebiliyor
  ve public source.text cevabı açığa çıkarabiliyordu. Çoklu kaynak adayı,
  exact quote (yalnız whitespace eşdeğerliğine izin), structure/answer leak/
  option overlap kontrolleri ve kör seçenek-başına v2 audit eklendi. İki doğru
  seçeneği olan draft, genel flags true olsa bile reddedilir. Literal fallback
  kaldırıldı. Public allowlist answer/quote/full text/rationale içermez.
  Eski sorular silinmez; LEGACY_NOT_REVIEWED gösterilir.

## Değişen sözleşmeler ve dosyalar

`POST /courses/:course/knowledge/answers`, mevcut alanlara ek olarak:

- `scope`: mode=`course|active|selected`, selected için unique material_ids≤20.
- `viewport`: kind=`page|slide|video`; page/slide/timestamp_ms; optional
  selected_text≤1500 ve normalize region `{x,y,width,height}`. Konum gerçek
  materyal sınırlarında, seçili metin gerçek sayfa/span içinde olmalıdır.
- `explicit_source_ids`≤8, `response_mode`=`default|short|step_by_step|detailed|example`,
  `reference_mode`=`auto|viewport|conversation`, `parent_message_id`+chat_id,
  optional analyze_visual. Açıklama izni eski `explain_now` ile mesaj bazlıdır.
- Yanıt: `resolved_context`, `message_id`, `response_mode`, `learning_policy`,
  `retrieval.scope/searched/found_source_ids/used_source_ids/debug`, görsel
  provenance ve açık generation/quality durumları.
- Debug source metinleri herkese açık değildir; yanıt aynı course/user erişim
  kontrolündedir. UI teknik aday/dışlama dökümü yerine kaynak kartları gösterir.

`POST /courses/:course/quizzes`: scope + watched_only. Watched-only yalnız
gerçek interval union'ın tamamını kapsadığı video kaynaklarını aday yapar.
Son konum veya genel yüzde adaylığı sağlamaz. Kalite reddi HTTP422, servis
arıza/timeout ayrı hata sınıfıdır. Başarısız draft için SQL quiz oluşturulmaz.
Grading response, seçimden sonra expected/quote/explanation/option_feedback
ve tam kaynak verir. Choice input geçerli option index olmalıdır.

Yeni SQL tablo/migration yoktur. Mevcut LearningMessage/LearningQuiz JSON
alanları typed context, mode/scope ve quality v2 metadata tutar. VideoProgress
aralık birleşimi/ayrı son konum şeması korunur. Kullanıcı verisi resetlenmedi.

Ana backend dosyaları: `backend/src/knowledge/{context.ts,knowledge.controller.ts,
knowledge.service.ts}`, `backend/src/learning/{history.service.ts,
learning.controller.ts,learning.service.ts}`. Ana AI dosyaları:
`ai-service/src/knot_rag/{unified.py,explanations.py,visual_context.py,
quiz_quality.py,structured.py}`, `generation/providers/{base.py,openai_compatible.py}`.
Frontend: `LearningWorkspace`, `DocumentCanvas`, `VideoProgressPanel`,
`CourseQuiz`, `useVideoProgress`, `watch-tracker`, `product.css`.
Pillow13.0.0 zaten izole ortamda vardı; gerçek crop için dependency ilan edildi.
Black yalnız uv araç cache'inde çalıştırıldı, global Python/Node değiştirilmedi.

## Otomatik testler (benzersiz test sayıları)

- `npm test -- --reporter=dot`: **92/92** (React/DOM, HTTP/model doubles).
- Backend `npm run test:unit -- --runInBand`: **94/94** (unit doubles).
- `node scripts/test-backend-api.cjs`: **121/121**, gerçek Nest/MySQL;
  Python/model/video boundary fake. Her tur yeni `knot_test_w1_*` şeması,
  production DB reset yok. Son API kalite/policy değişiklikleri için aynı
  suite'in knowledge altkümesi **23/23** tekrar geçti, toplama eklenmez.
- AI `.venv/Scripts/python.exe -m pytest -q`: **447/447**. Gerçek extraction,
  Chroma/hashing ve validation; provider testleri doubles. 39 dependency
  deprecation warning var, gizlenmedi.
- `node scripts/test-backend-api.cjs --integration`: **1/1** gerçek Python +
  MySQL + hashing/extractive. Bu bir gerçek generative AI testi değildir.
- Toplam **755**. Önceki726ya göre **29 yeni**. Tekrarlanan15frontend/23API/
  45Python altkümesi veya gerçek senaryo adımları toplama tekrar eklenmez.
- Frontend production build ve backend TypeScript build geçti. Build'de
  ~563KB bundle/oxc-esbuild uyarıları; lint exit0 ama mevcut warnings var.
  Kullanıcıya ait untracked skill bundle'ları lint'in warning sayısını da
  artırır; bunlar değiştirilmedi. Bu rapor warning-free iddiasında değildir.

## Gerçek servis / model / tarayıcı komutları

Fixture'lar yalnız kendi test hesabının izole demo derslerine eklenir;
mevcut kullanıcı materyalleri/ilerlemeleri temizlenmez. Yeniden çalıştırmak
gerektiğinde aşağıdaki sıra kullanılır; bunlar opt-in canlı testlerdir.

1. `node scripts/test-context-browser.cjs`: gerçek iki PDF, PPTX, iki gerçek
   engine video referansı; Chroma/text embedding, gerçek model ve Edge.
   Beklenti: scope izolasyonu, viewport/crop, native play/seek/union,
   ağ hatası/retry, reload/resume ve citation navigation. Sonuç: bütün
   çalıştırılan kontroller PASS; gerçek background desktop tab test edilmedi.
   %0,6 izleme /6:54son konum ayrımı gözlendi; sona seek %100 yapmadı.
2. `node scripts/test-context-active.cjs`: PDF sayfa4, PPTX slayt3, gerçek
   native seçili metin, eksik viewport'ta açıklama sorusu; izlenmemiş video
   rehberliği/mesajlık izin. Sonuçları `active-context-run.json` tutar.
3. `node scripts/test-context-modes-quiz.cjs`: özgün tutarlı İngilizce integral
   notu; gerçek Qwen3-VL2B. Son tur kısa36 / adım225 / ayrıntı193 / örnek157
   kelime, dört farklı GENERATED_UNVERIFIED çıktı. v2 MCQ ilk aday422, ikinci
   aday201; seçenekleri, gizlenen alanlar ve gerçek grading doğrulandı.
   İngilizce örnek Türkçe tüm alanlarda kalite garantisi değildir.
4. `node scripts/test-context-learning-loop.cjs`: gerçek Edge'de gizli
   answer/quote, yanlış şık feedback, SQL sonucu/refresh ve source navigation
   PASS. Gerçek player396800–405800ms transkript span'ını tamamen kapsayan
   396107–406086ms gözlem kaydetti. Watched-only quiz bu gerçek adaydan
   kalite reddi aldı (PARTIAL); sahte soru eklenmedi. Gerçek frame40,
   400433ms özgün görüntüsü modele ulaştı, cevap CLARIFICATION (görsel
   çözüm doğruluğu PARTIAL). İlk browser turunda animasyon/focus yüzünden
   giriş düğmesi disabled kaldı; input focus/reduced motion ile test düzeltildi.
5. `node scripts/test-reported-graph.cjs`: Graphs Part - 2 (1), sayfa4,
   özgün alt crop1206×395; IMAGE_PROVIDED + RECONSTRUCTION_NOT_CONFIRMED,
   CLARIFICATION. Hesaplanmış BFS/DFS başarısı olarak sayılmaz.

Private JSON, ekran görüntüleri ve gerçek kullanıcı/source kimlikleri ignored
`data/context-tests/` altında; credentials, orijinal PDF/video veya transcript
Git'e eklenmez. `context-progress-desktop.png` ve `context-learning-loop.png`
gerçek browser görüntüleridir. Önceki başarısız model turları `*-initial` ve
`*-v1` kayıtlarında korunur. Test assertion PASS ile model generation status
raporda ayrı tutulur; GENERATED_UNVERIFIED bir doğruluk kararı değildir.

## İstenen35senaryonun durumu

IMPLEMENTED = kod/sözleşme çalışıyor; aşağıdaki PASS'in test sınırı belirtilir.
PARTIAL = çalışan bölüm yanında doğrulanmamış veya başarısız bölüm var.

1. **IMPLEMENTED / PASS** — aktif PDF sayfa4; gerçek API/model + Edge viewer.
2. **IMPLEMENTED / PASS** — aktif PPTX slayt3; gerçek API/model + özgün render.
3. **PARTIAL** — gerçek video zamanı/span/frame modele ulaştı; görsel çözüm
   güvenilirliği sağlanmadı, CLARIFICATION.
4. **PARTIAL** — “alttaki örnek” doğru sayfa/bölgeye bağlandı; gerçek grafiğin
   BFS/DFS hesaplaması mevcut modelle başarılı değil.
5. **IMPLEMENTED / PASS** — kayıtlı özgün mesaj referansı ve takip/reformulation;
   API SQL testleri + gerçek mode testinde parent_message_id.
6. **IMPLEMENTED / PASS** — kaynak/viewport belirsizliğinde gerçek açıklama sorusu.
7. **IMPLEMENTED / PASS** — iki PDF; gerçek kaynak ID'leri seçili kapsam içinde.
8. **IMPLEMENTED / PASS** — PDF + video, ikisi de gerçek evidence içinde.
9. **IMPLEMENTED / PASS** — PDF + PPTX, ikisi de gerçek evidence içinde.
10. **IMPLEMENTED / PASS** — üç materyal; PDF/PPTX/video birlikte evidence.
11. **IMPLEMENTED / PASS** — tüm ders;5hazır materyal searched manifest'inde.
12. **IMPLEMENTED / PASS** — yalnız açık materyal; diğer kaynak kanıtı sızmaz.
13. **IMPLEMENTED / PASS** — farklı ders scope/source404; gerçek API ve SQL testleri.
14. **IMPLEMENTED / PASS** — hiç izlenmemiş span önce gerçek GUIDANCE;
   açıklama tek istek için GENERATED_UNVERIFIED, yeni konu tekrar GUIDANCE.
15. **IMPLEMENTED / PASS** — kısmi span tam izlenmiş sayılmaz; unit/API + native playback.
16. **IMPLEMENTED / PASS** — ileri/geri paused seek aradaki bölümü izlemez.
17. **IMPLEMENTED / PASS** — replay ve2x gerçek native playback, union çift saymaz.
18. **IMPLEMENTED / PASS** — benzersiz süre/yüzde gerçek API ve timeline'da.
19. **IMPLEMENTED / PASS** — refresh + SQL position korunur, paused timer sıfırlamaz.
20. **IMPLEMENTED / PASS** — resume position_ms kullanır; yüzdeyle konum hesaplanmaz.
21. **IMPLEMENTED / PASS** — gerçek transkript düğmesi20440ms'ye doğru videoda gider.
22. **IMPLEMENTED / PASS** — iki video arasında geçiş; ayrı progress/position.
23. **IMPLEMENTED / PASS** — kaynak/seek navigasyonu watched_ms artırmadı.
24. **IMPLEMENTED / PASS** — gerçek kısa36kelime; önceki cevabın aynısı değil.
25. **IMPLEMENTED / PASS** — gerçek ayrıntı193kelime; üçten fazla kaynaklı iddia.
26. **IMPLEMENTED / PASS** — gerçek adım225kelime, numaralı source-linked çıktı.
27. **IMPLEMENTED / PASS** — eski mesaj snapshot'ıyla reformulation;
   başka kullanıcı/mesaj referansları SQL API testlerinde reddedilir.
28. **IMPLEMENTED / PASS** — foreign/missing/changed source404 veya açıklama;
   eski geçersiz görsel cevabı hesaplanmış sonuç gibi yeniden sunulmaz.
29. **IMPLEMENTED / PASS** — video hedefi varken yardımcı PDF rehberliği atlatmaz;
   PDF-first sıralama özellikle API regression'a alındı. Tek mesajlık izin.
   Son gerçek guidance turunda yalnız video evidence bulundu; PDF-first
   kombinasyonu SQL API sınırında programlanmış retrieval ile doğrulandı.
30. **PARTIAL** — gerçek kaynaklı v2 MCQ/feedback var; genel pedagojik kalite
   öğretmen/kapsamlı farklı alan değerlendirmesiyle doğrulanmadı.
31. **PARTIAL** — per-option audit + iki doğru şıklı draft reddi unit testinde;
   küçük model denetimi matematiksel tek-doğruluk kanıtı değildir.
32. **IMPLEMENTED / PASS** — yanlış seçeneğin açıklaması cevap sonrası gerçek Edge'de.
33. **IMPLEMENTED / PASS** — gerçek quiz feedback'ten ilgili kaynak açılır;
   bu tur kabul edilen source TXT'dir, yeni gerçek video MCQ üretilemedi.
34. **IMPLEMENTED / PASS** — SQL attempt ve refresh sonrası quiz history.
35. **PARTIAL** — gerçek oynatılmış span adaylığı ve skipped/PDF dışlaması
   çalışır; o video span'ından gerçek quiz model kalite kapısını geçemedi.

## Kalan riskler / ertelenenler

- Background tab politikası unit seviyesinde testli, gerçek masaüstü tab
  görünürlüğü/headless farkı nedeniyle canlı background testi PARTIAL.
- Ağ hatasında pending aralıklar mounted session'da tutulup retry edilir.
  Ağ kesikken tab kapanır/yenilenirse disk üzerinde garantili offline outbox
  yoktur. Bu özellik MISSING; başarılı sunucu kaydı normal refresh'te kalıcıdır.
- Seçili metin gerçek çıkarılmış metin panelinden alınır. Özgün PDF canvas
  üzerinde karakter koordinatlı text layer yoktur; bu alt özellik MISSING.
- Native text/E5/Chroma ortak indeksi gerçek; ortak visual-vector ANN indeksi
  bu aşamada eklenmedi. Text-first retrieval + ihtiyaç anında özgün görüntü
  kullanılır. Semantik adayların lexical guard'ı ve60aday bütçesi recall sınırı.
- ASR hatalarının genel otomatik düzeltilmesi yoktur; yakın tekrar eleme
  timestamp'leri birleştirip uydurmaz. Speaker/slide scene segmentation bu
  talep kapsamında yeni baştan kurulmadı; karmaşık kaynak hataları PARTIAL.
- Aynı2B model iki geçişte de yanılabilir. Daha iyi model/evaluation ancak
  ayrı kaynak/lisans/boyut değerlendirmesi ve gerekirse kullanıcı onayıyla.
- GPU son ölçümü: RTX5060Laptop,8151MiB total;3542MiB used/4358MiB free.
  Bu tüm masaüstü anlık ölçümüdür; yalnız K-NOT tüketimi veya peak ölçümü değil.
  Büyük yeni model/ücretli API/paylaşılan Ollama değişikliği yapılmadı.
- Yalnız K-NOT servisleri kontrollü restart edildi. OpenTutor3001/8100 Docker
  healthy, DocsGPT DB/Redis çalışır; kodları, container/volume/port/model
  ayarları değiştirilmedi. Önceki videoların progress SQL snapshot'ı eşit kaldı.
  Son salt okunur HTTP kontrolünde OpenTutor frontend3001=200;8100/health
  endpoint'i, DocsGPT5173 ve7091/health yanıt vermedi. Bunlara müdahale edilmedi.

## Kullanım

`http://127.0.0.1:5174/#/dersler` → ders → ortak çalışma. Arama kapsamını
seç; checkbox yalnız retrieval'ı belirler, materyal düğmesi viewer'ı açar.
Sayfa/slayt seç; istersen Bölge seç veya çıkarılmış metinde ifade seç.
Cevaptaki kaynak checkbox'ları açık karşılaştırma referansıdır. Video
ilerlemesini player altında izle; kayıt hatasında Tekrar kaydet. Modelin
belirsizlik istemesini doğrulanmış görsel çözüm olarak değerlendirme.

Başlatma `scripts/Start-KnotVideo.ps1`, güvenli durdurma
`scripts/Stop-KnotVideo.ps1`; ikisi de kendi servis sahipliğini doğrular.
Detaylı geliştirme devam noktası: CONTEXT_QUALITY_FIX.md / REMAINING_WORK.md.
