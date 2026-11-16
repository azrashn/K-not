# Quiz kaynak bağlama düzeltmesi — 2 Kasım 2026

## Sorun ve kararlar

Kullanıcı quiz sayfasında genel bir kalite reddi gördü. Gerçek AI kaydı:
`quiz_quality_rejected: Unverifiable source quote`, HTTP422. Kaynaktaki cümleyi
küçük modele yeniden yazdırmak, özellikle farklı dil ve OCR/ASR metninde, kesin
alıntı kontrolünü gereksiz yere başarısız kılıyordu.

- Kaynaktan en fazla dört evidence kullanılır. Her biri orijinal karakterler
  korunarak en fazla 1200 karakterlik alıntılara ayrılır. Model yalnız şemadaki
  alıntı kimliklerinden birini seçer. Kimlik dışı alıntı/kaynak değişikliği reddedilir.
- Seçilen gerçek metin ve orijinal source_index sunucuda bağlanır. Sonuç hâlâ
  mevcut `validate_draft`, kaynak substring ve bağımsız şık denetiminden geçer.
- Blind reviewer'a `{index:0,text:...}` nesneleri gönderilir. Gerçek tanıda
  üçüncü seçeneği `3` diye işaretleme gözlendi; indeksler açıkça sıfır tabanlıdır.
- Tekrarlı seçenekler için üretim frequency/presence cezaları ve kısa alan
  talimatları eklendi. Her başarısız aday en fazla bir defa düzeltilir. Denemeler
  aynı 130s bütçesini paylaşır; Nest sınırı 150s. Yanlış seçenek kontrolü gevşetilmedi.
- Kesilmiş/bozuk model çıktısı yeniden denenir; transport hataları 503 ve backend
  ulaşılamama/timeout türleriyle raporlanır. Sahte soru veya literal MCQ fallback yok.
- Eski uyarı form değiştiğinde temizlenir. Kullanıcıya kalite mekanizması yerine
  kaynak ve geri bildirim akışını anlatan kısa metin gösterilir.

## Test kaydı

Otomatik testlerde kaynaklar sentetiktir; model doubles gerçek AI kanıtı değildir.

- `cd ai-service; .\.venv\Scripts\python.exe -m pytest tests/integration/test_quiz_source_binding.py tests/integration/test_context_quality.py tests/integration/test_product_learning.py -q`
  Beklenen: değiştirilmiş/uydurulmuş alıntı engellensin; iki doğru şık reddedilsin;
  tek düzeltme denensin; reviewer cevap anahtarını görmesin. Son sonuç aşağıdaki
  son doğrulama kaydında tutulur.
- `cd backend; node node_modules/jest/bin/jest.js --config jest.config.js --selectProjects unit --runInBand --testPathPatterns quiz-errors`
  Beklenen: timeout, unavailable ve kalite reddi farklı hata türleri olsun;
  hiçbir başarısızlıkta soru kaydedilmesin. **4/4 PASS**.
- `node node_modules/vitest/vitest.mjs run tests/frontend/product-learning.test.jsx`
  Kaydetme/quiz değerlendirme/kaynağa dönme kontrolleri: **4/4 PASS**.
- `node node_modules/vite/bin/vite.js build` ve backend
  `node node_modules/typescript/bin/tsc -p tsconfig.build.json`: **PASS**.
  Önceden bulunan bundle boyutu ve esbuild/oxc uyarıları sürer; sürüm yükseltilmedi.

## Gerçek yerel model testi

Komut: `node scripts/test-quiz-source-binding.cjs`. Yerel Qwen3-VL2B Instruct,
mevcut Algoritma dersi ve gerçek yüklenmiş ders videosunun ASR metni kullanılır.
Mevcut test hesabı yapılandırmasından giriş yapılır; parolalar çıktıya yazılmaz.

Beklenen: gerçek kaynaklı dört ayrı seçenekli bir soru HTTP201 ile kaydedilsin;
cevap/alıntı/şık açıklaması çözmeden sızmasın; kaynak metadatası eşleşsin;
GET ile kayıt aynı dönebilsin.

Son HTTP akışı **PASS**, 12.233 s: üretim, dört farklı şık, kaynak id/konum,
cevap gizliliği ve kalıcılık doğrulandı. İlk aday answer_disagreement ile reddedildi;
ikinci aday tüm makine kontrollerini geçti. Kaynak VIDEO, zaman bilgisi korundu.
Bu test soru çözmez ve video izleme ilerlemesini değiştirmez. Oluşturulan model
sorusu quiz geçmişindedir; kullanılabilirlik için insan incelemesi ayrıca gerekir.

Özel kanıt: `data/context-tests/quiz-source-binding-run.json` ve
`quiz-binding-evidence.json`. Ham içerikler ve öğrenci materyali Git dışında kalır.

## Başarısız denemeler ve açık sınırlar

- İlk gerçek turda kopyalanmış dört seçenek yüzünden iki aday da reddedildi.
- Bir tanı turunda model çıktısı max_tokens sınırında kesildi.
- Sonraki turda reviewer'ın seçenek numarası ile gerçek indeks uyuşmazlığı görüldü.
- Doğrudan model denemesi exact-source kontrolünden geçti; insan incelemesinde
  kaynaktaki “olabilir” ifadesini kesin özellik gibi genelleyen bir soru görüldü.
  Talimatlara niteleyicileri koruma şartı eklendi; bu genel anlamsal doğruluk çözümü
  değildir.
- Son HTTP örneği kaynak/taşıma testinden geçmesine rağmen Türkçe ifade ve
  çeldirici kalitesi zayıftı. Pedagojik kalite **PARTIAL**, tamamen çalışır veya
  doğruluğu kanıtlanmış diye raporlanmaz. 2B model denetimi yanlış olumlu verebilir.
- BFS/DFS için tüm ders retrieval'ında video başlığının genel eşleşmeleriyle ilgili
  bölüm yerine geniş graf kesitleri seçilebildi. Bu dilimde retrieval sıralaması
  değiştirilmedi. Güçlü model ve kaynak kalitesi değerlendirmesi ayrıca gerekir.
- Yeni büyük model, ücretli API, güvenlik ayarı değişikliği veya başka projeye
  müdahale yok. Bu turda tüm 755 eski test tekrar çalıştırılmış değildir.

## Sonraki adım

Son otomatik doğrulama: Python **37/37**, backend hata sınıflandırma **4/4**,
frontend mevcut ürün akışı **4/4**; toplam **45 ilgili kontrol**. Backend/frontend
derlemeleri ve `git diff --check` geçti. Python Starlette/httpx deprecation uyarısı
mevcut; bu düzeltme kapsamında bağımlılık güncellenmedi.

Anlam ve çeldirici kalitesini iyi PDF metni/gürültülü ASR için ayrı ölç. İnsan
değerlendirmesiyle güvenilir üretim oranı yeterli değilse daha güçlü yerel metin
modelini boyut/VRAM bilgisiyle kullanıcıya sun. Başarıyı yalnız HTTP200'e bağlama.
