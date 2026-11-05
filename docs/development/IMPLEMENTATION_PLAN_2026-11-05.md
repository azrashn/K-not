# K-NOT — Tamamlama ve iyileştirme planı

Tarih: 5 Kasım 2026. Durum: PLANLANDI; aşağıdaki işler uygulanmış sayılmaz.
Temel: COMPREHENSIVE_PRODUCT_AUDIT_2026-11-05.md içindeki K01–K59 bulguları.
Dal: feature/video-integration. Başlangıç: 3b8241f + korunacak mevcut quiz çalışma ağacı.

## Hedef ve kapsam

İlk teslim, öğrencinin gerçek ders materyali üzerinden kaynaklı bir öğretim oturumunu başlatabildiği, sistemin sorusuna yanıt verdiği, ipucu aldığı, alıştırma çözdüğü ve kaldığı yerden devam ettiği yerel K-NOT sürümüdür. Sonraki teslimler materyal çeşitliliği, öğrenme analizi ve yayın hazırlığını kapsar.

Mevcut React/NestJS/Python/MomentSearch yapısı korunur. Yeni repo geçişi veya genel yeniden yazım yok. Veri modeli eklemeli migrasyonlarla genişletilir. OpenTutor, DocsGPT, paylaşılan Ollama ve kullanıcı verileri değişmez. Ücretli API yok. Onaylı 4B indirmesi tamamlanabilir; bunun dışındaki büyük model indirmeleri ayrıca onay gerektirir.

## Bağımlılık sırası

A0 temel ve kanıt → A1 quiz doğruluğu → A2 ortak bağlam ve ölçme oturumu → A3 yönlendiren öğretmen + A4 birleşik arayüz → A5 retrieval/materyal → A6 öğrenme analizi → A7 dayanıklılık ve teslim.

A4'ün tasarım taslakları A1 sırasında hazırlanabilir; davranış entegrasyonu A2 sözleşmesinden sonra yapılır. A5'in OCR/ASR araştırması bağımsız ilerleyebilir. A6 öğrenme puanları, A1/A3 değerlendirmesi güvenilir olmadan yayımlanmaz. A8 uzak yayın ayrı kabul kapısıdır; yerel MVP için zorunlu kapsam genişletmesi değildir.

## A0 — Çalışan tabanı sabitle

**Bulgular:** K26, K55–K59. **Çıktı:** tekrar üretilebilir başlangıç ve güncel kabul matrisi.

- Git diff'i incele; mevcut quiz işini kaybetmeden başlangıç kaydı oluştur. Henüz gerçek kabulü olmayan işi tamamlandı diye commit açıklamasına yazma.
- Test hesabını gerçek çalışma hesabından ayır. Mevcut demo derslerini otomatik silme; yeni testler ayrı hesap/izole veritabanına yazsın.
- Her gereksinimi bulgu kimliği, ilgili dosya, sorumlu rol, test ve kanıt yoluyla tek güncel listede izle.
- CI'ya frontend/backend build ve birim testleri ekle; Python testlerini ayrı job yap. Gerçek model testlerini model/donanım bilgisiyle isteğe bağlı kabul işi olarak tut.
- Python bağımlılıklarını çalışan sürümlerle kilitle. 244 lint uyarısını riskine göre sınıflandır; geniş biçimlendirme/refactor ile ana işi geciktirme.

**Kabul:** mevcut test tabanı tekrar üretilebilir; CI temel kontrolleri koşar; secret ve kullanıcı dosyası Git'e girmez. Mevcut 660 test tarihsel başlangıçtır; sonradan eklenen testler ayrıca sayılır.

## A1 — Quiz doğruluğunu ve kullanılabilirliğini düzelt

**Bulgular:** K07–K11, K13, K15, K16, K28'in quiz kapsamı.

1. Matematik operatörlerini koruyan seçenek normalizasyonunu uygula. Gerçek tekrarları yakalarken x+y / x-y ayrımını koru.
2. Cevabı öğrenme hedefinden sızdırmayı önle. Cevap öncesi hedefi geniş kazanım düzeyinde göster; ayrıntılı hedef/açıklama sonrasında açılabilir.
3. Planlama yanıtını kaynakla eşleştir; küçük modelin uzun paraphrase üretmesini ve yanlış kaynağı seçmesini düzelt. Ret nedenlerini kalite/konu yok/model yok/zaman aşımı olarak ayır.
4. Onaylı Qwen3 4B Instruct indirmesini tamamla. Aynı girdileri 2B/4B ile karşılaştır. Yalnız kabul ölçümleri uygunsa QUIZ_LLM ayarını değiştir; görsel model korunur.
5. MCQ, doğru/yanlış, boşluk ve kısa cevap için ayrı doğrulama kuralları oluştur. Açık cevap otomatik olarak kesin doğru/yanlış sayılmaz.
6. Ders/kapsam değişiminde bekleyen sonucu geçersiz kıl; seçili materyalleri temizle. İstek kimliği, iptal ve kullanıcı girdisini koruyan retry ekle.

