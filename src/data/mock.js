// Mock veri: Veri Yapıları · Hafta 4 · AVL Ağaçları
// Her iddia (claim) bir ya da daha fazla kanıta (cite) bağlanır; kanıt, belge sayfasındaki bir parça (seg) ile eşleşir.

export const COURSE = { name: 'Veri Yapıları', activeCount: 14 }


// ─── Belgeler ───────────────────────────────────────────────────────────────
// block.type: h | p | li | diagram | table
export const DOCS = {
  slides: {
    id: 'slides',
    kind: 'slide',
    short: 'Hafta 4',
    filename: 'Hafta4_AVL_Agaclari.pdf',
    label: 'Ders Slaytları · Hafta 4',
    total: 32,
    range: [16, 20],
    pages: {
      16: {
        title: 'İkili Arama Ağacı (BST)',
        blocks: [
          { id: 's16-a', type: 'li', text: 'Her düğümün solundaki değerler küçük, sağındakiler büyüktür.' },
          { id: 's16-b', type: 'li', text: 'Arama, ekleme ve silme ortalama O(log n) sürer.' },
          { id: 's16-c', type: 'li', text: 'Ağaç dengesizleşirse en kötü durum O(n) olur.' },
        ],
      },
      17: {
        title: 'Dengesiz Ağaç Sorunu',
        blocks: [
          { id: 's17-a', type: 'li', text: 'Sıralı veri eklenirse BST tek yöne uzar ve bağlı listeye dönüşür.' },
          { id: 's17-b', type: 'li', text: 'Arama maliyeti O(n)’e çıkar.' },
          { id: 's17-c', type: 'li', text: 'Çözüm: yüksekliği kontrol altında tutan, kendini dengeleyen ağaçlar.' },
          { id: 's17-d', type: 'diagram', name: 'chain' },
        ],
      },
      18: {
        title: 'AVL Ağaçları: Denge Koşulu',
        blocks: [
          { id: 's18-balance', type: 'p', text: 'AVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.' },
          { id: 's18-rotate', type: 'li', text: 'Denge koşulu bozulduğunda (fark ≥ 2) ağaç rotasyon işlemleriyle yeniden dengelenir.' },
          { id: 's18-cost', type: 'li', text: 'Rotasyon yükseklik farkını telafi eder; arama O(log n) kalır.' },
          { id: 's18-d', type: 'diagram', name: 'avl' },
        ],
      },
      19: {
        title: 'Denge Faktörü',
        blocks: [
          { id: 's19-bf', type: 'p', text: 'Denge faktörü = sol alt ağaç yüksekliği − sağ alt ağaç yüksekliği.' },
          { id: 's19-b', type: 'li', text: 'bf ∈ {−1, 0, 1} ise düğüm dengelidir.' },
          { id: 's19-c', type: 'li', text: 'Her ekleme/silmeden sonra yoldaki düğümlerin bf değeri güncellenir.' },
        ],
      },
      20: {
        title: 'Rotasyon: Genel Fikir',
        blocks: [
          { id: 's20-a', type: 'li', text: 'Dengesiz düğüm, sıralama bozulmadan yeni bir kök etrafında döndürülür.' },
          { id: 's20-b', type: 'li', text: 'Rotasyon O(1) sürer; yalnızca birkaç işaretçi değişir.' },
        ],
      },
    },
  },
  notes: {
    id: 'notes',
    kind: 'notes',
    short: 'Notlar',
    filename: 'VY_Ders_Notlari.pdf',
    label: 'Kişisel Ders Notları',
    total: 12,
    range: [1, 5],
    pages: {
      1: {
        title: 'Hafta 4 — Genel Notlar',
        blocks: [
          { id: 'n1-a', type: 'p', text: 'AVL ağaçları 1962’de Adelson-Velsky ve Landis tarafından önerildi.' },
          { id: 'n1-b', type: 'p', text: 'Öz-dengeleme sayesinde arama, ekleme ve silme O(log n) sürer.' },
          { id: 'n1-tight', type: 'p', text: 'Pratikte kırmızı-siyah ağaçlara göre daha sıkı dengeli; arama daha hızlı, güncelleme biraz yavaş.' },
        ],
      },
      2: {
        title: 'Rotasyonların Özeti',
        blocks: [
          { id: 'n2-a', type: 'li', text: 'Tek rotasyon: LL, RR.' },
          { id: 'n2-b', type: 'li', text: 'Çift rotasyon: LR, RL (iki adımlı düzeltme).' },
          { id: 'n2-c', type: 'p', text: 'Sınavda en sık sorulan: hangi durumda hangi rotasyon uygulanır?' },
        ],
      },
      3: {
        title: 'AVL — Rotasyon Notları',
        blocks: [
          { id: 'n3-four', type: 'p', text: 'Dört temel rotasyon vardır: LL, RR, LR ve RL.' },
          { id: 'n3-single', type: 'li', text: 'LL ve RR tek rotasyon; LR ve RL çift rotasyon gerektirir.' },
          { id: 'n3-lr', type: 'li', text: 'LR: düğümün sol çocuğunun sağ alt ağacına ekleme yapıldığında oluşur. Önce sol çocukta sola, sonra düğümde sağa döndürülür.' },
          { id: 'n3-count', type: 'li', text: 'Eklemede en fazla bir (tek ya da çift) rotasyon yeter; silmede O(log n) rotasyon gerekebilir.' },
          { id: 'n3-d', type: 'diagram', name: 'lr' },
        ],
      },
      4: {
        title: 'Karmaşıklık Karşılaştırması',
        blocks: [
          {
            id: 'n4-table',
            type: 'table',
            head: ['Ağaç', 'Arama', 'Ekleme'],
            rows: [
              ['BST (dengesiz)', 'O(n)', 'O(n)'],
              ['AVL', 'O(log n)', 'O(log n)'],
              ['Kırmızı-siyah', 'O(log n)', 'O(log n)'],
            ],
          },
          { id: 'n4-rb', type: 'p', text: 'Kırmızı-siyah ağaçta denge daha gevşek; ekleme ve silme biraz daha hızlı.' },
        ],
      },
      5: {
        title: 'Örnek: 30, 20, 25 Ekleme',
        blocks: [
          { id: 'n5-a', type: 'p', text: 'Ekleme sırası 30, 20, 25: 30 düğümünün dengesi bozulur (bf = 2).' },
          { id: 'n5-b', type: 'p', text: 'Sol çocuğun (20) sağ alt ağacına ekleme yapıldı → LR durumu.' },
        ],
      },
    },
  },
  hash: {
    id: 'hash',
    kind: 'slide',
    short: 'Hafta 6',
    filename: 'Hafta6_Hash_Tablolari.pdf',
    label: 'Ders Slaytları · Hafta 6',
    total: 34,
    range: [11, 13],
    pages: {
      11: {
        title: 'Hash Fonksiyonu',
        blocks: [
          { id: 'h11-a', type: 'p', text: 'Hash fonksiyonu, bir anahtarı tablo indeksine dönüştürür: h(k) = k mod m.' },
          { id: 'h11-b', type: 'li', text: 'İyi bir hash fonksiyonu anahtarları tabloya düzgün dağıtır.' },
          { id: 'h11-c', type: 'li', text: 'Ortalama arama, ekleme ve silme maliyeti O(1)’dir.' },
        ],
      },
      12: {
        title: 'Çakışma ve Zincirleme',
        blocks: [
          { id: 'h12-a', type: 'p', text: 'İki farklı anahtar aynı indekse düştüğünde çakışma oluşur.' },
          { id: 'h12-chain', type: 'li', text: 'Zincirleme (chaining): aynı indekse düşen anahtarlar bir bağlı listede tutulur.' },
          { id: 'h12-load', type: 'li', text: 'Doluluk oranı arttıkça zincirler uzar ve arama yavaşlar.' },
        ],
      },
      13: {
        title: 'Açık Adresleme',
        blocks: [
          { id: 'h13-a', type: 'p', text: 'Açık adreslemede tüm anahtarlar tablonun kendisinde saklanır; çakışmada boş bir göze bakılır.' },
          { id: 'h13-probe', type: 'li', text: 'Doğrusal yoklama: bir sonraki boş göz aranır; kümelenme oluşabilir.' },
          { id: 'h13-del', type: 'li', text: 'Silinen gözler işaretlenmezse arama zinciri kopar.' },
        ],
      },
    },
  },
}

