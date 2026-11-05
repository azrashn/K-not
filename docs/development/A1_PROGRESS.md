# A1 — Quiz doğruluğu, devam kaydı

5 Kasım 2026. Durum: **KISMEN UYGULANDI; GERÇEK MODEL KABULÜ BEKLİYOR**.

## Korunan düzeltmeler

- K10: normalizasyon matematik operatörlerini koruyor. x+y/x-y/x*y/x/y
  birbirinden farklı; yalnız boşlukla gizlenmiş tekrar reddediliyor.
  Short-answer kaynak denetimi de değiştirilmiş operatörü kabul etmiyor.
- K08: ayrıntılı objective, public quiz cevabında null; aynı hedef öğrenci
  yanıt verdikten sonra feedback içinde geliyor. Böylece eski soru hedefindeki
  paraphrase cevabı da cevap öncesinde açığa çıkmıyor. Soru kökünde anlamsal
  sızıntının genel değerlendirmesi hâlâ gerekli.
- K16/K22: istek epoch kontrolü, ders değişiminde kapsam/geçmiş temizliği,
  bekleyen soru yükleme görünümü. Eski üretim/yanıt/geçmiş isteği yeni dersin
  durumunu değiştirmiyor. Üretim sırasında konu/kapsam/tür değişimi kilitli;
  kullanıcı ders değiştirerek yeni bağlama geçebiliyor.
- Gerçek model değerlendirme betiği yeni çalışmaları zaman damgalı ayrı dosyada
  saklıyor. Eski başarısızlıklar gelecekteki çalıştırmalarda ezilmeyecek.

## Başarısız deneyler — üretime alınmadı

Kaynak sözcükleri enum içinden seçtirme ve doğru seçeneği şemada sabitleme
2B modelde denendi. Bu, geçerli soru sayısını artırmadı; seçenek uzunluğu ve
anlamlı çeldiriciler yine reddedildi. Bu deneysel değişiklikler geri alındı.
Kalite kapıları gevşetilmedi. Son gerçek deneylerde yeni akış BFS/DFS ve biyoloji
sorularını yayımlayamadı; kaynakta olmayan konu doğru biçimde reddedildi.
Bu sonuçlar A1'in tamamlandığı veya daha iyi soru kalitesine ulaşıldığı anlamına gelmez.
Yerel ham kanıt: data/quiz-evaluation/before-after-qwen3-vl-2b-instruct.json.

## Model

Onaylı qwen3:4b-instruct-2507-q4_K_M özel MomentSearch11436 ortamına çekiliyor.
Başlatılan süreç indirme günlüğü: MomentSearch/logs/quiz-model-pull.log.
Son gözlemler %17 /433MB civarıydı; hız değişken. Kurulu/aktif model sayılmıyor.
QUIZ_LLM ayarları değiştirilmedi. Paylaşılan model sunucusuna müdahale yok.

## Test

İlk odaklı tur: Python36/36; backend quizunit7/7 ve backend build geçti;
frontend product-learning5/5. Yeni matematik ve geç gelen quiz testleri dahil.
Deney geri alındıktan ve son UI kontrolleri eklendikten sonra tam regresyon
sonuçları bu kayda eklenecek. Mock testler gerçek model kalitesi değildir.

## Sonraki adımlar

1. Özel indirmeyi yeniden başlatmadan önce mevcut pull sürecini/tags listesini kontrol et.
2. Tamamlanınca 4B ile zaman damgalı aynı benchmarkı çalıştır; soru/şık/geri bildirim
   insan incelemesini yap. Gerçek PDF ve video için yalnız yeni QA hesabını kullan.
3. Gerekli düzeltmeleri kanıtlanan hataya göre yap; kaynak ve tek doğru cevap
   denetimini kaldırma. Yalnız kabul uygunsa özel QUIZ_LLM ayarını etkinleştir.
4. Sahipliği doğrulanmış K-NOT AI/backend süreçlerini kontrollü yeniden başlat;
   gerçek tarayıcıda üretim → cevap → feedback → kaynağa dönüşü test et.
5. 60 öğretmen etiketli/görülmemiş soru kabul seti henüz hazırlanmış değil.
   Bu kapı geçmeden “quiz çok iyi çalışıyor” iddiasında bulunma.

## Yeni gereksinim

Ara sınav/final dosyalarından özgün deneme oluşturma A2-E olarak plana eklendi.
K60 durum PLANLANDI: sınav/cevap anahtarı ayrımı, öğretmen onaylı blueprint,
ders kaynaklarına dayalı özgün sorular, puan/süre ve cevap gizliliği kabulü.

## Son regresyon

Deneyler geri alındıktan sonra Python471/471 (53.23s,39uyarı), frontend93/93 (18.36s) ve frontend build geçti. Backend odaklı7/7 ve build geçti; tam unit sonuçları ayrıca kaydedilecek. İndirme yüzdesi retry sırasında gerileyebiliyor; süre garantisi yok.

Tam backendunit101/101 geçti (4.813s). Son benzersiz otomatik toplam665 = frontend93 + backend101 + Python471. A1 genel durum hâlâ KISMEN; gerçek model ve browser kabulü bekleniyor.