**Test:** BFS/DFS, temel matematik, klorofil, konu dışı kaynak, bozuk ASR, İngilizce PDF/Türkçe soru, anlamsal cevap sızıntısı, birden çok doğru seçenek, yanlış indeks ve ders değiştirme yarışı.

**Kabul:** aynı kontrollü set en az üç kez çalıştırılır; tüm retler saklanır. Kaynakta olmayan konuya başka konudan soru yayımlanmaz. Matematik şıkları bozulmaz. İnsan incelemesinde tek doğru cevap, anlamlı çeldirici, dil ve kaynak desteği ayrı değerlendirilir. Aynı modelin ikinci çağrısı bağımsız doğruluk kanıtı sayılmaz.

**Geri dönüş:** yeni quiz modeli/config ayrı anahtarla kapatılabilir; veriler silinmez. Eski zayıf modele dönüş otomatik kalite başarısı sayılmaz; gerekirse üretim açık hata ile durur.

## A2 — Öğrenme bağlamı ve ölçme oturumu

**Bulgular:** K12, K14, K17, K18, K21, K30.

- Ortak LearningContext: course_id, user_id, active_material_id, page/slide/timestamp/region, scope, explicit_source_ids, source_version, conversation_id, learning_session_id. Sunucu bütün kaynak kimliklerini ve yetkileri doğrular.
- Çalışma alanından alıştırmaya aynı bağlam taşınır. Öğrenci kapsamı görür ve değiştirebilir.
- LearningQuiz modelini koruyarak QuizSession ekle: hedefler, soru planı, adet, zorluk, sıra, durum. Başlangıçta 3–5 soruluk kısa oturum yeterli.
- Attempt ayrıntıları, ilk/tekrar deneme, ipucu kullanımı ve değerlendirme sürümü tutulur. Yeni soru istemek ile eski soruya tekrar yanıt vermek ayrışır.
- Kısa/açık cevap için kaynaklı rubrik: ölçüt, beklenen kavram, kısmi karşılanma, gerekçe, güven/inceleme gereği. Otomatik değerlendirme belirsizse puan zorlanmaz.
- Soru bildirimi ve öğretmen inceleme durumu ekle; mevcut eski sorular sürüm etiketiyle kalır.

**Kabul:** PDF sayfası/video anından başlatılan oturum aynı kaynağa bağlı kalır; yenileme sonrası soru ve attempt ayrıntıları geri gelir; başka kullanıcı/ders kaynağı kabul edilmez. Cevap anahtarı cevap öncesi istemciye gönderilmez.

## A2-E — Örnek ara sınav/finalden özgün deneme sınavı

5 Kasım ek gereksinimi: hoca geçmiş midterm/final dosyalarını yükleyerek örnek
ara sınav/final soruları ve deneme sınavları oluşturabilmeli. **PLANLANDI**.
A1 kalite kapısı ve A2 soru seti/rubrik altyapısından sonra uygulanacak.

- Materyale amaç etiketi: ders kaynağı / örnek ara sınav / örnek final / cevap
  anahtarı. Sınav türü, ders ve kaynak sürümü saklanır. Cevap anahtarı öğrenciye
  cevap öncesi sunulmaz; yalnız sınav görüntüsünden doğru cevap varmış gibi çıkarılmaz.
- Kaynak soru sınırları, alt maddeler, puanlar, soru türleri, konular ve varsa
  süre çıkarılır; OCR gerekliyse A5'e bağlıdır. Öğretmen çıkarılan taslağı onaylar.
- Onaylanan blueprint: kapsam, konu ağırlığı, zorluk, soru türü, soru sayısı,
  toplam puan ve süre. Az örnekten zorluk çıkarımı tahmindir ve düzenlenebilir.
- Özgün sorular ders materyallerindeki bilgiye dayanır; yüklenen sınavlar biçim
  ve kapsam örneğidir. Sadece isim/sayı değiştirerek kopya üretimi yeterli sayılmaz.
