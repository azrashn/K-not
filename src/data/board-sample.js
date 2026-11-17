// Tahta deneme sayfası için örnek cevap: "y(0) neden 1 oluyor?" (4 adım).
// quote alanları yer tutucudur; gerçek kullanımda transkriptten birebir alınır.

export const BOARD_SAMPLE = {
  question: 'y(0) neden 1 oluyor, açıklar mısın?',
  language: 'tr',
  summary: 'y(n) genel denkleminde n=0 konulduğunda n < 0 için x(n)=0 kuralıyla negatif terimler sıfırlanır; geriye kalan y(0) = x(0) ifadesinde x(n) = n + 1 tanımından x(0) = 1 bulunarak y(0) = 1 elde edilir.',
  evidence: [
    { id: 'ornek-1', n: 1, kind: 'VIDEO', title: 'Ayrık zamanlı sinyaller', location: { kind: 'video', start_ms: 290000, end_ms: 304000 } },
    { id: 'ornek-2', n: 2, kind: 'VIDEO', title: 'Ayrık zamanlı sinyaller', location: { kind: 'video', start_ms: 421000, end_ms: 434000 } },
    { id: 'ornek-3', n: 3, kind: 'VIDEO', title: 'Ayrık zamanlı sinyaller', location: { kind: 'video', start_ms: 434000, end_ms: 471000 } },
    { id: 'ornek-4', n: 4, kind: 'VIDEO', title: 'Ayrık zamanlı sinyaller', location: { kind: 'video', start_ms: 471000, end_ms: 490000 } },
  ],
  steps: [
    {
      board: 'y(n) = x(n) + 2x(n-1) + 4x(n-2) + 8x(n-3)',
      speech: 'Genel y(n) denkleminde n yerine 0 yazdığında y(0) = x(0) + 2x(-1) + 4x(-2) + 8x(-3) ifadesini elde edersin.',
      formula: 'y(0) = x(0) + 2x(-1) + 4x(-2) + 8x(-3)',
      mark: null,
      sources: ['07:01'],
      source_ids: [2],
      quote: '<videonun 07:01 civarındaki gerçek cümlesi>',
    },
    {
      board: 'x(n) = 0 , n < 0 için',
      speech: 'x(n) fonksiyonunun tanımına baktığında, n sıfırdan küçükken değerinin 0 olduğunu görürsün.',
      formula: 'x(n) = 0 \\quad (n < 0)',
      mark: 'underline',
      sources: ['04:50'],
      source_ids: [1],
      quote: '<videonun 04:50 civarındaki gerçek cümlesi>',
    },
    {
      board: 'x(-1) = 0, x(-2) = 0, x(-3) = 0\ny(0) = x(0)',
      speech: 'n < 0 kuralından dolayı x(-1), x(-2) ve x(-3) terimlerinin hepsi 0 olur. Bu sıfır olan terimler gidince geriye yalnızca y(0) = x(0) kalır.',
      formula: 'y(0) = x(0)',
      mark: null,
      sources: ['07:14', '07:51'],
      source_ids: [3, 4],
      quote: '<videonun 07:14 civarındaki gerçek cümlesi>',
    },
    {
      board: 'x(n) = n + 1 , 0 <= n < 3\nx(0) = 0 + 1 = 1\ny(0) = 1',
      speech: "0 <= n < 3 aralığında x(n) fonksiyonu n + 1 olarak tanımlanmıştır. Burada n yerine 0 koyduğunda x(0) = 0 + 1 = 1 bulunur. Dolayısıyla y(0) da 1'e eşit olur.",
      formula: 'x(0) = 0 + 1 = 1 \\implies y(0) = 1',
      mark: 'circle',
      sources: ['04:50', '07:51'],
      source_ids: [1, 4],
      quote: '<videonun 04:50 civarındaki gerçek cümlesi>',
    },
  ],
}
