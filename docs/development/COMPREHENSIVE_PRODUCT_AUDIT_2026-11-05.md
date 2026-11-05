# K-NOT kapsamlı ürün ve tamamlanma analizi

**İnceleme tarihi:** 5 Kasım 2026 · **Dal:** feature/video-integration · **HEAD:** 3b8241f92ce2087c31e48489e50dd828350c3d92 + mevcut commit edilmemiş quiz değişiklikleri.

## Karar

K-NOT geliştirilmeye değer, çalışan bir yerel materyal ve kaynaklı soru-cevap prototipi. Hedeflenen bütünleşik öğretici ürün henüz tamamlanmış değil. En büyük boşluk, öğrencinin sorusunu yanıtlamaktan öğrencinin öğrenmesini yöneten bir oturuma geçiş. UI iyileştirmesi, quiz doğruluğu ve öğretim davranışı birlikte ele alınmalı. Yeni repo/mikroservis yığınına geçmek veya tüm uygulamayı yeniden yazmak bu bulguların gerektirdiği bir sonuç değil.

“Bütün sorunlar bulundu” garantisi verilemez. Bu rapor incelenen kod yolları, canlı ekranlar, bugünkü testler ve tarihli önceki gerçek test kayıtlarıyla sınırlıdır. Koddan çıkarılan yarış/kapasite riskleri, bu tur yeniden üretilmiş hata olarak sunulmamıştır. Eğitimsel kalite yorumları teknik inceleme niteliğindedir; öğretmen kabulünün yerini tutmaz.

## İnceleme ve yeni kanıt

- Docker başlangıçta kapalıydı; açıldıktan sonra K-NOT'un mevcut başlatma betiği çalıştı. Bekleyen DB migrasyonu yoktu. UI5174, backend3100, AI8110, MomentSearch7862 başlatıldı. Kaynak kodu değişikliği, veri reseti, model indirme veya diğer projelere müdahale yapılmadı.
- Gerçek Edge oturumunda test hesabıyla Ana Sayfa, Quiz ve Algoritma çalışma alanı incelendi. Yeni içerik/soru kullanıcı hesabına eklenmedi. Normal ekran açılışı oturum/etkinlik gibi uygulamanın rutin kayıtlarını etkileyebilir.
- Frontend: `node node_modules/vitest/vitest.mjs run --reporter=dot` → **92/92**, 12 dosya, 67.89s.
- Backend: `node node_modules/jest/bin/jest.js --config jest.config.js --selectProjects unit --runInBand` → **100/100**, 11 suite, 52.319s.
- AI: `.venv/Scripts/python.exe -m pytest -q` → **468/468**, 107.72s, 39 uyarı.
- Toplam **660** otomatik test; eşzamanlı çalıştırılan süreler ürün gecikmesi değildir. API/MySQL entegrasyon paketinin tamamı ve tüm eski browser senaryoları bu tur yeniden çalıştırılmadı.
- Oxlint JSON: 184 dosya, **244 warning**. Bu uyarıların hepsi kullanıcı hatası veya güvenlik açığı değildir.
- GPU anlık boşta gözlem: RTX5060 Laptop, 8151MiB toplam; kullanılan bellek 0MiB raporlandı. Bu model yükündeki tepe tüketimi değildir.
- Özel Ollama11436 listesi: qwen3-vl:2b-instruct (1,930,568,531 byte), qwen3-vl:2b (1,889,519,687 byte). Onaylanan 4B model kurulu listede yok.

## Gerçek quiz denemesi

Komut: ai-service içinden `.venv/Scripts/python.exe ../scripts/evaluate-quiz-quality.py`. Aynı mevcut 2B yerel modelle, betikte bulunan üç kısa ve kontrollü eğitim metni kullanıldı. Bu gerçek model çağrısıdır; gerçek PDF/video indeksleme testi değildir. Kullanıcı kursuna soru veya cevap yazmaz.

- Önceki 3b8241f akışı: BFS/DFS 422 /20.93s; klorofil 422 /11.88s; kaynakta olmayan fotosentez 422 /7.86s. İlk iki ret kullanım başarısızlığıdır. Son ret güvenli sonuç verse de nedenin konu kontrolü olduğu kanıtlanmış değildir.
- Yeni çalışma ağacı: BFS/DFS 422 /1.28s; klorofil 200 /7.06s; kaynakta olmayan fotosentez 422 /1.11s. Son örnek doğru biçimde konu bulunamadı olarak reddedildi. Yeni akış iki cevaplanabilir örnekten yalnız birini yayımladı; üç örnek genel başarı oranı çıkarmaya yetmez.
- Yayımlanan soru: “Klorofilin fotosentezdeki görevi nedir?” Doğru seçenek: “Işık enerjisinin yakalanması”. Gösterilen öğrenme hedefi aynı cevabı başka sözcüklerle açıklıyor. Geri bildirimde “Klorofil, oksijen üretimiyle ilgili bir rol değil” gibi bozuk/yanlış anlaşılabilir dil var. Bu nedenle HTTP200 **pedagojik PASS değildir**.
- Önceki `before-after.json` sonuçları farklıydı; modelin küçük örneklerde tutarsızlığını da gösterir. İyi çıkan tur seçilip başarı diye sunulmamalıdır.
- Matematik normalizasyonu ayrı çalıştırıldı: `canonical('x+y')`, `canonical('x-y')`, `canonical('x*y')`, `canonical('x/y')` hepsi `x y`. Kod düzeltmesi yapılmadı.

Kanıtlar: [gerçek model çıktısı](../../data/quiz-evaluation/before-after-qwen3-vl-2b-instruct.json), [quiz ekranı](../../output/playwright/audit-quiz-20261105.png), [çalışma ekranı](../../output/playwright/audit-workspace-20261105.png), [lint çıktısı](../../output/playwright/audit-lint-20261105.json). Model çıktıları ve test hesabı verileri Git dışındaki yerel kanıtlardır; secret dosyaları rapora alınmadı.

## Korunması gereken mevcut temel

Ders/materyal yönetimi, gerçek kaynak depolama, PDF/PPTX görüntüsü, video transkripti ve kareler, ortak metin retrieval, aktif sayfa/zaman/bölge sözleşmeleri, kaynak konumuna dönüş, kalıcı sohbet/quiz/attempt, izlenen aralık birleşimi, son konumun ayrı saklanması ve temel kullanıcı/ders yetkilendirmesi mevcut. Bunların kodu ve testleri var; bu tur hepsinin gerçek AI kalitesi tekrar ölçülmedi. Eski mock Home/Quiz/Analytics dosyalarının bulunması aktif sayfaların mock olduğu anlamına gelmez: App.jsx yeni gerçek ekranları bağlıyor.

## Öncelik dili

**P0:** Güvenilir eğitim demosunun önünü kesen kalite sorunları. **P1:** Tamamlanabilir ilk ürünün gerekli işi. **P2:** Sonraki olgunlaştırma. **P0-yayın/P1-yayın:** Yerel prototipten çok kullanıcılı/uzak erişimli yayına geçmeden kapanmalı; bugün dışa açık bir servis tespit edildiği anlamına gelmez.

