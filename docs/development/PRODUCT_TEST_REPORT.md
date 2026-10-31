# Ürün deneyimi — test ve kabul raporu

31 Ekim 2026. Başlangıç d2d6c3d, dal feature/video-integration.
Makine üzerinde gerçek kod değişikliği ve test yapıldı. Önceki724 sayısı bu
aşamanın sonucu olarak tekrar kullanılmadı. Hiçbir model double'ı gerçek AI
cevabı olarak raporlanmaz.

## Otomatik regresyonlar

- Frontend: `npm test` → **88/88**. Gerçek React/DOM, HTTP/model sınırında fake.
  Yeni ders formu ve hata sonrası retry, ad yazarak silme onayı, sunucuda
  kaydedilen quiz cevabı, kaynak navigasyonu, örnek veri üretmeyen Home;
  geçmiş sohbet, özgün slayt isteği ve ses başlatma timeout'u kapsanır.
- Nest unit: `npm run test:unit -- --runInBand` → **91/91**. Mock birim testidir.
- API: `node scripts/test-backend-api.cjs` → **114/114**. Gerçek Nest/MySQL,
  ayrı rastgele test şeması; Python/video/model sınırları programlanabilir fake.
  Ders owner izolasyonu, arşiv, tam ad onayı, paylaşılan dersin korunması,
  başarısız index temizliği/DELETING/retry, kalıcı sohbet/user izolasyonu,
  silinen veya değişen kaynakta mesaj redaction, quiz/attempt kalıcılığı,
  doğru cevap sonrası tekrar önerisinin temizlenmesi, açık uçlu yanıta puan
  uydurulmaması ve materyal adı yetkisi kapsanır. Gerçek MySQL'in JSON alan
  sırasını değiştirdiği PDF regresyonu ayrıca doğrulandı.
- Python: `.venv/Scripts/python.exe -X utf8 -m pytest -q` → **432/432**.
  Chroma/hashing gerçek; model yanıtı veya subprocess double kullanılan
  doğrulama testleri kendi dosyalarında açıkça işaretli. Son MCQ fallback
  değişikliğinden sonra ilgili unified/product kümesi **30/30** tekrar geçti;
  bu30,432'ye ayrıca eklenmez. İki kötü model JSON testi, yanıltıcı AI sonucu
  yerine açık etiketli gerçek kaynak hatırlama sorusu döndüğünü kontrol eder.
- Gerçek Python/MySQL entegrasyonu:
  `node scripts/test-backend-api.cjs --integration` → **1/1**. Gerçek PDF
  extraction, callback, Chroma, kaynaklı cevap; hashing + extractive profili,
  generatif model kalitesi testi değildir.
- Vite üretim build ve backend build/typecheck geçti. Kaynak lint'i0 hata,
  29 uyarı: mevcut eski örnek ekranlar ve effect/dependency önerileri dahil.
  Vite yaklaşık554KB giriş paketi uyarısı kaldı; code-splitting bitmiş sayılmaz.

Bu aşamada 726 regresyon kontrolü doğrulandı. MomentSearch kaynakları bu aşamada
değişmedi; önceki26 motor testini bu toplama eklemedim.

## Gerçek yerel ders ve Edge testi

Veri: kendi ürettiğimiz10 sayfa PDF, diyagram/şekil/tablo içeren gerçek5 slayt
PPTX, integral metin notu ve daha önce hazırlanmış kendi gerçek integral
videosunun yalnız yeni test dersine ait referansı. Özgün video dosyası,
başka derslerdeki referanslar ve önceki izleme kayıtları değişmez.

Komutlar:

```powershell
ai-service\.venv\Scripts\python.exe -X utf8 scripts/create-product-fixtures.py
node scripts/test-product-local.cjs
node scripts/test-unified-voice.cjs
# Yalnız Knot servislerini yeniden başlattıktan sonra:
node scripts/verify-product-restart.cjs
```

Beklenen/gerçek sonuçlar:

1. Tarayıcıda ders oluşturma ve üç dosyayı yükleme → gerçekSQL/işleme kayıtları,
   PDF/PPTX/TXT/VIDEO READY. **GEÇTİ**. Aynı test dersi tekrar kullanılır;
   yeni demo dersler yığılmaz. Video referansı test kurulumunda gerçek önceki
   videodan oluşturulur; bu, yeniden ASR/indirme yaptığını iddia etmez.
2. Başka kullanıcıda ders, kaynak görüntüsü ve sohbet →404. **GEÇTİ**.
3. Materyal adı düzenleme → görünen ad değişti, özgün dosya korunur. **GEÇTİ**.
4. PDF10. sayfa → gerçek PNG39416byte,10 sayfa; PPTX5. slayt → gerçek
   PNG74609byte,5 slayt. Tarayıcı görüntüleri decode edildi, boyut>100px.
   **GEÇTİ**. Slaytın kendi tablo/şekil/düzeni görülür; AI görsel üretimi yoktur.
5. Video12.saniyeye dönme → gerçek oynatıcı12.saniyede, izlenmiş aralık listesi
   boş kaldı. İleri sarma, izleme puanına dönüşmedi. **GEÇTİ**.
6. “İntegralde değişken değiştirme yöntemi nasıl kullanılır?” → gerçek yerel
   2B Instruct yanıtı, `GENERATED_UNVERIFIED`, `llm_used=true`, dört materyal
   türünden gerçek kanıt. **GEÇTİ**, ancak anlamsal doğruluk otomatik onaylanmadı.
7. Yenileme sonrası “Bir örnek göster” → dört kayıtlı mesaj, doğru önceki soru
   bağlamı ve gerçek kaynaklar. Kaynak tıklanınca materyal görüntüleyici açıldı.
   **GEÇTİ**.
