# Test planı ve komutlar

## Mevcut sistemi koruma

- Frontend: `node node_modules/vitest/vitest.mjs run`.
- Nest unit: backend içinde `node node_modules/jest/bin/jest.js --config
  jest.config.js --selectProjects unit --runInBand`.
- Knot Python: ai-service içinde `.venv/Scripts/python.exe -m pytest -q`.
- Motor: yerel FFmpeg PATH profili sonrası `.venv/Scripts/python.exe -m pytest tests -q`.
- Her iki build ve backend typecheck; hedef lint. Var olan uyarılar ayrı raporlanır.

## Yeni ilerleme kabul testleri

1. Interval overlap/adjacency/replay/gap; negatif/ters/taşan aralık reddi.
2. Son konumun watched toplamını büyütmemesi; revision yarışında union korunması.
3. Gerçek server metadata, yanlış engine ID'nin reddi, sıcak okumada motor çağrısı olmaması.
4. DTO/owner/course/anonymous kontrolleri; gerçek MySQL save → GET.
5. Gerçek browser play → pause → seek 1:40 → play → replay → reload/resume.
6. 390px taşma/JS hatası ve Blob kaynağı. Dikkat/anlama başarısı test edilmez.

Gerçek E2E: `node scripts/test-video-progress.cjs`. Ön koşul eski yerel private
fixture ve integral-fresh.mp4; betik yeni demo dersi/video ilişkisi ekler,
mevcut ilerleme kaydını değiştirmez. Parola/token çıktı verilmez. Kanıtlar
data/video-tests/progress-run.json ve ekran görüntüleridir; Git'e alınmaz.

## İzole MySQL API testleri

Hazır Knot Docker DB'siyle `node scripts/test-backend-api.cjs`. Betik container'ın
bu repoya ait olduğunu doğrular, her çalıştırmada yeni knot_test_w1_<run> şeması
ve yalnızca o şemaya yetkili test hesabı oluşturur. Var olan kullanıcı şeması ve
diğer test şemaları temizlenmez. Yeni sentetik şema inceleme için korunur.
Jest kapanışında forceExit kullanılır; bu bir uygulama shutdown testi değildir.

TEST_DATABASE_SERVER_URL yalnızca test hesabını içermeli; test şeması
knot_test_w<N> ad sınırından geçer. TEST_DATABASE_PRECREATED=true, şeması önceden
hazırlanmış ve yalnızca o şemaya yetkili kullanıcıyla admin erişimi istemez.
Temizlik yalnızca test fabrikasının ürettiği Prisma client'ta mümkündür; Video
ve VideoProgress de FK sırasıyla temizlenir. Kullanıcı DB'si test hedefi olamaz.
API harness'in AI servisi fake'tir; bu testler gerçek AI sonucu olarak sunulmaz.

## Sonraki kalite testleri

Kritik QA regresyonu: `node scripts/test-learning-video.cjs`; gerçek private
video fixture'ları gerekir, ayrı test referansları/izleme fixture'ları oluşturur.
İstenen dört sınıf, eksik kaynak, explicit explain, gerçek jump ve kullanıcı
ayrımı kontrol edilir. Sonuçlar EVALUATION_RESULTS.md'dedir.

Eski Python/MySQL entegrasyonu: komut ortamında ai-service/.venv/Scripts PATH'e
eklenerek `node scripts/test-backend-api.cjs --integration`. Hashing/extractive
profil; gerçek üretken model değildir. Mevcut PDF Edge E2E:
`node scripts/test-backend-api.cjs --e2e`. Her biri yeni boş, sadece test
hesabına açık şema oluşturur. --e2e yerel Python/Edge'i seçer ve geçici portları
kullanır. Windows test komutları doğrudan yerel Node CLI üzerinden yürür.
Test şemaları incelemeye bırakılır; uygulama veritabanı test hedefi olmaz.

Gerçek etiketli sorularla context localization, watched/unwatched kuralı, ortak
evidence, groundedness, TTS ve quiz geri bildirimi ayrı senaryolarla ölçülecek.
Şimdiki birim test oranı öğrenme veya AI başarı oranı değildir.
