# Gerçek video işleme yolu

Tarayıcı MP4/WebM dosyasını JWT ile Nest'e yükler; üye/owner kapsamı, 100 MB ve
dosya magic kontrolü uygulanır. YouTube/Drive linki yalnızca doğrulanmış video
kimliğinden sabit HTTPS URL'si kurularak sınırlı indiricide alınır. Hesap çerezi
ve ücretli API bu yolun parçası değildir. UTF-8 dosya adı korunur.

Nest dosya hash'ini ve özel Video kaydını yönetir. Aynı içerik başka kayıtta
kullanılıyorsa fiziksel asset paylaşılabilir; kapsam ve progress paylaşılmaz.
Motor kaydı PostgreSQL'de pending → worker claim → fetch → FFmpeg frame
sampling/PTS → CLIP → Qdrant image → CPU faster-whisper base → zamanlı chunk
ve E5 embedding → Qdrant text → indexed şeklinde ilerler. İşlem sürerken
karelerin hazır olması tek başına indexed sayılmaz. Boş ASR açıkça belirtilir.

FFprobe metadata köprüsü gerçek duration/width/height/audio bilgisi verir;
Nest durationMs'yi saklar. Transkript ve kareler gerçek t_start/t_end veya PTS
zamanlarından açılır. Modelin uydurduğu zamanlara göre citation oluşturulmaz.
Matematik ASR/model hataları yine mümkündür; kaynaklı cevap doğrulanmış cevap
anlamına gelmez. OCR/slayt transition veya tam görsel anlam indeksi bu yol değildir.

Silme son referansta raw kaynak, transcript, frame dosyaları, iki vektör dalı,
motor manifesti ve Knot kaydını kaldırır. Başka referans korunur. Ingest/retry/
purge lease'i aktif işin silinen kaydı tekrar üretmesini önler; işlem bitince
silme yeniden denenir. Progress yalnızca ilgili Video FK'siyle silinir.

Çalıştırma/gerçek testler/lisans sınırları: ../video-integration.md ve
MomentSearch/LOCAL_SETUP.md. Kaynak repo telif ve Apache NOTICE korunur.