8. Yanlış cloze cevabı → score0, beklenen kaynak ifadesi, kaydedilmiş attempt;
   Analiz → Kaynağa dön → aynı materyal. **GEÇTİ**.
9. Doğru/yanlış kaynak doğrulama, kısa cevap, açık uçlu ve çoktan seçmeli
   alıştırma → SQL'e kayıt ve gerçek geri bildirim. **GEÇTİ**. Son gerçek MCQ
   turunda model sorusu doğrulanamadığı için `LITERAL_RECALL, llm_used=false`
   açıkça etiketlendi. Bu, kavramsal model sorusunun kalite testini geçmiş
   olduğu anlamına gelmez. Kısa yanıt eşleşmediyse scoreNULL; açık uçlu NULL.
10. Home/Dersler390px çalışma ekranı → yatay taşma ve JS pageerror yok.
    **GEÇTİ**. İçerik sayısı gerçek kayıtlardan gelir.
11. Ders düzenle/arşivle/geri al → gerçek kayıtlar/listeler. **GEÇTİ**.
12. Yalnız testin oluşturduğu geçici ders, tarayıcıda tam ad yazarak silindi →
    özgün dosya diskte yok, sohbetSQL'de yok, Node erişimi404, Chroma'da içerik
    yerine `deleted` marker'ı var. **GEÇTİ**. Diğer dersler ve önceki video
    ilerlemesi birebir korundu. Teknik silme marker'ları/iş kimlikleri tutulur;
    tüm veritabanının resetlenmesi veya SQL tablolarının düşürülmesi yapılmaz.
13. Gerçek Edge yerel Türkçe ses: bir ses, start/pause/resume/stop/replay.
    **GEÇTİ**. Fiziksel kalite/telaffuz/doğallık **ÖLÇÜLMEDİ**.
14. Yalnız K-NOT yeniden başladıktan sonra: son turda 6 mesaj, 9 kalıcı quiz, 6 kaynaklı takip
    cevabı, kayıtlı analiz sonuçları. **GEÇTİ**. RAM receipt'leri yeniden
    kaynak kayıtlarından oluşturuldu; model servisi/diğer uygulamalar durmadı.

Kanıtlar ignored `data/product-tests/product-run.json`, `restart-proof.json`,
`real-*.png`, `rendered-*.png`; ses `data/video-tests/unified-voice.json`.
Bu yerel kayıtlar hesap/kaynak bilgisi içerebileceğinden commit edilmez.

## Yakalanan başarısızlıklar ve düzeltmeler

- Course.description eski yerelSQL'de zaten vardı, ilk migrasyon1060/P3018
  verdi. Alan ve veriler incelendi; yalnız kendi başarısız migrasyonu
  rolled-back işaretlendi. Koşullu genişletme/ekleme sonrası deploy başarılı.
- İlk frontend turu eski düğme/konuşma mock'ları nedeniyle8testte başarısızdı.
  Yeni gerçek sözleşme ve yeni davranış beklentileriyle güncellendi;88/88.
- İlk API turunda yalnız ders sıralama beklentisi eskimişti; üyelik/kapsam
  testi korunarak sıralamadan bağımsızlaştırıldı. Son 114/114.
- Gerçek takip sorusu500: MySQLJSON kaynak konumundaki char_start/char_end
  sırasını değiştiriyordu. Kaynak hash kontrolü gevşetilmedi. Güncel yetkili
  segment yeniden okunup kaynakID/sürümüyle eşleştirildi; hem gerçek restart
  hem birebirMySQL PDF regresyonu geçti.
- TRUE_FALSE ilkPython turunda eksik uuid import'u:1 başarısız / 431 geçer.
  Import düzeltildi;432/432, son ilgili küme 30/30.
- Model MCQ alıntısı doğrulanamadı. Hata gizlenip AI başarısı yazılmadı;
  açık etiketli literal kaynak sorusu uygulandı. Kavramsal kalite hâlâ sınırlı.
- Gerçek entegrasyon testi global Python'da eksikhttpx nedeniyle açılmadı.
  Global paket kurulmadı; runner yalnız projenin `.venv` Python'unu seçti,
  gerçek entegrasyon 1/1 geçti.
- İlk tarayıcı otomasyonu odak/düğme/label eşleşmesinde bekledi. Alanlar açık
  erişilebilir adlarla bağlandı; gerçek ürün turu son olarak bütünüyle geçti.

## Tamamlanmış sayılmayanlar

Yerinde dosya değiştirme/başarılı dosyayı reprocess; streaming; genel kavramsal
quiz ve rubrikli açık uçlu değerlendirme; güvenilir konu hâkimiyeti tahmini;
PPTX/PDF görsel OCR/diagram-understanding; ölçülmüş daha doğal Türkçe TTS;
öğretim tahtası; yeni gerçek YouTube/Drive ağ indirme testi. Link adaptörü ve
mevcut izolasyon/validasyon regresyonları korundu; bu turda yeni bir sağlayıcı
indirmesinin başarılı olduğu iddia edilmedi.

Kaynak ölçümü: RTX5060Laptop8151MiB; son snapshot3340MiB kullanılmış/4560MiB
boş. Bu ortak makine snapshot'ıdır, K-NOT'un tek başına tepeVRAM'i değildir.
Dönüştürücü image180012018byte, iş başına2GB/2CPU sınırı. Yeni AI model yok.
OpenTutor/DocsGPT container'ları son kontrolde7saattir Up; portları/volume'ları
değişmedi. Yalnız K-NOT source ve kendi test/veri alanları düzenlendi.
