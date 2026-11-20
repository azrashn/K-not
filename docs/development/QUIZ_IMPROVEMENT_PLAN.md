# K-NOT soru üretimi geliştirme planı

Başlangıç: 2 Kasım 2026, `feature/video-integration`, temel commit `3b8241f`.
Durum: araştırma ve uygulama devam ediyor. Başarı yalnız HTTP201 değildir.

## Hedef

Gerçek ders kaynaklarından Türkçe, konuya bağlı, tek doğru cevaplı ve açıklamalı
sorular üretmek; PDF sayfası/video zamanı kaynaklarını ve cevap gizliliğini korumak.
Mevcut 2B modelin dil ve çeldirici sınırlarını ölçmek, yetersiz çıktıyı başarı
diye göstermemek. Yeni büyük model indirmesi ayrıca boyut/kaynak bilgisiyle onay ister.

## Sıralı işler

1. Mevcut üretim/retrieval hatalarını örneklerle sabitle; aynı ölçütlerle karşılaştır.
2. Açık kaynak adaylarını gerçek kod, lisans, yerel model/Windows uyumu ve ek
   bağımlılıklara göre incele. Referans için DeepTutor, Questgen ve Leaf değerlendir.
3. Uygun kaynağı commit'e sabitle; yalnız gereken modül/kuralları uyarlayıp lisans
   ve köken bildirimini koru. K-NOT uygulaması ve API sözleşmesi korunacak.
4. Kaynağı/öğrenme hedefini seçme, soru/cevap hazırlama, çeldirici üretimi ve
   denetimi küçük ayrı adımlara böl. Kaynaksız konu ve bozuk ASR'yi ayır.
5. Konu eşleşmesi ve bütünleşik ders kapsamını test et; genelleştirilmiş video
   başlığı eşleşmesinin asıl konu metnini bastırdığı örneği düzelt.
6. İlgili birim/entegrasyon testlerini ve gerçek yerel model denemelerini çalıştır.
   Türkçe dil, konu uyumu, tek doğru cevap, makul çeldiriciler, kaynak/cevap gizliliği
   ve süreyi ayrı kaydet. Arayüzde hazırlama, çözme ve kaynağa dönmeyi doğrula.
7. İlerleme, test sonuçları, alınan kod/lisans ve kalan sınırları güncelle; değişiklikleri
   ayrı yerel commit'te sakla. OpenTutor/DocsGPT ve paylaşılan modeller değişmez.

## Skill kararı

`find-skills` ve `skill-installer` yönergeleri kullanılıyor. Resmî Playwright skill'i
UI testi için incelenip kurulacak. Sırf arama sonucunda göründüğü için eğitim skill'i
kurulmayacak; kaynak ve işleyişinin K-NOT geliştirmesine uygunluğu doğrulanacak.
Skill kurulumu uygulamanın modelini kendiliğinden güçlendirmez.

## Kabul ölçütleri

- Kaynakta bulunmayan konu için başka konudan soru yayınlanmamalı.
- Basit ve açık ders metninden akıcı Türkçe bir soru, dört farklı/makul seçenek ve
  kaynakla desteklenen tek doğru cevap çıkmalı. İnsan örnek incelemesi gerekli.
- ASR/video ve PDF örnekleri ayrı raporlanmalı; başarısız denemeler saklanmalı.
- Cevap öncesi alıntı/cevap anahtarı sızmamalı; kaynak metadatası kalıcı kalmalı.
- Uydurma çıktı, ücretli API veya kullanıcı verisi reseti kullanılmamalı.
- İyileşme oranı ve süre önce/sonra aynı örneklerle ölçülmeli; model sınırı varsa açık yazılmalı.

## Devam kaydı — site yeniden açıldı (2 Kasım 2026)

- DeepTutor f7aed0744c36c5afef16a4261c31ebee1208cac2 seçildi. Apache lisansı
  third_party/deeptutor altında; parse/normalize yardımcıları quiz_payload.py'ye
  uyarlandı. Kaynağa bağlı plan ve A/B/C/D seçenek akışı quiz_planning.py ile eklendi.
- BFS/DFS gibi kısa teknik terimlerin elenmesi düzeltildi; açık teknik terim
  bulunmayan genel graf parçaları bu sorguların yerine seçilmiyor.
- Resmî openai/skills Playwright skill'i kullanıcı klasörüne kuruldu.
- Bu dilimde tüm Python testleri 468/468, backend unit 100/100 ve backend derlemesi
  geçti. Son küçük prompt onarımı sonrası ilgili testler yeniden çalıştırılmalı.
- Gerçek 2B karşılaştırma data/quiz-evaluation/before-after.json içinde. Eski akış
  kaynakta olmayan fotosentez konusu için graf sorusu yayınladı; yeni plan reddetti.
  Yeni biyoloji örneği yayınlandı; BFS/DFS örneği exact-source plan kontrolünde
  reddedildi. Pedagojik kalite tamamlanmış değildir.
- Kullanıcı yaklaşık 2.5 GB Qwen3 4B Instruct indirmesini açıkça onayladı.
  qwen3:4b-instruct-2507-q4_K_M özel 11436 ortamına çekilmeye çalışıldı; bağlantı
  stall/read-timeout verdi. Son yeniden açılışta tags listesinde henüz yok.
  Model başarılı şekilde indirilip test edilmeden QUIZ_LLM_* aktif edilmemeli.
- Yeni değişiklikler önceki 3b8241f üzerine çalışma ağacında; henüz commit edilmedi.
  Plan/sonuç dokümanları ve gerçek model/API/UI doğrulaması tamamlanınca kaydet.
- K-NOT yeniden açıldı: 5174, 3100/health, 8110/health, 7862/api/health HTTP200.
  Tarayıcıda http://127.0.0.1:5174/#/dersler açıldı. Diğer projelere dokunulmadı.

Sonraki somut adımlar: özel model indirmesini kısmi dosyaları silmeden tamamla;
aynı before/after örneklerini --model qwen3:4b-instruct-2507-q4_K_M ile çalıştır;
insan incelemesiyle doğrula; uygun ise ai-service/.env içine yalnız QUIZ_LLM_*
ayarlarını ekle; gerçek PDF/video + tarayıcı quiz/cevap/kaynağa dönüş testlerini
bitir. Kaynak, cevap gizliliği ve kalite denetimlerini gevşetme.
