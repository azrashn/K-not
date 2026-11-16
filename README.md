# K-not

Üniversite öğrencileri için **kanıt öncelikli** çalışma alanı. Yanıtlar, öğrencinin yüklediği ders materyallerine bağlanır; kanıt yoksa K-not bunu açıkça söyler.

```
CLAIM → KNOT → SOURCE        ASK → PRACTICE → ANSWER → FEEDBACK → REVIEW
```

## Gereksinimler

| Araç | Sürüm | Ne için | Zorunlu? |
| --- | --- | --- | --- |
| İşletim sistemi | Windows 10/11, macOS, Linux | `npm run setup` üçünde de çalışır; `scripts/*.ps1` yalnızca Windows | — |
| **Node.js** | **>= 20.19** (22 LTS önerilir, bkz. `.nvmrc`) | Ön yüz (Vite) ve backend (NestJS 11, Prisma 7) | Evet |
| **Python** | **3.11 – 3.14** | AI servisi (FastAPI, ChromaDB, pypdf) | Evet |
| **Docker** (Compose v2) | güncel | MySQL 8 konteyneri; PPTX önizleme görüntüsü | Evet\* |
| Git | herhangi | — | Evet |
| Poppler (`pdftoppm`) | herhangi | PDF/PPTX özgün sayfa görüntüsü (yoksa yalnızca metin gösterilir) | Hayır |
| Tesseract (+ dil verisi, örn. `tesseract-ocr-tur`) | 5+ | Taranmış PDF için isteğe bağlı OCR (`INGEST_OCR_ENABLED=true`, `ai-service/.env.example`) | Hayır |
| FFmpeg | 6+ | Yalnızca harici video motoru için (aşağıya bak) | Hayır |
| Disk / ağ | ~5 GB, ilk kurulumda internet | torch + gömme modeli (`intfloat/multilingual-e5-small`, ~470 MB) | — |

\* Docker yerine kendi MySQL 8'ini kullanabilirsin: `npm run setup -- --no-docker --database-url=<MySQL bağlantı adresi>` (adres `mysql://` ile başlar; kullanıcı, parola, host, port ve veritabanı adını içerir; örnek biçim `backend/.env.example` içindeki `DATABASE_URL`).

Poppler kurulumu: Windows `winget install oschwartz10612.Poppler` (ya da `choco install poppler`), macOS `brew install poppler`, Debian/Ubuntu `sudo apt install poppler-utils`. PATH'te değilse `PDFTOPPM_PATH` ortam değişkenine tam yolu yaz. FFmpeg: `winget install Gyan.FFmpeg` / `brew install ffmpeg` / `sudo apt install ffmpeg`.

> **Video motoru bu repoda yok.** "Ders videoları" özelliği ayrı bir yerel **MomentSearch** motoruna (varsayılan `http://127.0.0.1:7862`, `VIDEO_SERVICE_URL`) bağlanır; motor, Whisper/CLIP/Qdrant/PostgreSQL/Ollama ve FFmpeg ister ve ayrıca kurulur ([docs/video-integration.md](docs/video-integration.md)). Motor çalışmıyorsa uygulamanın geri kalanı (PDF/PPTX/TXT, sohbet, alıştırma, analiz) normal çalışır; yalnızca video yükleme/işleme uçları hata verir.

## Hızlı kurulum (tek komut)

```bash
git clone https://github.com/azrashn/K-not.git
cd K-not
npm run setup -- --start     # ya da: ./setup.sh --start (macOS/Linux/Git Bash) · setup.bat --start (Windows)
```

Docker'ın **açık** olduğundan emin ol. Betik (`scripts/setup.mjs`) sırayla: ön koşulları denetler → `.env`, `.env.docker`, `backend/.env`, `ai-service/.env` dosyalarını şablonlardan üretir (rastgele gizli değerler; DB adresi, tokenlar ve `data/storage` yolu servisler arasında eşitlenir) → MySQL'i Docker'da başlatır → `npm ci` (ön yüz + backend) → Python sanal ortamı (`ai-service/.venv`, sürümleri sabit `requirements*.txt`) → migrasyon + seed → backend derlemesi → (`--start` ile) servisleri başlatır. Tekrar çalıştırmak güvenlidir.

Seed hesapları (`admin@knot.local`, `ayse@knot.local`, `mehmet@knot.local`, `m.aydin@knot.local`) için üretilen parolalar ekrana basılmaz; betiğin yazdığı `written to <dosya>` yolundaki geçici dosyada durur (repo dışında). Okuyup sil.

