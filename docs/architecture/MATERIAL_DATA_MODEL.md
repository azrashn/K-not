# Ortak materyal ve kaynak modeli

31 Ekim 2026. Var olan Document, Video, VideoProgress ve iş tabloları korunur.
Eklemeli migrasyonlar: 20261031150000_study_material ve
20261031170000_study_original. Reset/force push kullanılmaz.

## Yetkili materyaller

- PDF: Document, görünürlük PRIVATE/COURSE, status READY, deletedAt=null.
- Video: Video, yalnız yükleyene özel; motorun gerçek indexed durumu aranır.
- PPTX/TXT: yeni StudyMaterial; ders/sahip FK, içerik SHA256, özgün dosya
  storageKey, çıkarılmış bölümler JSON, oluşturulma zamanı. Ders/sahip/hash unique.
  Bu ilk sürümde bu materyaller özel; course-wide paylaşım eklenmedi.

PDF/video kimlikleri kopyalanmaz veya yeni dosyaya dönüştürülmez. Birleştirilmiş
mantıksal kimlikler pdf_<documentId>, video_<videoId>, file_<studyMaterialId>.
StudyMaterial'da eski deneme satırlarının storageKey'i null olabilir; sistem
olmayan özgün dosyayı varmış gibi sunmaz. Yeni yüklemelerde dosya saklanır.

## Normalized segment

Chroma projection: id, material_id, course_id, kind, title, version, text,
location. id = SHA256(materialId + version + canonical JS location JSON + text).
PDF location: kind=page, page, char_start/end. Video: kind=video,
start_ms/end_ms ve char_start/end. PPTX: kind=slide, slide, section
(slide_text/speaker_notes), char_start/end. TXT: kind=text, section, char_start/end.
Eksik zaman/sayfa/slayt uydurulmaz. Video frame embedding bu metin koleksiyonuna
karıştırılmaz. Eşit boyut, eşit embedding uzayı anlamına gelmez.

Materyal sürümü mevcut dosya hash'i + extraction/index sürümünden türetilir.
PDF updatedAt/indexingVersion değişirse eski projection yenilenir. Video
transkript düzenleme henüz yok; video-text-v1 sürümü bunu destekliyor sayılmaz.
Yeni edit/reprocess özelliği revision hash'ini mutlaka değiştirmelidir.

## Kalıcılık ve yaşam döngüsü

Özgün dosyalar mevcut güvenli Storage altında materials/<newId>/original.*;
normalize metinler yapılandırılmış kalıcı Chroma içinde ayrı fingerprint
koleksiyonu. İşlem bitiş marker'ı embedding batch'lerinin ardından yazılır.
Sıcak sorguda aynı hash yeniden çıkarılmaz/embedding üretilmez.

Silme: yeni dosyada Chroma temizliği → özgün dosya → SQL. Hata varsa kayıt
korunur ve yeniden denenebilir. PDF JobsService.purge ortak metin indeksini
de temizler; video kendi kayıt kimliğinin projection'ını temizler. Sorgular
her zaman taze SQL manifest'i ve sürümle filtrelenir. İçerik taşımayan kalıcı
silme marker'ı geç gelen eski index isteğinin kaynağı diriltmesini reddeder.
Yeni yükleme yeni kimlik alır. Eski citation açma isteği 404 verir.

## Konu ilişkileri

RELATED_TOPIC kayıtları yanıta bağlı türetilir. İç retrieval ortak terimleri
kullanır; tarayıcıya yalnız doğrulanmış kaynak kimlikleri ve estimated=true
aktarılır. Kalıcı bir ontoloji veya kanıtlanmış SAME_TOPIC/PREREQUISITE
değildir. Topic CRUD/kalıcı concept graph bu sürümün tamamlanmış özelliği değildir.
