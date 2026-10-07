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
| `#/` | Ana Sayfa: kaldığın yerden devam, önerilen tekrar, materyallerine sor |
| `#/dersler` | Dersler: hazırlık durumu ve ders bazlı bilgi ipi |
| `#/dersler/:id` | Ders: materyal yönetimi (Yüklendi → Okunuyor → Hazırlanıyor → Hazır / Sorun var) |
| `#/dersler/veri-yapilari/calisma` | AI Çalışma Alanı: iddia satırları, kaynak etiketi, Düğüm Gücü, kaynak görüntüleyici |
| `#/quiz` | Quiz: kapsam seç, cevapla, geri bildirim + kaynak sayfası, tekrar |
| `#/analitik` | Analitik: Bilgi İpi, zayıf konular, kaynak kapsamı |

Veri tamamen mock'tur (`src/data`). Quiz sonuçları Bilgi İpi'ni ve tekrar listesini canlı günceller.

## Tasarım dili

- **Tipografi:** başlıklarda Newsreader (`.display`), arayüzde Geist, rozet/dosya adı/sayfa numarasında JetBrains Mono.
- **Renk:** tek vurgu (kobalt). Yeşil / amber / kırmızı yalnızca kanıt durumlarını (SIKI / GEVEŞEK / KOPUK) anlatır.
- **Hiyerarşi:** kutu ve çizgi yerine boşluk, tipografi ve tek bir aktif yüzey.
- **Hareket:** 150–400 ms, güçlü ease-out; `prefers-reduced-motion` açıkken iplik çizilmez, hareket kalkar.
- İplik/düğüm metaforu kalıcı süs değildir: iddia→kaynak bağlantısı yalnızca etkinleştirme anında çizilir.