## Bulgular

### Öğretici deneyim

#### K01 · P1 · Öğrenciyi yöneten öğretim oturumu yok

**Durum:** Eksik.

**Kanıt:** Aktif akış knowledgeAnswer çağrısını öğrencinin gönderdiği soruyla başlatıyor; response_mode yalnız anlatım biçimini değiştiriyor.

**Etkisi:** Öğrenci ne soracağını bilmiyorsa öğrenme süreci başlamıyor.

**Gereken:** Öğrenme hedefi → tanılama sorusu → öğrenci yanıtı → ipucu → yeniden deneme → açıklama → transfer sorusu durumlarını kalıcı bir oturumda tut.

**Kabul:** Üç farklı konuda, öğrenci ilk içerik sorusunu yazmadan sistem kaynaklı tanılama sorusu sorabilsin; cevap gelmeden çözümü açıklamasın.

**Kod/iz:** `src/pages/LearningWorkspace.jsx`.

#### K02 · P1 · Netleştirme sorusu ile öğretim sorusu aynı şey değil

**Durum:** Eksik.

**Kanıt:** explanations.py belirsiz görüntü veya eksik kanıt için clarification üretiyor; öğrencinin kavrayışını ölçen aşama yok.

**Etkisi:** “Hangi sayfa?” sorusu öğretmen davranışının tamamlandığı izlenimini verebilir.

**Gereken:** Bağlam netleştirme, tanılama, ipucu ve kavram kontrolünü ayrı amaçlarla modelle.

**Kabul:** Doğru, yanlış, kısmen doğru ve bilmiyorum yanıtlarının her biri farklı sonraki öğretim adımına ulaşsın.

**Kod/iz:** `ai-service/src/knot_rag/explanations.py`.

#### K03 · P1 · Öğrenci seviyesi ve öğrenme hedefi tutulmuyor

**Durum:** Eksik.

**Kanıt:** Kalıcı şemada kullanıcıya bağlı kavram yeterliği, hedef, ön koşul ve öğretim oturumu modeli bulunmuyor.

**Etkisi:** Başlangıç öğrencisi ile ileri öğrenci aynı anlatımı alıyor.

**Gereken:** Ders hedeflerini ve ön koşulları kaynaklardan öner, kullanıcı/öğretmen onayıyla kaydet; yeterliği kanıt ve belirsizlikle tut.

**Kabul:** Aynı konuda farklı ön bilgiye sahip iki öğrenciye gerekçesi görülebilen farklı adımlar önerilsin.

**Kod/iz:** `backend/prisma/schema.prisma`.

#### K04 · P1 · Konu keşfi ve ders haritası yok

**Durum:** Eksik.

**Kanıt:** RELATED_TOPIC ilişkileri metin ortaklığıyla hesaplanıyor; kalıcı, gezilebilir konu/ön koşul haritası yok.

**Etkisi:** Kullanıcı doğru konu adını kendisi bulmak zorunda.

**Gereken:** Materyallerden kaynak konumlu konu taslağı çıkar; hiyerarşi ve ön koşulları düzenlenebilir yap.

**Kabul:** Her konu en az bir gerçek kaynak konumuna açılsın; onaysız ilişki kesin bilgi olarak sunulmasın.

**Kod/iz:** `ai-service/src/knot_rag/unified.py`.

#### K05 · P1 · İpucu basamakları ve hata teşhisi yok

**Durum:** Eksik.

**Kanıt:** Yanıt sonrası çoğunlukla sabit açıklama, cevap anahtarı ve kaynak gösteriliyor.

**Etkisi:** Yanlış cevabın neden verildiği öğrenilemiyor.

**Gereken:** Kavram yanılgısı etiketleri ve cevabı hemen açıklamayan kademeli ipuçları ekle.

**Kabul:** Yanlış cevapta önce uygun ipucu, sonra yeni deneme; gerekirse kaynaklı çözüm sunulsun.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K06 · P2 · Aralıklı tekrar ve transfer takibi yok

**Durum:** Eksik.

**Kanıt:** Öneri son denemelerden REVIEW_SOURCE seçiyor; tekrar zamanı veya yeni bağlamda uygulama modeli yok.

**Etkisi:** Aynı cevabı ezberlemekle konuyu öğrenmek ayrışmıyor.

**Gereken:** Tekrar takvimi, eşdeğer yeni soru ve gecikmeli ölçüm tasarla.

**Kabul:** Eski soruyu tekrar doğru yapmak tek başına konu hâkimiyetini yükseltmesin.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

### Quiz

#### K07 · P0 · Açık BFS/DFS kaynağından soru üretilemiyor

**Durum:** Gerçek testte başarısız.

**Kanıt:** 5 Kasım gerçek 2B testinde yeni akış iki kez exact-source plan denetiminde reddedildi; HTTP422, 1.28 saniye.

**Etkisi:** Hocaya gösterilecek temel algoritma senaryosu güvenilir değil.

**Gereken:** Planın kısa ve birebir kaynak cevabı seçmesini sağlamlaştır; onaylanmış 4B modeli ayrı değerlendirmede karşılaştır.

**Kabul:** Etiketli algoritma setinde kaynak bulunduğu halde ret oranı ölçülsün ve kabul eşiğini karşılasın.

**Kod/iz:** `ai-service/src/knot_rag/quiz_planning.py`.

#### K08 · P0 · Öğrenme hedefi cevabı ele verebiliyor

**Durum:** Gerçek testte doğrulandı.

**Kanıt:** Üretilen klorofil sorusunun hedefinde “ışık enerjisini nasıl yakaladığını” yazıyor; doğru seçenek “Işık enerjisinin yakalanması”. Mevcut denetim yalnız sözcüksel kapsama bakıyor.

**Etkisi:** Öğrenci cevabı anlamadan hedef metninden çıkarabilir; test sonucu yanıltıcı olur.

**Gereken:** Hedefi cevap öncesinde kavramsal ve cevapsız biçimde göster; anlamsal cevap sızıntısı değerlendirmesi ekle.

**Kabul:** Öğretmen etiketli sızıntı örnekleri reddedilsin; hedef hiçbir dilbilgisel dönüşümle anahtarı açıklamasın.

**Kod/iz:** `ai-service/src/knot_rag/quiz_quality.py`.

#### K09 · P0 · Aynı modelin kör incelemesi doğruluk güvencesi değil

**Durum:** Kısmen çalışıyor.

**Kanıt:** Yazıcı ve denetçi aynı model nesnesi/model adıyla çalışıyor; truth_verified=False. Gerçek biyoloji çıktısı hâlâ dil ve geri bildirim kusurlu.

**Etkisi:** İki çağrı da aynı kavramsal yanlışı kabul edebilir.

**Gereken:** Öğretmen tarafından etiketli kabul seti, bağımsız ölçümler ve uygun alanlarda deterministik cevap kontrolü ekle.

**Kabul:** Tek doğru cevap, kaynak desteği ve çeldirici kalitesi ayrı ayrı insan etiketleriyle ölçülsün.

