// Mock veri: Veri Yapıları · Hafta 4 · AVL Ağaçları
// Her iddia (claim) bir ya da daha fazla kanıta (cite) bağlanır; kanıt, belge sayfasındaki bir parça (seg) ile eşleşir.

export const COURSE = { name: 'Veri Yapıları', activeCount: 14 }


// ─── Belgeler ───────────────────────────────────────────────────────────────
// block.type: h | p | li | diagram | table
export const DOCS = {
  slides: {
    id: 'slides',
    kind: 'slide',
    short: 'Slaytlar',
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
  knot: { state: 'SIKI', supported: 2, total: 2, line: '2/2 iddia kaynakla destekleniyor' },
  actions: ['test', 'simple', 'gaps'],
  simple: [
    { id: 'sm1', text: 'Ağaç her düğümde iki tarafın yüksekliğini birbirine yakın tutar; fark en fazla 1 olabilir.', cites: [cite('slides', 18, 's18-balance', 'Slayt · s.18')] },
    { id: 'sm2', text: 'Fark 2’ye çıkarsa düğümler döndürülür ve fark yeniden küçülür.', cites: [cite('slides', 18, 's18-rotate', 'Slayt · s.18')] },
  ],
  gaps: [
    { id: 'gp1', text: 'Denge faktörü, sol ve sağ alt ağaç yüksekliği farkıdır; her ekleme ve silmeden sonra güncellenir.', cites: [cite('slides', 19, 's19-bf', 'Slayt · s.19')] },
    { id: 'gp2', text: 'Eklemede en fazla bir rotasyon yeter; silmede O(log n) rotasyon gerekebilir.', cites: [cite('notes', 3, 'n3-count', 'Notlar · s.3')] },
  ],
  practice: {
    prompt: 'Bir düğümün sol çocuğunun sağ alt ağacına ekleme yapıldı ve düğüm dengesiz kaldı. Hangi rotasyon gerekir?',
    options: [
      { id: 'LL', hint: 'LL, ekleme sol çocuğun sol alt ağacında olduğunda oluşur; burada ekleme sağ alt ağaçta.' },
      { id: 'RR', hint: 'RR, ekleme sağ çocuğun sağ alt ağacında olduğunda oluşur.' },
      { id: 'LR', hint: null },
      { id: 'RL', hint: 'RL, ekleme sağ çocuğun sol alt ağacında olduğunda oluşur; burada sol taraf söz konusu.' },
    ],
    correct: 'LR',
    explanation: 'Sol çocuğun sağ alt ağacındaki ekleme LR durumudur. Önce sol çocukta sola, sonra düğümde sağa döndürülür.',
    cite: cite('notes', 3, 'n3-lr', 'Notlar · s.3'),
    review: 'LR / RL çift rotasyon',
    topic: 'lr-rl',
  },
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
  ],
  knot: { state: 'GEVESEK', supported: 1, total: 2, partial: 1, line: '1 iddia tam, 1 iddia kısmen destekleniyor' },
  actions: ['test', 'simple', 'gaps'],
  simple: [
    { id: 'sm1', text: 'AVL daha sıkı dengelidir, bu yüzden aramada genelde öndedir.', cites: [cite('notes', 1, 'n1-tight', 'Notlar · s.1')] },
    { id: 'sm2', text: 'Kırmızı-siyah ağaç dengeyi daha gevşek tutar; güncellemeler biraz daha hızlıdır.', cites: [cite('notes', 4, 'n4-rb', 'Notlar · s.4')] },
  ],
  gaps: [
    { id: 'gp1', text: 'AVL’de güncelleme, daha sıkı denge nedeniyle biraz daha yavaştır.', cites: [cite('notes', 1, 'n1-tight', 'Notlar · s.1')] },
    { id: 'gp2', text: 'Kırmızı-siyah ağaçta rotasyon sayısına dair üst sınır.', missing: true },
  ],
  practice: {
    prompt: 'Notlarına göre hangi ağaç daha sıkı dengelidir ve aramada genellikle daha hızlıdır?',
    options: [
      { id: 'BST', hint: 'Dengesiz BST’de en kötü durum O(n)’dir; sıkı dengeli değildir.' },
      { id: 'AVL', hint: null },
      { id: 'Kırmızı-siyah', hint: 'Kırmızı-siyah ağaç daha gevşek dengelidir; güncellemede avantajlıdır.' },
    ],
    correct: 'AVL',
    explanation: 'AVL, kırmızı-siyah ağaca göre daha sıkı dengelidir; bu da aramayı hızlandırır, güncellemeyi biraz yavaşlatır.',
    cite: cite('notes', 1, 'n1-tight', 'Notlar · s.1'),
    review: 'AVL ve kırmızı-siyah ağaç farkı',
    topic: 'avl-kirmizi-siyah',
  },
}

export const SCENARIOS = { avl: AVL, rb: RB }

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
    knot: { state: 'KOPUK', supported: 0, total: 1, line: 'Materyallerinde yeterli kanıt yok. Tahmin yürütülmedi.' },
    actions: ['nearby'],
    nearest: { doc: 'slides', page: 16, label: 'Slayt · s.16' },
  }
}

export function answerFor(question, count = 14) {
  const q = norm(question)
  if (/(kirmizi|red.?black|rb\b)/.test(q) || (q.includes('fark') && q.includes('avl'))) return RB
  if (/(avl|denge|rotasyon)/.test(q) && !/splay|amortize/.test(q)) return AVL
  return makeGap(question, count)
}
