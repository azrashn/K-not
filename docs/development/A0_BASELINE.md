# A0 — Temel, izolasyon ve doğrulama

5 Kasım 2026. Başlangıç HEAD: 3b8241f. Önceki quiz değişiklikleri korunur;
bu kayıt onların gerçek model kabulünün tamamlandığı anlamına gelmez.

## Yapılanlar

- Tracked patch ve izinli untracked kaynakların SHA256 manifestli yedeği:
  `logs/a0-baseline-2026-11-05/`. Yedek Git dışındadır; env/data/credentials içermez.
- Ayrı USER rolünde QA hesabı `scripts/create-qa-account.cjs` ile oluşturuldu.
  Kayıt `data/qa/account.json` içinde; tekrar çalıştırma hesabı çoğaltmaz veya
  mevcut kullanıcının parolasını değiştirmez. İlk oluşturma kesilirse kayıt
  otomatik silinmez; kullanıcıya ait hesaplara müdahale edilmez.
- Yeni QA çalışmaları yalnız bu hesapla yeni dersler oluşturmalı. Eski
  `test-product-local.cjs` ve `test-quiz-source-binding.cjs` gibi betikler eski
  test hesabını kullanır; yeni kabulün varsayılan komutları değildir.
- Backend API/MySQL testleri `scripts/test-backend-api.cjs` ile ayrı
  `knot_test_w1_<run>` şemasında çalıştırılır; geliştirme DB'si resetlenmez.
- `.github/workflows/quality.yml`: Windows / Node24 frontend test+build,
  backend unit+build, Python3.14.2 sözleşme testleri. Gerçek AI kalite ölçümü
  ve MySQL/API testleri bu job'ların sonucu olarak sunulmaz.
- `constraints-windows-py314.txt`: çalışan Windows ortamının tam sürüm
  kısıtları. Kurulum: `python -m pip install -c constraints-windows-py314.txt -e '.[dev]'`.
  İsteğe bağlı embedding için aynı constraints ile `.[dev,embeddings]` kullanılabilir.
  Bu dosya hash doğrulamalı bağımsız paket arşivi değildir; temiz kurulum
  ve GitHub runner kabulü ayrıca gereklidir. Global Python değiştirilmedi.
- Güncel bulgu kaydı `IMPLEMENTATION_BACKLOG.json`; aşama planı
  `IMPLEMENTATION_PLAN_2026-11-05.md`. Kapanış için test/kanıt gerekir.

## Test sınıfları

1. Frontend/Nest unit/Python: sözleşme, mantık, fakes ve yerel Chroma testleri.
2. API: gerçek MySQL + fake AI, izole şema.
3. Integration: gerçek MySQL/Python; hashing veya açıkça seçilen E5 profili.
4. Gerçek model: model adı, kaynak, süre ve başarısızlıklar saklanır.
5. Eğitim kabulü: öğretmen/insan incelemesi. HTTP200 ve model öz-denetimi yeterli değildir.

## Bakım borcu kararı

Önceki lint incelemesi: 184 dosya / 244 warning. Otomatik toplu düzeltme yok.
Öncelik: anlamı değiştiren regex/akış uyarıları → aktif ürün yollarındaki
kullanılmayan/hatalı parçalar → eski mock ekranların temizliği. Kaynakları
toptan yeniden biçimlendirme ana özellik çalışmasına karıştırılmaz.
39 Python deprecation uyarısı bağımlılık yükseltme kabulünde ele alınacak;
testleri yeşil göstermek için uyarılar bastırılmaz.

## A0 kabul sınırı

Yerel snapshot, QA hesabı, sürüm constraints, backlog ve CI yapılandırması
uygulanmıştır. Temiz Windows kurulumunu ve GitHub Actions sonucunu bu yerel
çalıştırma kanıtlamaz. Bunlar kayıtta açık bekleyen doğrulamalardır.
K26/K55–K59 bütünüyle kapanmış değildir; A0'ın bir kısmı sonraki aşamalarla
bağlantılıdır. Yeni model/quiz kalitesi A1, büyük veri/restore A7 kapsamındadır.

## Yeni yerel sonuçlar

Frontend92/92 (47.14s), backendunit100/100 (29.323s), Python468/468 (109.89s). Toplam660; frontend ve backend build geçti. pip check temiz. QA login200, roleUSER ve0ders. Workflow YAML parse geçti; GitHub çalışması yapılmadı. Python39 deprecation ve frontend563.82kB giriş JS uyarıları korunuyor.