- Her yeni soruda bilgi kaynağı ve örnek sınavla ilişkisi ayrı tutulur. Aynı veya
  çok benzer soru tespiti, matematikte çözülebilirlik, puan tutarlılığı ve rubric
  kontrolleri geçmeden sınav yayımlanmaz. “Benzer soru” bir başarı garantisi değildir.
- Öğretmen önizleme/düzenleme/onay, öğrencide sınav modu, sonrasında anahtar ve
  gerekçeli değerlendirme. PDF dışa aktarma sonraki alt iş; temel ekran akışını
  geciktirmemeli.

**Kabul:** hak sahibi olunan bir ara sınav ve bir final ile ayrı test; onaylanan
blueprint'e uygun özgün soru setleri, puan toplamı, kaynak ilişkileri, cevap gizliliği,
öğretmen incelemesi ve kalıcılık. Eksik ders kaynağında konu uydurulmaz. Bu özellik
henüz uygulanmadı; A2-E kabul edilmeden çalışıyor diye sunulmayacak.

## A3 — Öğrenciye soru soran öğretmen

**Bulgular:** K01–K05; K30'un öğretim belleği.

Kalıcı LearningSession durumları: hedef seçimi → tanılama → yanıt bekleme → değerlendirme → ipucu/yeniden deneme → açıklama → transfer sorusu → özet/sonraki adım.

- “Birlikte öğren” ayrı başlangıç eylemi olur; mevcut serbest soru-cevap korunur.
- Sistem gerçek kaynaklardan ilk tanılama sorusunu sorar. Cevap gelmeden anahtarı veya bütün çözümü açıklamaz.
- Doğru cevapta kısa gerekçe ve yeni uygulama; kısmi cevapta eksik kavrama odaklanan soru; yanlış cevapta kademeli ipucu; “bilmiyorum”da küçük örnek ve kolaylaştırılmış soru sunar.
- Öğrenci açıklama istemeyi, soruyu atlamayı ve oturumu bitirmeyi seçebilir. Sonsuz soru/engel döngüsü kurulmaz.
- Hedef, son yanılgı, kullanılan ipucu ve açık kaynak konumu sunucuda tutulur. Eski model cevabı kanıt yerine kullanılmaz.
- Konular/ön koşullar kaynaklardan taslak çıkarılır; kullanıcı/öğretmen tarafından düzeltilebilir. Tahmin edilen ilişkiler kesin müfredat bilgisi sayılmaz.

**Kabul:** üç ders alanında doğru/yanlış/kısmi/bilmiyorum senaryoları; beş-on turluk bağlam; kaynak değişimi; yenileme; oturumdan çıkış. Öğretmen testinde sistem öğrenci sormadan öğretici soru başlatır ve yanıtına göre farklı yol izler.

## A4 — Tek öğrenme deneyimi için UI / UX

**Bulgular:** K19–K25, K27, K39; K41'in mevcut ses deneyimi.

- Ders açılışı: konu özeti, kaldığın yer ve “Birlikte öğren” ana eylemi. Materyal varsa boş içerik alanı yerine anlamlı başlangıç sun.
- Düzen: kaynaklar / materyal / öğretmen. Ayarlanabilir paneller, okuma odağı ve mobilde materyal-öğretmen sekmeleri. Mevcut tasarım yönü ve tek vurgu rengi korunur.
- Alıştırma öğretmen panelinde kısa oturum olarak çözülebilir; geniş quiz ekranı ayrıntılı çalışma için kalır.
- Quiz'de önce önerilen konu ve başlat; kaynak/tür/zorluk ayarları gelişmiş bölümde. Ana eylem 720px yükseklikte görünür.
- Gerçek işlem aşaması, geçen süre, iptal/retry ve açık hata durumu. Sahte yüzde veya yapılmayan aşama gösterilmez.
- Güvenli Markdown, matematik ve kod blokları; cümleye bağlı atıf ve tek tıkla kaynak konumuna dönüş.
- PDF text-layer, arama, metin seçimi; kaynak konumlu not ve yer imi. Bunlar önceki görüntü/bölge seçimini bozmaz.
- Klavye odağı, ekran okuyucu durumları, bölge seçimine alternatif, kontrast ve 390/768/1280/1920 genişlik testleri.

**Kabul:** ilk kullanıcı ders → materyal → öğretmen sorusu → cevap → kaynak → sonraki adım yolunu açıklama yardımı olmadan tamamlar. Uzun içerik, hata ve boş durumlar test edilir. Görsel beğeni tek kabul ölçütü değildir.

