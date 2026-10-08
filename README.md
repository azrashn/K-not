# K-not

Üniversite öğrencileri için **kanıt öncelikli** çalışma alanı. Yanıtlar, öğrencinin yüklediği ders materyallerine bağlanır; kanıt yoksa K-not bunu açıkça söyler.

```
CLAIM → KNOT → SOURCE        ASK → PRACTICE → ANSWER → FEEDBACK → REVIEW
```

## Çalıştırma

Ön yüz yalnızca NestJS API'siyle konuşur (`/api` → `backend/`); Python ai-service'e ya da ChromaDB'ye tarayıcıdan erişilmez ve ön yüzde hiçbir iç servis anahtarı yoktur.

```bash
npm install
cp .env.example .env   # VITE_API_BASE_URL=/api, VITE_API_PROXY_TARGET=http://localhost:3000
npm run dev            # http://localhost:5173 — /api istekleri backend'e aktarılır
npm run build && npx vite preview   # aynı proxy preview'da da geçerli
```

Backend ve ai-service kurulumu için `backend/README.md` ve `ai-service/README.md`. Hesaplar yönetici tarafından tohumlanır (kayıt yok); oturum 1 saatlik JWT'dir, süresi dolunca giriş ekranına dönülür.

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

Faz 1: ders materyali indeksleme, kaynağa dayalı soru-cevap, otomatik soru üretimi, cevap değerlendirme ve kanıt ölçümü. Video/transkript, öğretmen paneli, sosyal özellikler ve oyunlaştırma kapsam dışıdır.

## Tasarım dili

- **Tipografi:** başlıklarda Newsreader (`.display`), arayüzde Geist, rozet/dosya adı/sayfa numarasında JetBrains Mono.
- **Renk:** tek vurgu (kobalt). Yeşil / amber / kırmızı yalnızca kanıt durumlarını (SIKI / GEVEŞEK / KOPUK) anlatır.
- **Hiyerarşi:** kutu ve çizgi yerine boşluk, tipografi ve tek bir aktif yüzey.
- **Hareket:** 150–400 ms, güçlü ease-out; `prefers-reduced-motion` açıkken iplik çizilmez, hareket kalkar.
- İplik/düğüm metaforu kalıcı süs değildir: iddia→kaynak bağlantısı yalnızca etkinleştirme anında çizilir.

## Yapay zekâ servisi (WBS-3 · RAG)

Kaynağa dayalı yanıt motoru `ai-service/` altında ayrı bir Python (FastAPI) servisidir; yalnızca NestJS arka ucu tarafından çağrılır. Kurulum ve testler için [`ai-service/README.md`](ai-service/README.md), sözleşmeler için `docs/rag-architecture.md`, `docs/rag-api-contract.md`, `docs/rag-integration.md` ve `docs/rag-evaluation.md` dosyalarına bakın.