export const LOOP_STAGES = [
  { id: 'ask', label: 'Sor' },
  { id: 'practice', label: 'Alıştır' },
  { id: 'answer', label: 'Cevapla' },
  { id: 'feedback', label: 'Geri bildirim' },
  { id: 'review', label: 'Tekrar' },
]

const cite = (doc, page, seg, label, strength = 'full', note) => ({ doc, page, seg, label, strength, note })

// ─── Senaryolar ─────────────────────────────────────────────────────────────
const AVL = {
  id: 'avl',
  question: 'AVL ağaçlarında denge nasıl sağlanır?',
  claims: [
    {
      id: 'c1',
      text: 'AVL ağacında denge bozulduğunda rotasyon uygulanır.',
      cites: [cite('slides', 18, 's18-rotate', 'Slayt · s.18')],
    },
    {
      id: 'c2',
      text: 'Dört temel rotasyon vardır: LL, RR, LR ve RL.',
      cites: [cite('notes', 3, 'n3-four', 'Notlar · s.3')],
    },
  ],
  actions: ['hint', 'simple', 'test', 'gaps'],
  topic: 'avl-denge',
  quiz: { topic: 'avl-denge' },
  hints: [
    { text: 'Önce şunu düşün: bir düğümün iki tarafı arasındaki yükseklik farkı hangi noktadan sonra sorun olur?' },
    { text: 'Fark bu sınırı aşınca ağacın şeklini değiştirmen gerekir. Düğümlerin yerini değiştirerek farkı telafi eden işleme ne denir?' },
    { text: 'Slaytta bu, “denge koşulu” başlığının altında anlatılıyor.', cite: { doc: 'slides', page: 18, seg: 's18-rotate', label: 'Slayt · s.18' } },
  ],
  simple: [
    { id: 'sm1', text: 'Ağaç her düğümde iki tarafın yüksekliğini birbirine yakın tutar; fark en fazla 1 olabilir.', cites: [cite('slides', 18, 's18-balance', 'Slayt · s.18')] },
    { id: 'sm2', text: 'Fark 2’ye çıkarsa düğümler döndürülür ve fark yeniden küçülür.', cites: [cite('slides', 18, 's18-rotate', 'Slayt · s.18')] },
  ],
  gaps: [
    { id: 'gp1', text: 'Denge faktörü, sol ve sağ alt ağaç yüksekliği farkıdır; her ekleme ve silmeden sonra güncellenir.', cites: [cite('slides', 19, 's19-bf', 'Slayt · s.19')] },
    { id: 'gp2', text: 'Eklemede en fazla bir rotasyon yeter; silmede O(log n) rotasyon gerekebilir.', cites: [cite('notes', 3, 'n3-count', 'Notlar · s.3')] },
  ],
}