**Kod/iz:** `ai-service/src/knot_rag/quiz_quality.py`.

#### K10 · P1 · Matematik seçenekleri birbirine karışıyor

**Durum:** Kodla yeniden üretildi.

**Kanıt:** canonical fonksiyonu x+y, x-y, x*y, x/y ifadelerinin dördünü de x y yapıyor.

**Etkisi:** Geçerli matematik soruları duplicate diye reddedilir; sembol anlamı kaybolur.

**Gereken:** Matematiksel operatörleri koruyan normalizasyon ve uygun eşdeğerlik kontrolü kullan.

**Kabul:** Dört işlem şıkları farklı kalırken boşluk/yazım kaynaklı gerçek tekrarlar yakalansın.

**Kod/iz:** `ai-service/src/knot_rag/quiz_quality.py`.

#### K11 · P1 · Onaylanan 4B model kurulumu ve kabulü bitmemiş

**Durum:** Eksik.

**Kanıt:** 5 Kasım özel 11436 tags listesinde yalnız iki Qwen3-VL 2B etiketi var; 4B yok.

**Etkisi:** Önceki model yükseltme çalışması aktif özellik sayılamaz.

**Gereken:** Mevcut indirmeyi güvenli biçimde tamamla; aynı setle ölç; yalnız sonuç uygunsa QUIZ_LLM ayarını değiştir.

**Kabul:** Model listesi, gerçek üretim sonuçları, VRAM ve gecikme kaydı birlikte bulunmalı.

**Kod/iz:** `docs/development/QUIZ_IMPROVEMENT_PLAN.md`.

#### K12 · P1 · Soru seti, zorluk ve kazanım dağılımı yok

**Durum:** Eksik.

**Kanıt:** Üretim ONE question; Start DTO yalnız topic/kind/scope/watched_only alıyor.

**Etkisi:** Beş veya on soruluk tutarlı çalışma, kolaydan zora ilerleme yapılamıyor.

**Gereken:** QuizSession ve soru planı; adet, zorluk, kazanım, tekrar önleme ve kapsam dengesi ekle.

**Kabul:** Bir set hedeflenen kazanımları kapsasın, aynı sorunun yakın kopyalarını içermesin.

**Kod/iz:** `backend/src/learning/learning.controller.ts`.

#### K13 · P1 · Beş soru türü aynı olgunlukta değil

**Durum:** Kısmen çalışıyor.

**Kanıt:** Kaynak planı yalnız MULTIPLE_CHOICE için çalışıyor; diğer türler eski üretim yolunda.

**Etkisi:** Tür değiştirerek kalite sorunlarının çözüleceği varsayılamaz.

**Gereken:** Her tür için ayrı kaynak planı, uygun doğrulama ve kabul seti oluştur.

**Kabul:** Her türde gerçek Türkçe kaynaklarla başarı ve yanlış kabul oranları ayrı raporlansın.

**Kod/iz:** `ai-service/src/knot_rag/quiz_quality.py`.

#### K14 · P1 · Açık/kısa cevapta rubrik değerlendirmesi yok

**Durum:** Eksik.

**Kanıt:** OPEN yalnız kaydediliyor; SHORT_ANSWER tam metin eşleşirse 1, eşleşmezse null.

**Etkisi:** Doğru paraphrase, kısmi çözüm ve kavram yanılgısı öğretici şekilde değerlendirilmiyor.

**Gereken:** Kaynaklı rubrik, ölçüt bazlı gerekçe ve emin olunmayan durumda inceleme gereği ekle.

**Kabul:** Anlamca doğru farklı ifadeler kabul edilsin; kısmi puan ve gerekçe rubriğe bağlansın.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K15 · P1 · Boşluk doldurmada farklı doğru ifadeler yanlış sayılabilir

**Durum:** Kodda doğrulandı.

**Kanıt:** CLOZE exact türler arasında; Türkçe küçük harf/NFC dışında eşdeğerlik yok; eşleşmeyen cevap score=0.

**Etkisi:** Yazım veya kabul edilebilir eş anlamlı yanıt öğrenciye yanlış sonucu verebilir.

**Gereken:** İzin verilen cevap varyantları veya gözden geçirme durumu kullan; mesajı puanla uyumlu yap.

**Kabul:** Eşdeğer yanıt testleri ve noktalama/birim/ek varyantları tanımlı politikaya göre işlensin.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K16 · P1 · Ders değişimi sırasında eski istek sonucu gelebilir

**Durum:** Koddan belirlenen risk.

**Kanıt:** CourseQuiz formu busy sırasında ders seçimini açık tutuyor; start sonucu mevcut dersle eşleştirilmiyor; selectedMaterials sıfırlanmıyor.

**Etkisi:** Yeni ders ekranına eski quiz ya da önceki kapsam seçimi taşınabilir.

**Gereken:** İstek kimliği/AbortController kullan; ders değişiminde tüm bağlı durumu temizle.

**Kabul:** Geciktirilmiş üretim sırasında ders değiştirildiğinde eski soru yeni derste görünmesin.

**Kod/iz:** `src/pages/CourseQuiz.jsx`.

#### K17 · P2 · Yanıt geçmişinin ayrıntıları yeniden açılmıyor

**Durum:** Eksik.

**Kanıt:** Quiz GET publicQuiz döndürüyor; UI geçmiş soru açınca result=null yapıyor. Attempt geçmişi ayrıntılı yeniden görüntüleme akışı yok.

**Etkisi:** Öğrenci önceki cevabını ve ona verilen geri bildirimi inceleyemiyor.

**Gereken:** Attempt ayrıntı endpointi ve önceki yanıt/geri bildirim görünümü ekle.

**Kabul:** Yenileme sonrası önceki cevap ve geri bildirim aynı biçimde açılabilsin.

**Kod/iz:** `src/pages/CourseQuiz.jsx`.

#### K18 · P2 · Soru itirazı ve öğretmen onayı yok

**Durum:** Eksik.

**Kanıt:** Soru yayımlama/işaretleme/düzenleme/onay kuyruğu veri modeli bulunmuyor.

**Etkisi:** Hatalı sorular geri bildirimle sistematik iyileştirilemiyor.

**Gereken:** “Soruda sorun var” ve öğretmen inceleme durumu ekle; sürümlü soru bankası oluştur.

**Kabul:** İtirazlı soru yeni öğrencilere verilmeden incelemeye alınabilsin.

**Kod/iz:** `backend/prisma/schema.prisma`.

### UI / UX

#### K19 · P1 · Çalışma alanı boş başlangıç yükünü kullanıcıya bırakıyor

**Durum:** Tarayıcıda gözlendi.

**Kanıt:** Algoritma dersinde dört materyal mevcutken orta panel “Bir materyalle başla” gösteriyor.

**Etkisi:** Dersin ne anlattığı ve nereden başlanacağı belirsiz.

**Gereken:** Ders özeti, önerilen başlangıç/son konum ve belirgin “Birlikte öğren” girişi sun.

**Kabul:** İlk kullanıcı 30 saniyede bir materyal veya rehberli öğrenme adımı başlatabilsin.

