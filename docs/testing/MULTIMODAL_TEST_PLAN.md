# Unified multimodal test planı

## Çalıştırma

- npm test -- --reporter=dot; npm run build.
- backend: npm run test:unit -- --runInBand; npm run typecheck; npm run build.
- node scripts/test-backend-api.cjs: gerçek izole MySQL + fake AI boundary.
- Aynı runner --integration: gerçek Python/Chroma, hashing/extractive baseline.
- Aynı runner --e2e: eski PDF claim/highlight tarayıcı sözleşmesi. Yeni varsayılan
  workspace'ten farklı eski rota açıkça seçilir; test gizlice gevşetilmez.
- ai-service: .venv/Scripts/python.exe -m pytest tests -q.
- Gerçek kendi fixture'ları: ai-service/.venv/Scripts/python.exe
  scripts/create-unified-fixtures.py; node scripts/test-unified-local.cjs.
  Son betik eski yerel integral test dosyası ve private test hesaplarını gerektirir.
  Yeni özel dersler/referanslar oluşturur; kullanıcı verisini sıfırlamaz.
- Yerel ses: node scripts/test-unified-voice.cjs; gerçek utterance start/pause/
  resume callback'leri. Duyusal ses kalitesi test edilmez.
- Arama: node scripts/benchmark-unified.cjs; yalnız 3 tekrar/profil. Python
  restart sonrası --assert-warm ile kalıcı projection ve sıfır yeniden indeksleme.

Gerçek UI: ayrı Edge oturumu, ortak soru, PDF/PPTX/video kaynak açma, gerçek
video zamanı, 390px taşma ve JS hatası. İndeks warm çağrısında yeniden
embedding yapılmaması; materyal silme/tekrar yükleme; asıl progress korunması.

## Etiketli değerlendirme kapsamı (15 senaryo)

1. Yalnız PDF bilgisi: single profili, gerçek page identity ve kaynak kontrolü.
2. Yalnız video: span + dört izleme sınıfı; mevcut progress/learning regresyonu.
3. Yalnız PPTX: slide-aware extraction ve gerçek slide identity.
4. Video + PDF: scoped source diversity ve açıklama.
5. PDF + PPTX: iki gerçek konum, yanlış kaynağa attribution reddi.
6. Üç tür: gerçek integral demo testi; yanıt kalitesi ayrı insan puanlaması gerektirir.
7. Ortak konu: tahmini RELATED_TOPIC, kesin eşdeğerlik sayılmamalı.
8. Çelişki: yakın ifadede olumsuzlama farkı uyarısı + farklı anlatıma false positive testi.
9. ASR bozukluğu: gerçek kaynak metni korunur; her hata otomatik düzeltilmez.
10. Kaynakta yok: yüksek dense skor olsa da konu bağı yoksa abstain.
11. İzlenmiş span: union sınıfı, mastery değil.
12. İzlenmemiş span + PDF: PDF açıklaması engellenmez.
13. Takip: Türkçe İ, ders/owner bağlı receipt, bounded önceki cevap.
14. Farklı ders/kişi: gerçek negatif SQL/API testleri; aynı biyoloji sorusu
    matematik dersinden biyoloji kaynağı getirmemeli.
15. Silinmiş/güncellenmiş kaynak: stale hash/receipt/source reddi, geç publisher
    tombstone kontrolü, yeniden yüklemede yeni kaynak kimliği.

Bu liste 15 ayrı ölçülmüş akademik başarı yüzdesi değildir. Test durumu ve
ölçülmeyenler AI_EVALUATION_RESULTS.md'de ayrı gösterilir.

## Ablation

A single, B unified, C aligned aynı soru/erişim manifest'iyle ölçülmeli.
D öğrenme bağlamının etkisi ayrı kontrollü örnekte ölçülmeli; yetki kontrolü
hiçbir profilde kapatılmaz. Ground-truth source ID + gerçek page/slide/span,
precision/recall, sıfır kaynak sorusu ve sıcak/soğuk gecikme tutulmalı. İnsan
tarafından bağımsız doğruluk/faithfulness değerlendirmesi henüz yapılmadı.
Az sayıda kendi fixture'ından genel başarı oranı çıkarılamaz.