## A5 — Retrieval ve materyal kalitesi

**Bulgular:** K28–K38, K47'nin indeksleme bölümü.

- Etiketli retrieval setinde sözcük filtresinin kaçırdığı eş anlamlı/Türkçe-İngilizce/kısaltma örneklerini ölç. Çok dilli genişletme ve reranker yalnız ölçülen kazanç varsa eklenir.
- Kaynak kimliğinin doğruluğu ile iddianın kaynak tarafından desteklenmesini ayrı denetle; belirsizlikte netleştirme veya açık ret.
- Ortak metin indeksine görsel/OCR aday kanalını aynı source/version sözleşmesiyle ekle. Tüm ders görüntülerini her soruda modele göndermekten kaçın.
- Taranmış PDF için OCR ve kalite bilgisi; el yazısını ayrı deneysel kapsamda tut. Görsel graf testinde düğüm/kenar çıkarımı ile algoritma çözümünü ayrı değerlendir.
- ASR için yükleme başına dil, teknik terim kabul seti ve özgün/düzeltilmiş transkript sürümleri. Düzeltme yeni indeks sürümünü atomik yayımlar.
- İndeksleme ilk soru yolundan kalıcı job/status/retry akışına taşınır. Hazır eski revision, yeni revision başarısızken kullanılabilir kalır.
- Video/PPTX boyut hedefi gerçek ders örneklerine göre seçilir; buffer yerine akışlı yükleme, kota ve kesintiden devam değerlendirilir.
- YouTube/public Drive desteklenen linklerle gerçek ağ kabulü yapılır. Özel Drive OAuth ayrı isteğe bağlı genişleme; mevcut kapsam gibi sunulmaz.

**Kabul:** metin/PDF/PPTX/video ve tarama örnekleri ayrı raporlanır. Başarısız OCR/ASR gizlenmez. Silinen/eski sürüm kaynak yeni cevapta kullanılamaz. Büyük indeks işi hazır başka derste sorguyu bloke etmez.

## A6 — Ölçülebilir öğrenme ve tekrar

**Bulgular:** K06, K42–K45.

- Sayaçları SQL toplamları ve sayfalanmış listelerle düzelt; 200 deneme sınırını tüm geçmiş gibi sunma.
- İlk deneme, tekrar, yardım sonrası yanıt ve benzersiz soru ölçümlerini ayır.
- Kavram profili yalnız değerlendirilmiş kanıttan oluşsun: hedef, soru zorluğu, sonuç, yardım, zaman, belirsizlik. Video izleme öğrenme puanı değildir.
- Gelişim görünümünde zaman aralığı, eksik kazanımlar ve neden önerildiği açıklanan sonraki adım.
- Aralıklı tekrar ve farklı bağlamda eşdeğer soru; cevabı ezberlemeyi öğrenme olarak değerlendirmeme.

**Kabul:** aynı sorunun tekrarları ayrı başarı gibi sayılmaz; 200 üzeri kayıtta toplamlar doğru; kaynak kaldırılınca eski kanıtın durumu açıklanır; öneri gerçek kaynağa veya yeni alıştırmaya açılır.

## A7 — Yerel teslim, performans ve veri dayanıklılığı

**Bulgular:** K40, K46–K51; K55/K59'un teslim kapsamı.

- Video ilerlemesi için kullanıcı/video ayrımlı kalıcı outbox; idempotent yeniden gönderim, logout temizliği ve çok sekme çatışma politikası.
- Birleşik sağlık/durum ekranı; servis bazında hazır değil/başlıyor/hata ayrımı; sadece proje süreçlerinde güvenli yeniden başlatma.
- Tek süreç geliştirme sınırını açık tut; çoklu süreç gerekirse kalıcı lease ve iş kilitleri ekle.
- MySQL/Postgres/Qdrant/Chroma/dosyalar için tutarlı yedek manifesti; ayrı ortamda geri yükleme tatbikatı.
- Soğuk/sıcak model, 1/3/5 eşzamanlı oturum ve büyük ders profiliyle P50/P95, hata oranı, RAM/VRAM ölçümü. 8GiB GPU'da büyük modeller sırayla çalışır.
- Eski/aktif rotaları belgeleyip testlerden sonra gereksiz kodu aşamalı temizle; çalışan yolları topluca silme.

**Kabul:** offline izle → kapat → aç → online senaryosunda aralıklar bir kez kaydolur. Servis çökmesi veriyi bozmaz. Yedekten açılan dersin kaynakları ve geçmişi çalışır. Temiz kurulumun çalıştırma yönergesi doğrulanır.