**Kod/iz:** `src/pages/LearningWorkspace.jsx`.

#### K20 · P1 · Quiz formu uzun, ana eylem aşağıda kalıyor

**Durum:** Tarayıcıda gözlendi.

**Kanıt:** 1280×720 görüntüde sağ alan büyük ölçüde boş; sol formun Alıştırma hazırla düğmesi görünür alanın altında.

**Etkisi:** Kullanıcı birden fazla ayarla uğraşıyor ve başlangıç eylemini arıyor.

**Gereken:** Konu önerileriyle sade başlangıç, gelişmiş ayarların açılır alanı ve görünür ana eylem tasarla.

**Kabul:** 720px yükseklikte ilk eylem açıkça görünür ve klavyeyle erişilebilir olsun.

**Kod/iz:** `src/pages/CourseQuiz.jsx`.

#### K21 · P1 · Çalışma alanından quiz’e bağlam eksik aktarılıyor

**Durum:** Kodda doğrulandı.

**Kanıt:** Alıştırma bağlantısı yalnız topic taşıyor; aktif sayfa/zaman, seçilen kaynaklar ve kapsam aynı sözleşmeyle taşınmıyor.

**Etkisi:** “Bu bölümden soru sor” tüm dersten farklı soru üretmeye dönüşebilir.

**Gereken:** Tek LearningContext sözleşmesini quiz intent ve sunucu kapsamına aktar.

**Kabul:** PDF4 veya video12:46 üzerinden başlatılan quiz belirtilen bağlama bağlı olsun; kapsam kullanıcıya gösterilsin.

**Kod/iz:** `src/pages/LearningWorkspace.jsx`.

#### K22 · P1 · Bekleme, iptal ve yeniden deneme deneyimi zayıf

**Durum:** Eksik.

**Kanıt:** Quiz’de yalnız buton yazısı değişiyor; çalışma alanında streaming yok; isteğe bağlı kullanıcı iptali yok.

**Etkisi:** Uzun yerel model bekleyişi donma gibi hissediliyor.

**Gereken:** Gerçek aşama bilgisi, geçen süre, güvenli iptal ve son girdiyi koruyan retry ekle.

**Kabul:** İptal edilen istek sonradan aktif cevabı değiştirmesin; sahte yüzde gösterilmesin.

**Kod/iz:** `src/pages/CourseQuiz.jsx`.

#### K23 · P2 · Panel boyutları kullanıcı tarafından ayarlanamıyor

**Durum:** Kodda doğrulandı.

**Kanıt:** workspace-grid sabit kaynak rayı ve sınırlı asistan sütunuyla tanımlı.

**Etkisi:** Uzun formül, slayt ve sohbet aynı ölçüde rahat okunmuyor.

**Gereken:** Sürüklenebilir ayraç, okuma odağı ve düzen tercihinin kalıcılığını ekle.

**Kabul:** Dar/geniş ekranda görüntü ve sohbet için ayrı odak düzenleri çalışsın.

**Kod/iz:** `src/product.css`.

#### K24 · P1 · Matematik ve kod için zengin cevap gösterimi yok

**Durum:** Eksik.

**Kanıt:** Aktif cevap bölümü pre-wrap metin ağırlıklı; KaTeX/MathJax ve kod blokları için ürün entegrasyonu görülmedi.

**Etkisi:** Algoritma ve matematik açıklamalarının okunurluğu sınırlı.

**Gereken:** Güvenli Markdown, matematik, tablo ve kod gösterimi; atıfları cümleyle ilişkilendir.

**Kabul:** Formül, kod ve kaynak bağlantıları erişilebilir ve taşma yapmadan gösterilsin.

**Kod/iz:** `src/pages/LearningWorkspace.jsx`.

#### K25 · P2 · Erişilebilirlik kabulü eksik

**Durum:** Kısmen çalışıyor.

**Kanıt:** Etiketler ve native dialog mevcut; görsel bölge seçimi pointer hareketine dayanıyor. Tam klavye/ekran okuyucu kabul kaydı yok.

**Etkisi:** Bölge analizi bazı kullanıcılar için erişilemez olabilir.

**Gereken:** Klavye alternatifi, odak sırası, canlı durum duyuruları ve kontrast denetimi yap.

**Kabul:** Klavye ve ekran okuyucu ile ana öğrenme/quiz akışı tamamlanabilsin.

**Kod/iz:** `src/components/DocumentCanvas.jsx`.

#### K26 · P2 · Demo/test içerikleri çalışma hesabını kalabalıklaştırıyor

**Durum:** Tarayıcıda gözlendi.

**Kanıt:** İncelenen test hesabında 38 ders, 84 kaynak ve aynı isimli çok sayıda demo ders görüldü.

**Etkisi:** Ders seçimi ve demo sunumu kafa karıştırıcı; bu ölçüm bütün kullanıcıları temsil etmez.

**Gereken:** Gelecek gerçek testleri ayrı hesap/şemaya al; mevcut kayıtları otomatik silmeden filtre/arşiv düzeni öner.

**Kabul:** Sunum hesabında yalnız bilinçli seçilmiş dersler görünsün; gerçek kullanıcı verisi korunmalı.

**Kod/iz:** `src/pages/HomeDashboard.jsx`.

#### K27 · P2 · Not alma, yer imi ve öğrenme çıktısını saklama yok

**Durum:** Eksik.

**Kanıt:** Aktif viewer ve kalıcı şemada öğrenci notu, highlight ve yer imi modeli yok.

**Etkisi:** Öğrencinin çalışırken ürettiği bilgi sohbet içinde kayboluyor.

**Gereken:** Kaynak sayfası/zamanı/region bağlı not ve yer imi ekle; dışa aktarımı sonradan ekle.

**Kabul:** Bir not yenilemeden sonra aynı kaynak konumuna dönebilsin.

**Kod/iz:** `backend/prisma/schema.prisma`.

### RAG / bağlam

#### K28 · P0 · Atıf doğruluğu ile yanıt doğruluğu ayrışıyor

**Durum:** Kısmen çalışıyor.

**Kanıt:** Kaynak numarası/hash/konum denetleniyor; açıklama GENERATED_UNVERIFIED kalıyor.

**Etkisi:** Gerçek kaynağa bağlı görünen ama yanlış yorumlanan yanıt verilebilir.

**Gereken:** Claim düzeyinde kaynak desteği değerlendirmesi ve alan doğruluk seti ekle.

**Kabul:** Kaynakta olmayan iddia ile doğru atıflı doğru iddia ayrı metriklerle ölçülsün.

**Kod/iz:** `ai-service/src/knot_rag/explanations.py`.

#### K29 · P1 · Semantik eşleşme zorunlu sözcük filtresinde kaybolabiliyor

**Durum:** Kodda doğrulandı.

**Kanıt:** unified.search NO_TOPIC_ANCHOR ve MISSING_EXPLICIT_TERM ile adayları eliyor.

**Etkisi:** Türkçe soru/İngilizce PDF, eş anlamlı veya kısaltmasız anlatım kaçırılabilir.

