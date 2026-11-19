# DESIGN SYSTEM — "Çalışma masası" (palet A1)

Web arayüzünün tek tasarım kaynağı. Renkler `src/index.css` (@theme) ve `src/product.css` (:root / :root[data-theme='dark']) içindeki token'larda tanımlıdır. Koda sabit hex yazma, token kullan.

## Tema
- Konsept: not defteri, yapışkan notlar, işaretleyici, kütüphane katalog damgaları, metro hattı konu haritası.
- Açık mod: krem kâğıt (`--color-paper`). Koyu mod: "gece masası", yumuşak koyu; saf siyah kullanma.
- Tek vurgu rengi: eflatun `--color-accent` (#6d4aa8, koyu modda #8b70cc). Ana eylem düğmeleri, bağlantılar, odak halkası ve seçili öğeler bunu kullanır.
- Sayfa ve kaynak renkleri pastel: mercan, eflatun, pembe, şeftali, nane. PDF kartlarında mavi ve sarı kullanma.

## Tipografi
- Arayüz: Geist/Inter. Başlıklar ve büyük sayılar: Newsreader (serif). El yazısı notlar ve ders adları: Caveat. Damga ve üst etiketler: Courier Prime. Kod ve rozetler: JetBrains Mono.
- Başlıklarda letter-spacing -0.03em.

## Bileşenler
- Kartlar net 1px kenarlıklı, ince hover (en fazla 2 px yükselme) ve belirgin hiyerarşili olmalı.
- Damgalar (`.catalog-stamp`) yalnızca cevabın gerçek durumunu söyler: kaynakta bulundu, doğrulanmadı, kaynakta yok.
- Alıntı bloğu yalnızca kaynaktan gelen metinde kullanılır. Modelin kendi açıklaması düz yazıdır.

## Hareket
- Yalnızca `transform` ve `opacity`, en fazla 300 ms. `prefers-reduced-motion` açıkken tüm animasyonlar kapanır.

## Dürüst kanıt ilkesi
- Arayüz öğrenme düzeyi, başarı olasılığı ya da puan tahmin etmez. Hafta şeridi, metro haritası, damgalar ve sınav pulu yalnızca kaydedilmiş veriyi ya da öğrencinin girdiği değeri gösterir.

## Yasaklar
- Metin üzerinde gradient maskeleme, yapay parlama ve sürekli hareket eden süs. Aşırı yuvarlak hap butonlar.
