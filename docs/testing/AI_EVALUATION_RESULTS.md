# Unified learning — gerçek sonuçlar ve sınırlar

31 Ekim 2026, 4843afa sonrası geliştirme. Ürün regresyonu, gerçek servis
testi ve akademik AI kalitesi birbirine eşit değildir.

## Otomatik regresyon

- Frontend: 83/83, 10 dosya; yeni learning-workspace.test.jsx 6 senaryo.
- Nest unit: 91/91. Typecheck ve backend/frontend build başarılı.
- API: 105/105, 10 suite, 64.508s; izole gerçek MySQL, fake AI boundary.
  knowledge.spec.ts 10 test: scope, source identity, search without generation,
  foreign source, bounded conversation, deleted citation, file limits, original
  download/dedup/delete, source-linked practice, association scope ve
  UNWATCHED video + kullanılabilir metin kaynağı. Kullanıcı/ders sızıntısı reddi.
- Knot Python: 418/418, 39 mevcut deprecation; yeni test_unified.py 16 test.
  Chroma gerçek; embedding hashing test profili. Model-provider boundary mock
  sonuçları gerçek AI sonucu diye sunulmaz.
- MomentSearch: 26/26; mevcut yerel FFmpeg PATH profili. Ürün kodu değiştirilmedi.
- Gerçek Python/MySQL entegrasyonu: 1/1, 8.215s; hashing/extractive baseline.
- Eski PDF Edge E2E: 16/16 adım; extraction/callback/source highlight, auth,
  negatif scope ve dosya indirme. Yeni ortak ekran ayrıca test edilir.

Toplam 724 otomatik test; ayrıca eski PDF E2E 16 adım. Accuracy yüzdesi değildir.
API runner eski forceExit borcunu korur; temiz shutdown ölçümü sayılmaz.
Build'in büyük bundle ve esbuild/oxc uyarıları sürer. Yeni ortak ekranın async
ilk yükleme effect'i için bir lint uyarısı var; suppression eklenmedi. Eski
store Fast Refresh ve video effect uyarıları da ayrı teknik borçtur.

## Gerçek üç materyal deneyi

Komut: scripts/create-unified-fixtures.py, ardından scripts/test-unified-local.cjs.
Veri: daha önce yüklenmiş gerçek integral ders videosunun YENİ özel test
referansı; bizim yazdığımız iki sayfalı PDF, iki slaytlı küçük OOXML PPTX ve
ayrı biyoloji dersindeki UTF-8 metin. Öğrenci veritabanı sıfırlanmadı. Bu küçük
kendi test seti doğal ders korpusu/akademik benchmark yerine geçmez.

Son kabul: PASS. PDF/PPTX/VIDEO aynı soru için döndü; altı citation'ın tamamı
güncel source API'sinden gerçek metin ve konumla açıldı. Özgün PPTX indirilen
baytları yüklenenle aynı. Gerçek yerel qwen3-vl:2b-instruct yapılandırılmış
claim/source cevabı verdi; son tur ilk üç materyal sorusu 5.776s. Önceki başarılı
turlar 1.258s, 1.366s, 1.490s; hız/doğruluk garantisi değildir. Model açıklaması
GENERATED_UNVERIFIED ve support_confirmed=false olarak kaldı.

Takip sorusu önceki konu/cevabı kullandı; indexed_materials=0. PDF/PPTX kanıtı,
video UNKNOWN olsa da açıklamayı engellemedi. Ayrıca yeni test video referansına
boş bir oynatma gözlemi kaydedildi: UNWATCHED ve PDF/PPTX açıklaması yine
GENERATED_UNVERIFIED, erişim engeli yok. Bu boş gözlem fixture'ı insanın
izlediği/öğrendiği iddiası değildir. Biyoloji sorusu matematik
dersinde sıfır kaynak; kendi biyoloji dersinde bir gerçek kaynak döndürdü.
Farklı kullanıcının private materyal listesi boş, yabancı conversation 404.

Gerçek Edge: login, ortak soru, PDF sayfası/slayt metni/video kaynağı açıldı;
native seek gerçek timestamp'ten en fazla 300ms saptı. Oynatıcı readyState>=2
ve seek bitişi beklendi. Yeni referansta 3.2s gerçek oynatma → 3135ms kayıt,
revision3. Gerçek playback sonrasında retrieval'daki ilgili span
PARTIALLY_WATCHED oldu; asıl kaynak videonun eski progress'i aynı kaldı. 390px içerik ve
viewport eşit, JS hatası yok. Test azaltılmış hareket profilini kullanır.