**Gereken:** Etiketli retrieval setiyle çok dilli genişletme, reranker ve ret eşiğini kalibre et.

**Kabul:** Recall@k, yanlış kaynak ve ret oranları Türkçe/İngilizce/kısaltma gruplarında ölçülsün.

**Kod/iz:** `ai-service/src/knot_rag/unified.py`.

#### K30 · P1 · Uzun konuşma belleği son cevaba indirgeniyor

**Durum:** Kısmen çalışıyor.

**Kanıt:** history.last son assistant mesajını alıyor; takip çözümü regex ve önceki resolved soruya dayanıyor.

**Etkisi:** Birkaç tur önceki varsayım veya öğrencinin hatası unutulabilir.

**Gereken:** Sınırlı konuşma özeti, aktif öğretim hedefi ve referans çözümünü kalıcı oturumla bağla.

**Kabul:** Beş-on turluk konuşmada açık kaynak değişimi ve eski referans doğru ayrışsın.

**Kod/iz:** `backend/src/knowledge/knowledge.service.ts`.

#### K31 · P1 · Ortak indeks tam multimodal değil

**Durum:** Eksik.

**Kanıt:** unified.py text projection kullanıyor; MomentSearch görsel indeksi ayrı.

**Etkisi:** Metinsiz diyagramı tüm ders içinde anlamsal olarak bulmak garanti değil.

**Gereken:** Görsel, OCR, transkript ve metin adaylarını ortak kaynak kimlikleriyle birleştir; mevcut yapıyı koruyarak ek kanal kur.

**Kabul:** Yalnız görselle bulunabilecek bir slayt sorusu doğru materyal ve konumu getirsin.

**Kod/iz:** `ai-service/src/knot_rag/unified.py`.

#### K32 · P1 · Diyagram ve matematiksel görsel çözümü güvenilir değil

**Durum:** Kısmen çalışıyor.

**Kanıt:** Önceki gerçek BFS/DFS kabul raporu PARTIAL/CLARIFICATION; bu tur yeni görsel çözüm benchmarkı yapılmadı.

**Etkisi:** Hocanın temel graf örneğinde ürünün vaadi gerçekleşmeyebilir.

**Gereken:** Düğüm/kenar/ok/başlangıç çıkarımını ayrı ölç; belirsizliği kullanıcıya düzenlenebilir biçimde göster.

**Kabul:** Etiketli grafiklerde görüntüden çıkarılan yapı ve hesaplanan sonuç ayrı doğrulansın.

**Kod/iz:** `docs/development/CONTEXT_QUALITY_TEST_REPORT.md`.

#### K33 · P2 · Kaynak ilişkileri ve çelişki denetimi yüzeysel

**Durum:** Eksik.

**Kanıt:** RELATED_TOPIC ortak sözcüklerle estimated işaretleniyor; genel ön koşul/entailment grafı yok.

**Etkisi:** Benzer terimler birbirini doğrulayan içerik gibi algılanabilir.

**Gereken:** İlişki türü ve kanıtı tut; çelişki için ayrı doğrulama ve kullanıcı incelemesi sun.

**Kabul:** Aynı terimleri içeren çelişkili iki metin destekleyici kanıt sayılmasın.

**Kod/iz:** `ai-service/src/knot_rag/unified.py`.

### Materyal / video

#### K34 · P1 · Taranmış PDF için OCR hattı yok

**Durum:** Eksik.

**Kanıt:** extraction.py açıkça No OCR diyor; yeterli metin katmanı olmayan belge NO_TEXT_LAYER ile reddediliyor.

**Etkisi:** Tarama ders notları, el yazısı ve görüntü PDF kapsam dışı kalıyor.

**Gereken:** İsteğe bağlı sayfa OCR, kalite skoru ve özgün metin ayrımı ekle.

**Kabul:** Türkçe tarama örnekleri kaynak sayfası korunarak aranabilir olsun; el yazısı ayrı deneysel işaretlensin.

**Kod/iz:** `ai-service/src/knot_ingest/extraction.py`.

#### K35 · P1 · ASR kalite ve dil kapsamı sınırlı

**Durum:** Kısmen çalışıyor.

**Kanıt:** Yerel motor faster-whisper base CPU int8; aktif ASR_LANGUAGE=tr. Önceki transkriptte teknik terim hataları belgelenmiş.

**Etkisi:** İngilizce dersler ve teknik terimler yanlış transkript/retrieval üretebilir.

**Gereken:** Yükleme başına dil seçimi/otomatik tespit, teknik kelime değerlendirmesi ve WER/CER seti ekle.

**Kabul:** Türkçe ve İngilizce gerçek derslerde transkript hatası ve timestamp doğruluğu ayrı ölçülsün.

**Kod/iz:** `../Documents/Codex/MomentSearch/src/ingest/local_asr.py`.

#### K36 · P1 · Transkript düzeltme ve sürümlü yeniden işleme yok

**Durum:** Eksik.

**Kanıt:** Mevcut ilerleme belgeleri transcript revision/edit/reprocess işini eksik kaydediyor.

**Etkisi:** Yanlış tanım tüm sorulara ve quizlere taşınmaya devam eder.

**Gereken:** Özgün/düzeltilmiş transkript, edit geçmişi, yeniden indeks ve eski atıf geçerliliğini tasarla.

**Kabul:** Düzeltmeden sonra yeni cevap düzeltilmiş sürümü kullansın; eski alıntı sessizce değişmesin.

**Kod/iz:** `docs/development/REMAINING_WORK.md`.

#### K37 · P1 · Gerçek ders boyutları için yükleme sınırları dar

**Durum:** Kodda doğrulandı.

**Kanıt:** K-NOT video sınırı 100MiB; PPTX/TXT 2MiB. Video buffer belleğe alınıyor.

**Etkisi:** Uzun video ve görsel ağırlıklı sunum çoğunlukla yüklenemeyebilir.

**Gereken:** Boyut hedefini belirle; akışlı/parçalı yükleme, disk kotası ve kesintiden devam ekle.

**Kabul:** Seçilen gerçek ders profili bellek taşmadan yüklenebilsin ve bağlantı kopmasından devam etsin.

**Kod/iz:** `backend/src/videos/videos.service.ts`.

#### K38 · P2 · YouTube/Drive ürün akışı sınırlı

**Durum:** Kısmen çalışıyor.

**Kanıt:** Bağlantı desteği var; yalnız herkese açık Drive; özel OAuth/picker kullanıcı akışı yok. Yeni ürün ekranında güncel gerçek ağ testi belgede bekliyor.

**Etkisi:** Kullanıcı eski MomentSearch Drive deneyiminin tümünün taşındığını düşünebilir.

**Gereken:** Mevcut link kapsamını açık göster; canlı indirme hata/iptal testleri yap; özel Drive ancak ihtiyaç varsa ekle.

**Kabul:** Desteklenen ve desteklenmeyen linkler doğru sonuç ve anlaşılır hata versin.

**Kod/iz:** `docs/development/REMAINING_WORK.md`.