const RB = {
  id: 'rb',
  question: 'AVL ağacı ile kırmızı-siyah ağaç arasındaki fark nedir?',
  claims: [
    {
      id: 'c1',
      text: 'AVL ağacı daha sıkı dengelidir; bu yüzden arama genellikle daha hızlıdır.',
      cites: [cite('notes', 1, 'n1-tight', 'Notlar · s.1')],
    },
    {
      id: 'c2',
      text: 'Kırmızı-siyah ağaçlarda ekleme ve silme daha az rotasyon gerektirir.',
      cites: [
        cite(
          'notes', 4, 'n4-rb', 'Notlar · s.4', 'partial',
          'Notlar güncellemenin biraz daha hızlı olduğunu söylüyor, ancak rotasyon sayısından söz etmiyor. İddia yalnızca kısmen destekleniyor.',
        ),
      ],
    },
    {
      id: 'c3',
      gap: true,
      unsupported: true,
      text: 'Kırmızı-siyah ağaçlarda yükseklik en fazla 2·log(n+1) olabilir.',
      detail: 'Materyallerinde bu ifadeyi destekleyen bir bölüm bulamadım. Bilgi doğru olabilir; ama kaynağı olmadığı için doğrulayamıyorum.',
      cites: [],
    },
  ],
  actions: ['hint', 'simple', 'test', 'gaps'],
  topic: 'avl-kirmizi-siyah',
  quiz: { topic: 'avl-kirmizi-siyah' },
  hints: [
    { text: 'İkisi de aramayı O(log n)’de tutar. Fark, dengeyi ne kadar sıkı korumalarında. Sıkı denge neyi hızlandırır, neyi yavaşlatır?' },
    { text: 'Güncellemede hangi ağacın daha az düzeltme yaptığını düşün. Notlarındaki karşılaştırma tablosuna bak.', cite: { doc: 'notes', page: 4, seg: 'n4-rb', label: 'Notlar · s.4' } },
  ],
  simple: [
    { id: 'sm1', text: 'AVL daha sıkı dengelidir, bu yüzden aramada genelde öndedir.', cites: [cite('notes', 1, 'n1-tight', 'Notlar · s.1')] },
    { id: 'sm2', text: 'Kırmızı-siyah ağaç dengeyi daha gevşek tutar; güncellemeler biraz daha hızlıdır.', cites: [cite('notes', 4, 'n4-rb', 'Notlar · s.4')] },
  ],
  gaps: [
    { id: 'gp1', text: 'AVL’de güncelleme, daha sıkı denge nedeniyle biraz daha yavaştır.', cites: [cite('notes', 1, 'n1-tight', 'Notlar · s.1')] },
    { id: 'gp2', text: 'Kırmızı-siyah ağaçta rotasyon sayısına dair üst sınır.', missing: true },
  ],
}