Edge turlarında 1 yerel Türkçe voice bulundu; başlangıç bazen doğrulanamadı.
Utterance referansı korunup 12s başlatma timeout'u ve güvenli cleanup eklendi;
ayrı son `node scripts/test-unified-voice.cjs` gerçek başlangıç/pause/resume için
STARTED_PAUSED_RESUMED verdi. Callback hiç gelmediğinde yazılı cevabın korunduğu
birim testle doğrulandı. Aynı anahtar kullanan voice/practice bileşenleri de
ayrıldı; son arayüz regresyonunda uyarı yok. Sesin duyusal kalitesi,
telaffuz doğruluğu ve her Windows/browser kurulumunda bulunması ölçülmedi.
Voice bulunmadığında yazılı cevap çalışır; uzak/cloud voice kullanılmaz.

Kaynaklı pratik yanlış yanıta REVIEW_SOURCE, kaynak ifadesine EXACT_MATCH verdi;
gerçek kaynağa dönüş var. Bu literal eşleşmedir; kavramsal değerlendirme değil.
PPTX silindiğinde eski citation 404, yeni sorguda silinmiş kayıt yok. Yeniden
yükleme yeni materyal kimliği aldı; demo sonunda üç kaynak yine kullanılabilir.

Ham kanıt: Git dışı data/video-tests/unified-run.json, unified-desktop.png,
unified-mobile.png. Token, parola, öğrenci ham metni/screenshot Git'e eklenmez.

## Gecikme ve sınırlı A/B/C karşılaştırması

Komut: node scripts/benchmark-unified.cjs. Gerçek yapılandırılmış E5/Chroma/SQL;
model çağrısı YOK. Her profilde yalnız 3 tekrar, küçük tek ders:

- A single: yalnız PDF; P50 77.70ms, örnek P95 135.07ms.
- B unified: PDF/PPTX/VIDEO; P50 79.30ms, örnek P95 82.22ms.
- C aligned: aynı üç tür + tahmini ilişkiler; P50 112.66ms, örnek P95 136.45ms.

Küçük n nedeniyle P95 yalnız en yavaş örnektir, güvenilir dağılım tahmini değildir.
Paralel regresyon yükü vardır. C'nin kaliteyi artırdığı ölçülmedi; ek işlem maliyeti
var. Üç tür kapsamı, annotated retrieval recall/precision değildir.
Rate limit gerçek ölçümde 429 verdi; betik pencerenin açılmasını bekler, limit
kapatılmaz. Bekleme süresi request latency hesabına eklenmez.

Yalnız Python servisi restart sonrası --assert-warm: bütün sorgularda
indexed_materials=0; kalıcı projection korundu. İlk soğuk E5 yüklemesiyle A'nın
en yavaş isteği 8992.32ms; P50 81.91ms. B P50 79.03ms, C 118.24ms. Dolayısıyla
soğuk başlangıç yaklaşık 9s olabilir; sıcak 0.1s vaadiyle gizlenmez.
Kanıt: unified-benchmark.json ve unified-persistence.json (yerel/Git dışı).

## Başarısız ilk turlar ve düzeltmeler

- Türkçe büyük İ takip sorusu regex'ine uymadı → normalize edildi, API regresyonu.
- Yüksek E5 cosine, kaynakta olmayan biyoloji sorusuna altı matematik sonucu
  getirdi → gerçek konu terimi anchor şartı ve adversarial dense-score testi.
  Semantic-only eşanlamlı/çeviri recall'ı bilinçli sınırlıdır; ölçülmeli.
- İlk fixture script'i fitz varsaydı → mevcut pinned pypdf ile üretildi; paket yok.
- Test PDF status nesnesini string sandı → mevcut DTO state alanı kullanıldı.
- Python hazır olmadan yükleme yarıştı → Start script health bekler.
- Serbest model çıktısı kesildi/numaralar karıştı → kaynak modu korundu; mevcut
  yerel sampling seçenekleri yalnız bu istek için kullanıldı. Üç çeşitli kanıt,
  yapılandırılmış JSON claim/source ve her numaranın aralık kontrolü eklendi.
  Yanlış numaralı veya kesilmiş açıklama gerçek cevap diye verilmez.
- Login animasyonu sırasında hızlı fill testi kararsızdı → etkileşime hazır
  alanlara gerçek click/fill, azaltılmış hareket ve auth response kontrolü.
  Uygulamanın auth/erişim kontrolleri gevşetilmedi.

## Ölçülmeyen akademik boyutlar

Answer Accuracy, semantic Faithfulness, annotated Precision/Recall, semantic
Attribution Accuracy, Hallucination Rate, öğrenme kazanımı ve memnuniyet
UNMEASURED. Kaynak kimliği doğrulaması entailment değildir. Genel çelişki denetimi
yok; yakın metinde olumsuzlama farkı için tahmini uyarı var. Doğru paraphrase
negatif testi bulunur; tüm çelişkiler yakalanmaz. D öğrenme-context ablation
için bağımsız insan etiketli kontrollü deney yapılmadı. Fizik/biyoloji/matematik
örnekleri erişim/lifecycle için temel sağlar; geniş ders kalite testi yerine geçmez.