#### K39 · P2 · Özgün PDF üzerinde metin seçimi ve arama yok

**Durum:** Eksik.

**Kanıt:** DocumentCanvas sayfayı img olarak gösteriyor; gerçek PDF text-layer yok.

**Etkisi:** Metni seçip sorma, belge içi arama ve tam alıntı vurgulama kısıtlı.

**Gereken:** PDF text-layer, sayfa araması ve konumlu highlight ekle.

**Kabul:** Görsel üzerindeki seçili metin sunucuda aynı sayfa metniyle doğrulansın.

**Kod/iz:** `src/components/DocumentCanvas.jsx`.

#### K40 · P1 · Offline video ilerlemesi kalıcı kuyrukta değil

**Durum:** Eksik.

**Kanıt:** useVideoProgress başarısız batchleri bileşen belleğinde tutuyor.

**Etkisi:** Ağ yokken sekme kapanırsa gönderilemeyen izleme aralıkları kaybolabilir.

**Gereken:** Kullanıcı/video ayrımlı IndexedDB outbox, idempotency ve logout temizliği ekle.

**Kabul:** Offline izle → kapat → aç → online senaryosunda aralıklar bir kez işlensin.

**Kod/iz:** `src/hooks/useVideoProgress.js`.

#### K41 · P2 · Görsel/sesli ileri ders deneyimi yok

**Durum:** Kısmen çalışıyor.

**Kanıt:** Voice yalnız yerel Türkçe tarayıcı sesini okuyor; sesli kullanıcı girişi, senkron anlatım ve öğretim tahtası uygulanmış değil.

**Etkisi:** Seslendirme varlığı tam sesli öğretmen deneyimi anlamına gelmiyor.

**Gereken:** Önce mevcut ses kalite/erişilebilirliğini ölç; mikrofon ve tahta özelliklerini sonraki aşama tut.

**Kabul:** Desteklenen cihazlarda başlat/durdur ve ses yoksa metne dönüş doğrulansın; ileri özellikler ayrı kabul alsın.

**Kod/iz:** `src/pages/LearningWorkspace.jsx`.

### Öğrenme analizi

#### K42 · P1 · Analitik konu hâkimiyeti hesaplamıyor

**Durum:** Eksik.

**Kanıt:** overview mastery_estimated=false; şemada kavram bazlı yeterlik yok.

**Etkisi:** Öğrenci hangi ön koşulu neden tekrar etmesi gerektiğini göremiyor.

**Gereken:** Ölçülmüş cevap, zorluk, yardım kullanımı ve güven aralığıyla kavram profili tasarla.

**Kabul:** İzleme süresi doğrudan başarı puanı olmasın; her önerinin ölçüm gerekçesi olsun.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K43 · P1 · Sayaçlar sınırlı pencereleri tüm geçmiş gibi gösteriyor

**Durum:** Kodda doğrulandı.

**Kanıt:** overview en fazla 200 attempt, 50 activity ve 100 progress alıyor; UI başlıkları bu sınırları söylemiyor.

**Etkisi:** Veri büyüyünce toplam sanılan rakamlar eksik olur.

**Gereken:** Toplamlar için SQL aggregation, listeler için sayfalama ve açık tarih aralığı kullan.

**Kabul:** 200 üzeri denemede toplam doğru; listede sonraki sayfaya erişim olsun.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K44 · P1 · Aynı soruya tekrar cevaplar başarı sayısını artırıyor

**Durum:** Kodda doğrulandı.

**Kanıt:** Her answer çağrısı yeni attempt; graded_count/correct_count bütün dönen denemeleri sayıyor.

**Etkisi:** Cevabı gördükten sonraki tekrarlar ilk deneme başarısıyla karışır.

**Gereken:** İlk/son deneme, yardım sonrası deneme ve benzersiz soru metriklerini ayır.

**Kabul:** Aynı sorunun beş tekrarı beş ayrı öğrenilmiş konu gibi sunulmasın.

**Kod/iz:** `backend/src/learning/learning.service.ts`.

#### K45 · P2 · Zamana bağlı gelişim ve hedef takibi yok

**Durum:** Eksik.

**Kanıt:** Aktif analitik kayıt listesi ve basit sayaçlardan oluşuyor; zaman filtresi/kazanım trendi yok.

**Etkisi:** Öğrenci gelişimini haftalar arasında karşılaştıramıyor.

**Gereken:** Gün/hafta aralığı, konu bazlı ilk deneme performansı ve hedef ilerlemesi ekle.

**Kabul:** Yalnız gerçek veriden tarih aralığına göre tekrarlanabilir sonuç gösterilsin.

**Kod/iz:** `src/pages/LearningAnalytics.jsx`.

### İşletim / mimari

#### K46 · P1 · Tek komut var ama gözetimli servis yönetimi yok

**Durum:** Kısmen çalışıyor.

**Kanıt:** Start betiği Docker, DB, build, MomentSearch, AI, backend ve Vite sıralıyor; process crash için uygulama düzeyinde supervisor yok.

**Etkisi:** Bilgisayar açılışı ve kısmi servis arızası kullanıcıyı tekrar teknik desteğe götürüyor.

**Gereken:** Hazırlık kontrolü, birleşik durum ekranı ve yalnız projeye ait servislerde güvenli yeniden başlatma ekle.

**Kabul:** Model/worker/backend ayrı çöktüğünde doğru teşhis ve veriyi koruyan toparlanma olsun.

**Kod/iz:** `scripts/Start-KnotVideo.ps1`.

#### K47 · P1 · İndeks oluşturma ilk soru yolunda ve global kilit altında

**Durum:** Kodda doğrulandı.

**Kanıt:** KnowledgeService.sync sorgu sırasında çalışıyor; UnifiedIndex upsert/search RLock kullanıyor.

**Etkisi:** Büyük belge indekslenirken diğer sorgular gecikebilir.

**Gereken:** Kalıcı iş/job durumu ve staging revision üzerinden atomik indeks yayınlama ekle.

**Kabul:** Bir dersin büyük indeks işi diğer hazır dersin sorgusunu kabul hedefinin dışına taşırmasın.

**Kod/iz:** `ai-service/src/knot_rag/unified.py`.

#### K48 · P2 · Çoklu süreç için bellek içi koordinasyon yetersiz

**Durum:** Koddan belirlenen risk.

**Kanıt:** receipts, importing, contentWrites, synchronizing ve limiter süreç belleğinde.

**Etkisi:** Birden fazla backend kopyasıyla yarış ve farklı durum görülebilir.

**Gereken:** Önce tek süreç sınırını belgeleyip test et; büyüme halinde kalıcı lease/job/idempotency kullan.

**Kabul:** İki süreç altında aynı dosyanın yükleme/silme yarışı veri bozmasın.

**Kod/iz:** `backend/src/videos/videos.service.ts`.

#### K49 · P1 · Uçtan uca kapasite ve kuyruk bekleme hedefi yok

**Durum:** Ölçülmedi.

**Kanıt:** Bu tur tek model ve küçük örnekler ölçüldü; eşzamanlı öğrenci/büyük ders testi yok. Özel Ollama tek yüklü model ve tek paralel isteğe ayarlı.