```bash
npm run start:all     # frontend (5173) + backend (3000) + AI (8100); günlükler logs/
npm run status:all
npm run stop:all
```

Uygulama: http://localhost:5173. İlk açılışta AI servisi gömme modelini indirir (birkaç dakika); `status:all` AI'ı "ÇALIŞIYOR" gösterene kadar bekle. Bayraklar: `--no-embeddings` (torch'suz, yalnızca testler için), `--no-docker`, `--database-url=…`. Windows'ta eski `npm run dev:all` (PowerShell) da çalışır.

## Sorun giderme

Önce şunu çalıştırın: `npm run doctor`. Docker, MySQL konteyneri, veritabanı bağlantısı, 3000/5173/8100 portları ve yerel model tek ekranda ✓ / ! / ✗ ile gösterilir; her ✗ için ne yapılacağı yazılır. `npm run doctor -- --fix`, `DATABASE_URL` içindeki `localhost` adresini `127.0.0.1` yapar (Windows'ta IPv6'ya çözülüp bağlantı zaman aşımı yaratabilir). `npm run start:all` MySQL konteynerini kendisi açar ve sağlıklı olmasını bekler; port başka bir programda kullanılıyorsa başlamaz ve PID'yi söyler.

| Belirti | Neden / çözüm |
| --- | --- |
| `Docker kurulu ama çalışmıyor` | Docker Desktop'ı aç, hazır olunca `npm run setup` tekrar. |
| `port is already allocated` (3306) | Makinende başka MySQL var: `.env.docker` içinde `MYSQL_HOST_PORT=3307` yap, `npm run setup` tekrar. |
| `Access denied for user 'knot'` | `.env.docker` parolası, daha önce oluşmuş eski Docker volume'üyle uyuşmuyor. Veriyi kaybetmeyi göze alıyorsan: `docker compose --env-file .env.docker down -v`, sonra `npm run setup`. |
| `Python 3.11 – 3.14 bulunamadı` | Python 3.15+ için hazır tekerlekler (torch, chromadb) olmayabilir; 3.12/3.13 kur. Farklı yoldaysa `PYTHON=/yol/python npm run setup`. |
| AI servisi açılmıyor, `localhost:8000` bağlantı hatası | `ai-service/.env` içinde `CHROMA_MODE=persistent` olmalı (`http` ayrı bir `chroma run` sunucusu ister). Şablon artık `persistent`. |
| Cevap `503 INDEX_VERSION_MISMATCH` / `/ready` → `ai_index` uyuşmuyor | `ai-service/.chroma` başka bir gömme modelinden kalmış. `npm run stop:all`, `ai-service/.chroma` klasörünü sil, `npm run start:all`. Gömme ayarları (`EMBEDDING_*`) değiştirilmemeli. |
| İlk açılışta AI çok yavaş / model indirilemiyor | `intfloat/multilingual-e5-small` Hugging Face'ten iner; internet/proxy engelini kontrol et. Model inene kadar `logs/ai.err.log` doluyor olabilir. |
| `JWT_SECRET is required (>= 32 characters)` | `backend/.env` yer tutucu bırakılmış: `npm run setup` yeniden üretir. |
| Yüklenen PDF "Hazırlanıyor"da kalıyor | `RAG_INTERNAL_API_TOKEN`/`INGEST_CALLBACK_TOKEN`/`STORAGE_ROOT` backend ve ai-service'te aynı olmalı, `INGEST_ENABLED=true` olmalı → `npm run setup` eşitler. |
| Özgün sayfa görüntüsü yok | Poppler (`pdftoppm`) kur (yukarıda); PPTX için ayrıca Docker açık olmalı. |
| Video yükleme / "video servisi" hatası | Harici MomentSearch motoru kurulu ve çalışır değil, ya da FFmpeg PATH'te değil. |
| `Port 5173/3000/8100 in use` | `npm run doctor` portu tutan PID'yi gösterir. Önce `npm run stop:all`; başka program tutuyorsa onu kapat (Windows: `taskkill /PID <numara> /F`). |
| Docker yeniden başladıktan sonra `pool timeout` / veritabanına bağlanılamıyor | `knot_mysql` konteyneri kendiliğinden açılmaz. `npm run start:all` açar; elle: `docker start knot_mysql`, sağlıklı olana kadar bekleyin. |
| `npm ci` "lock file" uyarısı / eski Node | Node >= 20.19 kullan (`node -v`); `nvm use` (`.nvmrc`). |
| PowerShell betiği engellendi | `npm run dev:all` zaten `-ExecutionPolicy Bypass` kullanır; `setup.bat`/`npm run setup` PowerShell gerektirmez. |

