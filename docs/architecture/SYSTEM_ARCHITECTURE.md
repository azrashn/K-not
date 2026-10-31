# Güncel K-NOT servis sınırları

31 Ekim 2026 incelemesine göre uygulanan yapı:

1. React/Vite 5174 → yalnızca NestJS 3100 (JWT, ders üyeliği, yetkili kapsam).
2. NestJS → MySQL 3306 (kullanıcı/ders/belge/video/izleme metadata).
3. PDF yolu: NestJS → Knot Python 8110 → pypdf/chunking/Chroma/RAG.
4. Video yolu: NestJS → yerel MomentSearch 7862 → PostgreSQL kalıcı worker +
   FFmpeg/CPU ASR/E5/CLIP + Qdrant 16433. Yerel Ollama 11436 cevap üretebilir.
5. İzleme yolu: media events → kısa interval deltas → NestJS doğrulaması →
   MySQL VideoProgress. Sıcak ilerleme okuması model veya motora ihtiyaç duymaz.

Yeni microservice, yeni vektör veritabanı veya global paket eklenmedi. PDF
ve video vektörleri farklı modeller/indekslerdedir; birleştirilmiş arama henüz
uygulanmış değildir. Course ID/owner kapsamı her dalda sunucudan kurulmalıdır.

Windows başlatma: scripts/Start-KnotVideo.ps1. Eski dev.ps1 profili başka
uygulamaların 5173/8100 portlarıyla çakışabilir; bu profilde kullanılmaz.
OpenTutor/DocsGPT ve paylaşılan Ollama ayarları korunur. Video motoru loopback
tek kullanıcı profilidir; uzak üretim dağıtımının servis kimliği ayrıca gerekir.

Dosya/modül ayrıntıları: CURRENT_SYSTEM_AUDIT.md, LEARNING_PROGRESS_DESIGN.md,
API_DOCUMENTATION.md ve ../video-integration.md. Tarihsel WBS belgeleri, bu
güncel kaynak incelemesinin yerine geçmez.