**Etkisi:** Dört-beş öğrencide veya vision/quiz birlikteyken gecikme bilinmiyor.

**Gereken:** Donanıma uygun eşzamanlılık bütçesi, model sırası ve P50/P95 ölçümü tanımla.

**Kabul:** Soğuk/sıcak yük, 1/3/5 kullanıcı ve uzun video için süre/RAM/VRAM ölçülsün.

**Kod/iz:** `../Documents/Codex/MomentSearch/Local-Processes.ps1`.

#### K50 · P1 · Yedekleme ve geri yükleme tatbikatı yok

**Durum:** Eksik kabul kanıtı.

**Kanıt:** MySQL, Postgres, Qdrant, Chroma ve dosya depoları birlikte kullanılıyor; tutarlı geri yükleme kanıtı bu incelemede bulunmadı.

**Etkisi:** Tek volume yedeği bütün sistemi geri getirmeyebilir.

**Gereken:** İlişkili veri/dosya manifesti, sürüm ve secret hariç yedek prosedürü; ayrı ortamda restore testi hazırla.

**Kabul:** Yedekten ders, sohbet, quiz, medya ve atıflar aynı konumlarla açılabilsin.

**Kod/iz:** `docs/development/PRODUCT_LOCAL_SETUP.md`.

#### K51 · P2 · Eski ve yeni ürün yolları birlikte duruyor

**Durum:** Kodda doğrulandı.

**Kanıt:** App yeni HomeDashboard/CourseQuiz/LearningAnalytics kullanıyor; eski mock sayfalar, store örnek durumu ve özel workspace/video yolları duruyor.

**Etkisi:** Bakım yapan kişi yanlış ekranı geliştirebilir; davranışlar ayrışır.

**Gereken:** Kullanılan yolları açık işaretle; testlerden sonra gereksiz kodu aşamalı kaldır, tek sözleşmeye taşı.

**Kabul:** Aktif rota haritası ve kaldırılacak modüller belirli olsun; gerçek eski kullanıcı akışı bozulmasın.

**Kod/iz:** `src/App.jsx`.

### Ürün güvenliği

#### K52 · P0-yayın · MomentSearch doğrudan portunda kimlik doğrulama yok

**Durum:** Kodda doğrulandı.

**Kanıt:** require_auth no-op, user_id tek kullanıcı; yerel 7862 profili localhost üzerinde.

**Etkisi:** K-NOT yetkilendirmesi olsa da video motoru internete açılırsa tek hesabın verilerine erişim riski doğar. Bu tur dışa açıklık/sömürü iddiası yok.

**Gereken:** Yayın öncesi özel ağ ve servis kimliği; doğrudan motor portunu kullanıcıya açmama; tenant yetki testleri.

**Kabul:** Yetkisiz doğrudan istekler reddedilsin ve servisler yalnız izinli ağdan erişilsin.

**Kod/iz:** `../Documents/Codex/MomentSearch/src/api/videos.py`.

#### K53 · P1-yayın · Hesap yaşam döngüsü tamamlanmamış

**Durum:** Eksik.

**Kanıt:** Auth controller login/me; şifre sıfırlama, hesap yönetimi, davet ve refresh/revoke akışı yok.

**Etkisi:** Hoca/öğrenci katılımı ve oturum kurtarma elle yürütülüyor.

**Gereken:** Hedef tek kullanıcı mı sınıf mı belirle; sınıf için davet, parola yenileme ve oturum iptali ekle.

**Kabul:** Yeni kullanıcı ve unutulan parola akışları geliştirici yardımı olmadan tamamlanabilsin.

**Kod/iz:** `backend/src/auth/auth.controller.ts`.

#### K54 · P1-yayın · Kapsamlı güvenlik ve veri yaşam döngüsü kabulü eksik

**Durum:** Ölçülmedi.

**Kanıt:** JWT, owner/course kontrolleri, kaynak hashleri, güvenli dosya doğrulama mevcut. Ancak bu tur sızma testi, güncel bağımlılık açığı taraması ve saklama/erişim incelemesi yapılmadı.

**Etkisi:** Yerel test başarılarını çok kullanıcılı yayın güvenliği saymak yanlış olur.

**Gereken:** Yayın öncesi tehdit modeli, bağımlılık/SBOM, prompt injection, dosya ve tenant testlerini ayrı çalıştır.

**Kabul:** Bulgu ve düzeltme kanıtıyla yayın kontrol listesi kapatılsın; secret içeren yerel test dosyaları paylaşılmasın.

**Kod/iz:** `docs/security.md`.

### Test / teslim

#### K55 · P1 · CI yalnız secret tarıyor

**Durum:** Kodda doğrulandı.

**Kanıt:** Mevcut .github/workflows içinde secret-scan.yml var; build/unit/API/AI ürün regresyonu pipelineı yok.

**Etkisi:** Yerelde geçen kod sonraki değişiklikte sessizce bozulabilir.

**Gereken:** Hafif otomatik test/build kapısı ve isteğe bağlı gerçek model kabul hattı kur.

**Kabul:** Her PR temel testleri; sürüm adayı gerçek yerel model kabulünü geçsin.

**Kod/iz:** `.github/workflows/secret-scan.yml`.

#### K56 · P1 · Otomatik test ile gerçek öğrenme kalitesi ayrı ölçülmüyor

**Durum:** Eksik.

**Kanıt:** Bugün 92 frontend+100 backend unit+468 Python geçti; fake/mocked sözleşme testleri gerçek model doğruluğu değildir. Eski E2E hashing/extractive baseline kullanıyor.

**Etkisi:** 660 yeşil test iyi soru üretildiği sanısına yol açabilir.

**Gereken:** Test raporunu sözleşme, gerçek altyapı, gerçek model, insan kalite incelemesi olarak ayır.

**Kabul:** Her özellik için aynı türden açık PASS/PARTIAL/FAIL kanıtı bulunsun.

**Kod/iz:** `tests/e2e/run-e2e.mjs`.

#### K57 · P1 · Geliştirme kaydı ve gereksinim matrisi güncel değil

**Durum:** Kodda doğrulandı.

**Kanıt:** 2 Kasım quiz planı yarım; traceability bazı artık bulunan özellikleri hâlâ eksik diyor; 31 Ekim test sayıları farklı tarihsel bloklarda.

**Etkisi:** Neyin gerçekten bittiği ve sonraki adım belirsizleşiyor.

**Gereken:** Tek güncel kabul matrisi, sürüm, çalışma ağacı ve kanıt bağlantıları tut.

**Kabul:** Bir özellik için tek güncel durum ve tarihli test kanıtı olsun.

**Kod/iz:** `docs/architecture/REQUIREMENTS_TRACEABILITY.md`.

#### K58 · P1 · Quiz iyileştirmeleri commit edilmemiş

**Durum:** Kodda doğrulandı.

**Kanıt:** HEAD 3b8241f; quiz plan/normalize/retrieval değişiklikleri çalışma ağacında; yeni dosyalar untracked.