const HASH = {
  id: 'hash',
  question: 'Hash tablosunda çakışma nasıl çözülür?',
  claims: [
    {
      id: 'c1',
      text: 'Çakışma, iki farklı anahtar aynı indekse düştüğünde oluşur.',
      cites: [cite('hash', 12, 'h12-a', 'Hafta 6 · s.12')],
    },
    {
      id: 'c2',
      text: 'Zincirlemede aynı indekse düşen anahtarlar bir bağlı listede tutulur.',
      cites: [cite('hash', 12, 'h12-chain', 'Hafta 6 · s.12')],
    },
    {
      id: 'c3',
      text: 'Açık adreslemede çakışma olursa bir sonraki boş göze bakılır.',
      cites: [cite('hash', 13, 'h13-a', 'Hafta 6 · s.13')],
    },
  ],
  actions: ['hint', 'simple', 'test', 'gaps'],
  topic: 'hash-cakisma',
  quiz: { topic: 'hash-cakisma' },
  hints: [
    { text: 'Önce şunu sor: iki farklı anahtar aynı indeksi üretirse tabloda ne olur?' },
    { text: 'İki yol var: anahtarı aynı gözde tutmak ya da tabloda başka bir göz aramak. Hangisi hangi yöntem?', cite: { doc: 'hash', page: 12, seg: 'h12-chain', label: 'Hafta 6 · s.12' } },
  ],
  simple: [
    { id: 'sm1', text: 'Aynı göze düşen anahtarlar zincirlemede bir listeye dizilir.', cites: [cite('hash', 12, 'h12-chain', 'Hafta 6 · s.12')] },
    { id: 'sm2', text: 'Açık adreslemede anahtar, boş bir göz bulunana kadar tabloda ilerler.', cites: [cite('hash', 13, 'h13-probe', 'Hafta 6 · s.13')] },
  ],
  gaps: [
    { id: 'gp1', text: 'Doluluk oranı arttıkça zincirler uzar ve arama yavaşlar.', cites: [cite('hash', 12, 'h12-load', 'Hafta 6 · s.12')] },
    { id: 'gp2', text: 'Silinen gözler işaretlenmezse arama zinciri kopar.', cites: [cite('hash', 13, 'h13-del', 'Hafta 6 · s.13')] },
  ],
}

export const SCENARIOS = { avl: AVL, rb: RB, hash: HASH }

export const SUGGESTIONS = [
  'AVL ile kırmızı-siyah ağaç arasındaki fark nedir?',
  'Splay ağaçlarında amortize analiz nasıl yapılır?',
]

const norm = (s) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i')

// Kanıt yoksa uydurma: KOPUK senaryosu.
function makeGap(question, count = 14) {
  return {
    id: 'gap',
    question,
    claims: [
      {
        id: 'g1',
        gap: true,
        text: 'Yüklediğin materyallerde bu soruyu yanıtlamaya yetecek bilgi yok.',
        detail: `${count} materyalde arama yaptım ve bu soruyu yanıtlayan bir bölüm bulamadım. Tahmin yürütmek yerine durdum.`,
        cites: [],
      },
    ],
      actions: ['nearby'],
    topic: null,
    nearest: { doc: 'slides', page: 16, label: 'Slayt · s.16' },
  }
}

export function answerFor(question, count = 14) {
  const q = norm(question)
  if (/(hash|cakisma|çakışma|zincirleme)/.test(q)) return HASH
  if (/(kirmizi|red.?black|rb\b)/.test(q) || (q.includes('fark') && q.includes('avl'))) return RB
  if (/(avl|denge|rotasyon)/.test(q) && !/splay|amortize/.test(q)) return AVL
  return makeGap(question, count)
}