## A8 — Uzak/çok kullanıcılı yayın kapısı

**Bulgular:** K52–K54; K48/K49'un ölçek kapsamı.

- MomentSearch doğrudan erişimine servis kimliği/özel ağ sınırı; kullanıcı yetkisinin Nest tarafındaki kontrolleri atlanamaz.
- Hedef sınıf kullanımıysa davet, parola kurtarma, oturum yenileme/iptal ve öğretmen rolü ekle.
- Tenant izolasyonu, dosya/link güvenliği, prompt injection, bağımlılık taraması, saklama/silme ve erişim kayıtlarını test et.

**Kabul:** yetkisiz doğrudan motor erişimi reddedilir; kullanıcılar arası veri sızıntısı negatif testlerle önlenir; yayın profili localhost profilinden ayrı doğrulanır. Bu kapı geçmeden site internete açılmaz.

## Kapsam dışı değil, ileri aşamaya bırakılanlar

K41'in tam sesli öğretmen, mikrofon, senkron anlatım ve öğretim tahtası bölümü A3/A4/A5 kararlı olduktan sonra tasarlanır. İlk teslimde mevcut yerel sesin çalışması ve metin alternatifi yeterlidir. Özel Drive OAuth ve gelişmiş konu grafı da ana öğrenme döngüsünü geciktirmemeli.

## Test ve teslim standardı

Her iş küçük commit ile, ilgili regresyon testleri ve gerçek kabul kanıtıyla kapanır. Durumlar: planlandı / uygulanıyor / otomatik test geçti / gerçek kabul geçti / kısmi / engelli. Tek başına yeşil test ya da HTTP200 tamamlandı anlamına gelmez.

Başlangıç kabul seti: en az üç alan, 60 öğretmen etiketli soru, 50 retrieval sorgusu, 20 eksik/konu dışı kaynak vakası. Önce küçük geliştirme seti kullanılır; son kabul için görülmemiş ayrı set tutulur. Aynı örneğe prompt ayarlayıp o örnekle genel başarı iddia edilmez. Önerilen ilk eşik: cevaplanabilir sorularda en az %90 üretim ve insan kabulü; gözlenen yanlış kaynak/cevap sızıntısı vakaları kapanmadan teslim yok. Eşikler hedeflenen ders düzeyine göre hoca ile netleştirilebilir.

İlk demo kabulü: algoritma ve bir ikinci derste ders oluşturma → materyal → sistemin sorusu → öğrenci cevabı → ipucu → kaynaklı açıklama → kısa quiz → sonuç → kaynağa dönüş → yenileme sonrası devam. Bu yol A0–A4 sonunda gösterilebilir olmalı; bütün ileri özellikler tamamlandı diye sunulmamalı.

## Sorumluluk dağılımı

Bu roller görev dağılımıdır; bu plan kapsamında ajan/ekip başlatılmadı.

1. AI/quiz sorumlusu: A1, A5 retrieval/vision; öğretmen etiketli kalite seti.
2. Backend sorumlusu: A2, A3 oturum durumu, A6 veri/istatistik; eklemeli migrasyonlar.
3. Frontend/UX sorumlusu: A4, bağlam aktarımı ve A3 öğretmen etkileşimi.
4. Medya/işletim sorumlusu: A5 OCR/ASR/job/yükleme, A7 outbox/servis/yedek.
5. QA/ürün kabul sorumlusu: A0, tüm aşamaların regresyonu, gerçek demo ve A8 kabulü; öğretmen incelemesi koordinasyonu.

Süreler A1 model benchmarkı ve A2 sözleşmesi tamamlandıktan sonra tahmin edilir. Bu plan kesin teslim tarihi vaat etmez; bağımlılıkları ve kapanış ölçütlerini belirler.

## İlk uygulanacak iş paketi

1. Git durumunu ve quiz çalışma ağacını koru; güncel başlangıç raporu oluştur.
2. Matematik normalizasyonu, öğrenme hedefinde cevap sızıntısı ve ders değiştirme yarışını düzelt.
3. Onaylı 4B modeli indirip 2B ile aynı kontrollü sette karşılaştır.
4. Gerçek PDF/video kaynaklı quiz oluşturma → cevap → geri bildirim → kaynak açma yolunu doğrula.
5. Sonuç uygunsa yalnız quiz modelini devreye al; kalite/performans raporuyla commit et.
6. Ardından A2 sözleşmesi ve “Birlikte öğren” oturumuna geç.
