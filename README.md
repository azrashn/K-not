# K-not

Üniversite öğrencileri için **kanıt öncelikli** çalışma alanı. Yanıtlar, öğrencinin yüklediği ders materyallerine bağlanır; kanıt yoksa K-not bunu açıkça söyler.

```
CLAIM → KNOT → SOURCE        ASK → PRACTICE → ANSWER → FEEDBACK → REVIEW
```

## Çalıştırma

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Sayfalar (hash tabanlı rota)

| Rota | Sayfa |
| --- | --- |
| `#/` | Ana Sayfa: “Şimdi ne çalışmalıyım?” — tek devam eylemi, tekrar önerisi, son çalışma |
| `#/dersler` | Dersler: hazırlık durumu ve ders bazlı bilgi ipi |
| `#/dersler/:id` | Ders: materyaller (Tümü / Slaytlar / Notlar / Geçmiş Sınavlar), durumlar: Yüklendi → Okunuyor → Hazırlanıyor → Hazır / Sorun var |
| `#/dersler/veri-yapilari/calisma` | AI Çalışma Alanı: iddia satırları, kaynak etiketi, Düğüm Gücü (nedeniyle), kaynak görüntüleyici, İpucu ver / Basitçe açıkla / Bunu test et |
| `#/quiz` | Pratik: Ders → Konu → Materyaller; çoktan seçmeli, doğru/yanlış, açık uçlu; kanıta bağlı cevap değerlendirmesi |
| `#/analitik` | Analitik: **Öğrenmem** (Bilgi İpi) ve **Kaynak güveni** (desteklenen / kısmi / desteksiz yanıtlar) |

Veri tamamen mock'tur (`src/data`). Quiz sonuçları Bilgi İpi'ni ve tekrar listesini, çalışma alanındaki yanıtlar Kaynak güveni sayaçlarını canlı günceller.

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