## Dal stratejisi

- `main`: kararlı sürüm. Yalnızca `dev`'den, pull request ile güncellenir; sürümler `vX.Y.Z` etiketiyle işaretlenir. `git clone` sonrası ek bir `checkout` gerekmez.
- `dev`: entegrasyon dalı. Çalışan en güncel kod buradadır.
- `feature/*`, `fix/*`, `chore/*`: tek bir konu için `dev`'den açılır, pull request ile `dev`'e döner.
- Bir dalın birleşmesi için frontend, backend (unit + API) ve Python testleri geçmeli; commit mesajları yapılan işi anlatır.
- Birleşmiş veya terk edilmiş dalların silinmesi ayrı bir kararla yapılır; önce liste çıkarılır.

## Çalıştırma

### Video geliştirme dalı

Güncel ürün deneyimi: **Ana Sayfa → Ders oluştur → ortak çalışma alanı →
Alıştırmalar → Öğrenme Analizi → ilgili kaynağa dön**. Video, PDF, sunum ve
metin aynı çalışma ekranındadır; özgün PDF/PPTX görüntüsü ve kalıcı sohbet
eklendi. [Yerel kullanım](docs/development/PRODUCT_LOCAL_SETUP.md),
[gerçek testler ve sınırlar](docs/development/PRODUCT_TEST_REPORT.md).
Model cevabı deneysel, kaynak görüntüsü ise özgün dosyadan render edilir.

`feature/video-integration` dalında ders içinden **Ders videoları** ekranı eklendi.
Yerel video profili `scripts/Start-KnotVideo.ps1` ile açılır:
http://127.0.0.1:5174/#/dersler. Bu profil backend için 3100, AI için 8110 kullanır;
OpenTutor ve DocsGPT portlarıyla çakışmaz. Videolar ilk sürümde yükleyene özeldir.
Kurulum/sınırlar: [Video entegrasyonu](docs/video-integration.md).
Kalıcı izleme aralıkları, atlamayı izlenmiş saymayan ilerleme çizgisi ve kaldığı
yere dönme eklendi. [Güncel geliştirme kaydı](docs/development/IMPLEMENTATION_STATUS.md)
tamamlanan işleri, test kanıtlarını ve henüz uygulanmamış hoca beklentilerini ayırır.
Sonraki işler: [5 kişilik görev dağılımı](docs/video-team-tasks.md).

### Windows PowerShell betiği (alternatif)

Docker Desktop açıkken:

```powershell
npm run dev:all      # MySQL + backend + AI servisi + ön yüz; ilk seferde kurulumu da yapar
npm run dev:status   # servis durumu
npm run dev:stop     # hepsini durdur
```

