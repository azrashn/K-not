# Ortak ders retrieval sözleşmesi

Kod: backend/src/knowledge/knowledge.service.ts ve
ai-service/src/knot_rag/unified.py. Yeni bağımsız chatbot/model servisi yok.

1. JWT → requireMember → SQL erişilebilir PDF + özel video/PPTX/TXT manifest'i.
2. Hazır olmayan materyaller aranmaz; UI durumunu gösterir. Video servisi yoksa
   video UNAVAILABLE olur; hazır PDF/PPTX yine kullanılabilir.
3. Fingerprint'li ortak Chroma koleksiyonunun sürümleri okunur. Yalnız değişen
   materyalin mevcut çıkarılmış çıktıları normalize edilir ve embed edilir.
4. Aynı embedder ile dense arama + sınırlı indexed lexical kanal. Skor olasılık
   değildir. Gerçek konu terimi eşleşmesi olmayan semantic-only sonuçta çekimser
   kalınır; bu tercih eşanlamlı/çeviri recall'ını düşürebilir.
5. aligned profili, sorgu terimini paylaşan farklı materyallere küçük ve sınırlı
   ranking katkısı verir. Yalnız ilgili sonuçlarda materyal çeşitliliği korunur.
   En çok 6 kanıt; bağımsız çok materyal reranker/kalıcı topic index yoktur.
6. Nest kaynak kimliği/hash/konum/tür ve taze manifest'i yeniden kontrol eder.
7. Her video span'ı için kendi SQL izleme sınıfı hesaplanır. PDF/PPTX bulunması,
   izlenmeyen videonun bütün cevabı engellemesini önler.
8. Model için ilk 3 çeşitli kanıt, bounded question ve önceki tek cevap bağlamı
   kullanılır. Geçerli kaynak numarası zorunlu, fakat entailment doğrulanmış değildir.
   Kalan kanıtlar ek retrieval kaynaklarıdır; modele verildiği iddia edilmez.

POST /courses/:courseId/knowledge/answers:
question, active_material_id?, current_time_ms?, conversation_id?, explain_now?,
strategy? (single/unified/aligned; değerlendirme için). Materyal seçimi varsayılan
ders kapsamını daraltmaz. single yalnız ablation/diagnostic profildir.

Yanıt: status, answer, llm_used, evidence (n/id/material_id/source_id/kind/version/
location/text), video_learning, associations, conflicts, conversation_id,
indexed_materials, support_confirmed=false, note. Üretken cevaplar
GENERATED_UNVERIFIED; model kapalıysa SOURCE_EXCERPTS; tamamlanamayan üretim
GENERATION_FAILED_SOURCE_EXCERPTS; alıntı numarası hatalıysa INVALID_CITATIONS.
Kaynak yoksa NO_EVIDENCE, uydurma timestamp yoktur.

POST knowledge/search aynı scoped retrieval'ı EVIDENCE_ONLY olarak model
çağırmadan verir. POST knowledge/practice {conversation_id} ve
POST knowledge/practice/:id/answers {answer} kaynak bağlı literal pratik içindir.
Association/conflict source ID'leri de seçilmiş evidence kapsamıyla doğrulanır;
keyfi upstream alanları/terimleri doğrudan tarayıcıya aktarılmaz. Açık açıklama
aşamasında aynı kaynak seçiminin uyarıları korunur.

GET knowledge/materials; POST knowledge/materials (PPTX/TXT multipart);
GET knowledge/materials/:id (çıkarılmış kaynak listesi);
GET knowledge/materials/:id/sources/:segment (güncel gerçek kaynak);
GET knowledge/materials/:id/file (özgün PPTX/TXT, sahiplik kontrollü attachment);
DELETE knowledge/materials/:id (PPTX/TXT). PDF/video mevcut upload/delete uçlarını
kullanır; aynı ekran bu uçları yönlendirir.

Sınırlar: 100 materyal/ders, 1000 segment/materyal, 2 MiB PPTX/TXT, 300 slayt;
ZIP 20 MiB açılmış içerik/2000 entry, tek XML 2 MiB, 600000 çıkarılmış PPTX karakteri.
XML entity/external relationship çalıştırılmaz. Görsel/OCR extraction yoktur.
İlk soru projection hazırlayabilir; büyük işler için kalıcı projection job'u sonraki iştir.

İç Python uçları /api/v1/knowledge/{state,index,search,extract,explain} yalnız
mevcut servis token'ıyla korunur. İnternete açılmamalıdır. İçerik güvenilmeyen
veridir; kaynak talimatları sistem mesajına taşınmaz. Prompt savunması tam
enjeksiyon güvenliği veya genel olgusal doğruluk kanıtı değildir.