**Etkisi:** Geri dönüş ve yeniden üretilebilir teslim noktası eksik.

**Gereken:** Gerçek kabul tamamlandıktan sonra küçük izlenebilir commitler; başarısız örnekleri raporda koru.

**Kabul:** Temiz bir klon aynı kilitli sürüm ve yapılandırmayla testleri çalıştırabilsin.

**Kod/iz:** `docs/development/QUIZ_IMPROVEMENT_PLAN.md`.

#### K59 · P2 · Statik bakım borcu ve bağımlılık tekrarlanabilirliği

**Durum:** Ölçüldü.

**Kanıt:** Oxlint 184 dosyada 244 warning; Python 39 deprecation uyarısı. Python birçok bağımlılığı alt sınırla tanımlıyor.

**Etkisi:** Gelecek kurulum/upgrade davranışı değişebilir; uyarı gürültüsü gerçek hatayı gizleyebilir.

**Gereken:** Uyarıları önemine göre sınıflandır; doğrulanmış Python lock/constraints ve uyumluluk profili oluştur.

**Kabul:** Yeni kritik uyarı eklenmesin; temiz Windows kurulumunda aynı bağımlılık setiyle testler geçsin.

**Kod/iz:** `ai-service/pyproject.toml`.

## Tamamlanmış sayılmak için önerdiğim ürün sözleşmesi

Öğrenci bir ders oluşturur ve materyallerini ekler. Sistem gerçek kaynaklardan bir konu taslağı sunar; öğrenci hedefini seçer. “Birlikte öğren” oturumu bir tanılama sorusuyla başlar. Sistem öğrenci yanıtını bekler, gerekiyorsa ipucu verir, sonra kaynaklı açıklama ve yeni uygulama sorusu sunar. Video zamanı/PDF sayfası bu oturumun parçasıdır. Quiz sonucu kavram profiline kanıt olarak yazılır; izleme süresi öğrenme puanına çevrilmez. Sonraki oturum ölçülmüş eksikten ve kaydedilmiş konumdan devam eder.

Önerilen en küçük ek sözleşme: LearningSession(course, user, goal, active_context, stage, pending_question, last_attempt), LearningObjective(id, prerequisites, source_refs), Question(plan, difficulty, rubric, version, quality_state), Attempt(response, first_or_retry, hints_used, rubric_results), ConceptEvidence(source, confidence, measured_at). Bunlar **tasarım önerisidir**, uygulanmış özellik değildir. Var olan LearningQuiz/Attempt/Conversation modelleri genişletilebilir; ayrı servis şart değil.

## Uygulama sırası ve kabul kapıları

1. **Kalite tabanını sabitle:** Commit edilmemiş quiz işini tamamla; 4B model kurulum/testini bitir; matematik normalizasyonu ve cevap sızıntısını düzelt; öğretmen etiketli soru seti oluştur. Kabul: cevaplanabilir kaynaklardan üretim, konu dışı ret, tek doğru seçenek ve Türkçe açıklama ayrı ölçülür. Güvenlik kapılarını kaldırarak başarı artırılmaz.
2. **Öğretim oturumunu ekle:** Önce tek ders ve birkaç kazanım üzerinde tanılama → yanıt → ipucu → yeni deneme → açıklama döngüsü. Kabul: doğru/yanlış/kısmi/bilmiyorum dalları, yenileme ve oturum devamı çalışır; sistem öğrenciyi sonsuz soruyla kilitlemez.
3. **Çalışma alanını bu döngüye göre düzenle:** Materyal, öğretmen ve kısa alıştırma aynı ekranda; ana eylem görünür; kaynak kapsamı ve geçişler anlaşılır. Kabul: ilk kullanımda görev tamamlama, klavye, 390/768/1280/1920 ekran profilleri ve uzun içerik ölçülür.
4. **Retrieval ve materyal kalitesini yükselt:** Türkçe/İngilizce retrieval, taranmış PDF, sürümlü ASR düzeltme, gerçek diyagram seti, büyük ders yükleme. Kabul: alıntı konumu ve bilgi doğruluğu ayrı değerlendirilir; OCR/ASR/vision başarısızlığı kullanıcıya doğru açıklanır.
5. **Analitik ve dayanıklılığı tamamla:** İlk/tekrar deneme ayrımı, toplam/sayfalama, kavram kanıtı, offline outbox, job ve restore tatbikatı. Kabul: veri kaybı olmadan yeniden başlatma ve ölçülmüş performans.
6. **Sunum sürümünü çıkar:** Kontrollü demo hesabı, tek başlatma/durum ekranı, sürümü sabit bağımlılıklar, CI ve güncel gereksinim matrisi. Uzak yayın istenirse ayrıca servis kimliği, hesap yaşam döngüsü ve güvenlik kabulü.

**Önerilen kalite hedefleri (henüz elde edilmiş sonuçlar değil):** En az üç ders alanı ve her alan için metin/PDF/video örnekleri; en az 60 öğretmen etiketli quiz ve 50 retrieval sorusu; ayrıca 20 konu dışı/eksik kanıt vakası. Çeldirici, tek doğru cevap, Türkçe akıcılık, kaynak desteği ve cevap sızıntısı ayrı puanlanmalı. İlk sürüm için cevaplanabilir örneklerde ≥%90 üretim ve kabul, yanlış kaynak/cevap sızıntısında sıfır gözlenen olay hedeflenebilir; küçük örnekte sıfır olay genel garanti değildir. Eşikler hoca ile netleştirilmelidir. Soğuk/sıcak gecikme dağılımları ve başarısız istekler birlikte raporlanmalıdır.

## Hocaya gösterim için hazır/eksik ayrımı

Bugün gösterilebilen: gerçek materyalleri tek ders altında açma, kaynak arama, sayfa/zaman bağlamı, kaynak bağlantısı, izlenen aralıklar, sohbet/quiz kayıtları. Dikkatle gösterilebilen: yerel model açıklaması, küçük modelin quiz çıktısı, görsel yorum ve yerel ses. Tamamlanmış diye sunulmaması gereken: güvenilir genel quiz kalitesi, öğrenciyi yöneten öğretim oturumu, kavram bazlı öğrenme ölçümü, genel diyagram çözümü, taranmış belge OCR ve çok kullanıcılı yayın hazırlığı.

## Bu turun sınırları

Uygulama kaynaklarına düzeltme yapılmadı; önceki değişiklikler korunuyor. Gerçek model testi mevcut 2B ile sınırlı. Özel Drive/OAuth, yeni YouTube indirmesi, yeni uzun video işleme, mobil dokunma, ekran okuyucu, offline kapanma, çoklu kullanıcı yükü ve geri yükleme bu tur çalıştırılmadı. Eski raporların başarıları bu turun ölçümü gibi sayılmadı. UI değerlendirmesi uzman incelemesidir; öğrenci kullanılabilirlik araştırması yapılmadı. Süre/efor tahmini yerine bağımlılık ve kabul kapıları verildi; model denemesi ve gerçek ders kabulü yapılmadan kesin teslim tarihi savunulamaz.