Betik (`scripts/dev.ps1`) tekrar çalıştırılabilir: `.env` dosyalarını eşitler (veritabanı adresi `.env.docker`'dan türetilir, backend ile ai-service aynı tokenları ve `data/storage` yolunu kullanır), eksik bağımlılıkları kurar, migrasyon ve seed'i uygular, servisleri arka planda başlatır (günlükler `logs/`). Giriş: http://localhost:5173. İlk seed'de üretilen şifreler repo dışında bir geçici dosyaya yazılır (yolu ekrana basılır).

Aşağıdaki elle adımlar yalnızca betiği kullanmak istemezsen gerekir.

Ön yüz yalnızca NestJS API'siyle konuşur (`/api` → `backend/`); Python ai-service'e ya da ChromaDB'ye tarayıcıdan erişilmez ve ön yüzde hiçbir iç servis anahtarı yoktur.

```bash
npm ci
cp .env.example .env   # VITE_API_BASE_URL=/api, VITE_API_PROXY_TARGET=http://localhost:3000
npm run dev            # http://localhost:5173 — /api istekleri backend'e aktarılır
npm run build && npx vite preview   # aynı proxy preview'da da geçerli
```

Backend ve ai-service kurulumu için `backend/README.md` ve `ai-service/README.md`. Gizli bilgiler, yerel veritabanı (Docker) ve commit öncesi tarama için **`docs/security.md`** (bu depo herkese açık: `.env`, parola, yüklenen belge ve üçüncü taraf materyal asla commit edilmez). Hesaplar yönetici tarafından tohumlanır (kayıt yok); oturum 1 saatlik JWT'dir, süresi dolunca giriş ekranına dönülür.

### Testler

```bash
npm test           # Vitest + Testing Library: API istemcisi, giriş/oturum, yükleme/durum/silme, yanıt durumları, kaynak vurgusu (sahte fetch)
npm run test:e2e   # gerçek uçtan uca: Chromium → vite preview → NestJS → MySQL + Python ai-service (sahte yok)
```

`test:e2e` boş, ayrı bir MySQL veritabanı ister (`E2E_DATABASE_URL`; varsayılan `mysql://knot:knot-dev-password@localhost:3306/knot_e2e`), önceden `npm run build` ve `backend/` içinde `npm run build` gerekir. Veritabanını sıfırlamaz; içinde belge varsa çalışmayı reddeder. Gömme için model indirmeyen `hashing` arka ucunu, yanıt için çıkarımsal temel sağlayıcıyı (LLM değil) kullanır. Chromium yolu: `CHROMIUM_PATH` (varsayılan `/opt/pw-browsers/chromium`).

## Sayfalar (hash tabanlı rota)

| Rota | Sayfa | Veri |
| --- | --- | --- |
| `#/dersler` | Dersler: kayıtlı olunan dersler ve hazırlık durumu | **Gerçek** (`GET /courses`) |
| `#/dersler/:id` | Ders: PDF yükleme, durum izleme (Yüklendi → Okunuyor → Hazırlanıyor → Hazır / Sorun var), yeniden deneme, indirme, silme | **Gerçek** |
| `#/dersler/:id/calisma` | Çalışma alanı: iddia satırları, sunucunun destek etiketi (SIKI / GEVEŞEK / KOPUK), gerçek sayfa metninde birebir alıntı vurgusu | **Gerçek** (`POST /courses/:id/answers`, `GET /documents/:id/pages/:n`) |
| `#/` | Ana Sayfa | Örnek veri (backend yok) |
| `#/quiz` | Pratik | Örnek veri (WBS-6) |
| `#/analitik` | Analitik | Örnek veri (WBS-7) |

Örnek veri kullanan ekranlar “Örnek veri” etiketiyle işaretlidir (`src/data`, `src/app/store.jsx`). Eski mock ders bağlantıları (`#/dersler/veri-yapilari…`) ders listesine yönlendirilir.

## Öğrenme döngüsü

```
Sor → Kanıtı gör → Pratik yap → Cevapla → Geri bildirim → Eksiği gör → Kaynağa dön → Tekrar dene
```

Döngü ayrı bir diyagram olarak değil, eylemlerle kurulur: yanıttaki **Bunu test et** pratiğe geçirir; değerlendirmedeki kanıt etiketi tam kaynak cümlesini açar (**Kaynağa dön**); **Benzer soru çöz** aynı konuda devam ettirir; **Konuyu tekrar açıkla** çalışma alanına döndürür.

## Kapsam

Faz 1: ders materyali indeksleme, kaynağa dayalı soru-cevap, otomatik soru üretimi, cevap değerlendirme ve kanıt ölçümü. Bu dalda ayrı ve deneysel video/transkript akışı eklenmiştir; öğretmen paneli, sosyal özellikler ve oyunlaştırma kapsam dışıdır.

## Tasarım dili

- **Tipografi:** başlıklarda Newsreader (`.display`), arayüzde Geist, rozet/dosya adı/sayfa numarasında JetBrains Mono.
- **Renk:** tek vurgu (kobalt). Yeşil / amber / kırmızı yalnızca kanıt durumlarını (SIKI / GEVEŞEK / KOPUK) anlatır.
- **Hiyerarşi:** kutu ve çizgi yerine boşluk, tipografi ve tek bir aktif yüzey.
- **Hareket:** 150–400 ms, güçlü ease-out; `prefers-reduced-motion` açıkken iplik çizilmez, hareket kalkar.
- İplik/düğüm metaforu kalıcı süs değildir: iddia→kaynak bağlantısı yalnızca etkinleştirme anında çizilir.

## Yapay zekâ servisi (WBS-3 · RAG)

Kaynağa dayalı yanıt motoru `ai-service/` altında ayrı bir Python (FastAPI) servisidir; yalnızca NestJS arka ucu tarafından çağrılır. Kurulum ve testler için [`ai-service/README.md`](ai-service/README.md), sözleşmeler için `docs/rag-architecture.md`, `docs/rag-api-contract.md`, `docs/rag-integration.md` ve `docs/rag-evaluation.md` dosyalarına bakın.
