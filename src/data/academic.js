// Akademik mock veri: dersler, materyaller, konu ipi (Bilgi İpi) ve quiz bankası.
// Teknik indeksleme terimleri arayüze çıkmaz; yalnızca insan dilinde durumlar kullanılır.

export const STUDENT = { name: 'Azra' }

export const MATERIAL_STATES = {
  uploaded: { label: 'Yüklendi', hint: 'Sıraya alındı' },
  reading: { label: 'Okunuyor', hint: 'Sayfalar okunuyor' },
  preparing: { label: 'Hazırlanıyor', hint: 'Sorulara hazırlanıyor' },
  ready: { label: 'Hazır', hint: 'Yanıtlarda kullanılabilir' },
  error: { label: 'Sorun var', hint: 'Dosya okunamadı' },
}
export const STATE_ORDER = ['uploaded', 'reading', 'preparing', 'ready']

export const TYPE_LABEL = { slayt: 'Slayt', pdf: 'PDF', not: 'Not', sinav: 'Çıkmış soru' }

const m = (name, type, pages, added, status = 'ready', extra = {}) => ({ id: name, name, type, pages, added, status, ...extra })

export const COURSES = [
  {
    id: 'veri-yapilari', name: 'Veri Yapıları', code: 'BIL 211', instructor: 'Doç. Dr. M. Aydın', term: 'Güz 2026',
    upcoming: 'Vize · 6 gün sonra', lastStudied: 'Dün 21:40', lastTopic: 'AVL ağaçları', open: true,
  },
  {
    id: 'algoritmalar', name: 'Algoritmalar', code: 'BIL 301', instructor: 'Prof. Dr. S. Kaya', term: 'Güz 2026',
    upcoming: 'Ödev 2 · 9 gün sonra', lastStudied: '3 gün önce', lastTopic: 'Böl ve yönet',
  },
  {
    id: 'veritabani', name: 'Veritabanı Sistemleri', code: 'BIL 321', instructor: 'Dr. Öğr. Üyesi E. Demir', term: 'Güz 2026',
    upcoming: 'Proje teslimi · 3 hafta', lastStudied: 'Geçen hafta', lastTopic: 'Normalizasyon',
  },
  {
    id: 'yazilim', name: 'Yazılım Mühendisliği', code: 'BIL 341', instructor: 'Doç. Dr. T. Arslan', term: 'Güz 2026',
    upcoming: 'Sunum · 2 hafta', lastStudied: '5 gün önce', lastTopic: 'Gereksinim analizi',
  },
]

export const INITIAL_MATERIALS = {
  'veri-yapilari': [
    m('Hafta1_Giris.pdf', 'slayt', 24, '2 Eyl'),
    m('Hafta2_Diziler_ve_Listeler.pdf', 'slayt', 30, '9 Eyl'),
    m('Hafta3_Yigin_ve_Kuyruk.pdf', 'slayt', 26, '16 Eyl'),
    m('Hafta4_AVL_Agaclari.pdf', 'slayt', 32, '23 Eyl', 'ready', { openable: 'slides' }),
    m('Hafta5_Heap_ve_Oncelik.pdf', 'slayt', 28, '30 Eyl'),
    m('Hafta6_Hash_Tablolari.pdf', 'slayt', 34, '1 Eki'),
    m('Hafta7_Graflar.pdf', 'slayt', 40, '3 Eki'),
    m('Hafta8_Siralama.pdf', 'slayt', 36, '5 Eki'),
    m('VY_Ders_Notlari.pdf', 'not', 12, '24 Eyl', 'ready', { openable: 'notes' }),
    m('Lab3_Agac_Uygulamalari.pdf', 'pdf', 8, '25 Eyl'),
    m('Lab4_Dengeli_Agaclar.pdf', 'pdf', 9, '28 Eyl'),
    m('Cormen_Bolum12-13.pdf', 'pdf', 46, '2 Eyl'),
    m('Vize_Cikmis_Sorular_2024.pdf', 'sinav', 6, '30 Eyl'),
    m('Calisma_Sorulari_Agaclar.pdf', 'sinav', 10, '1 Eki'),
  ],
  algoritmalar: [
    m('Hafta1_Analiz.pdf', 'slayt', 28, '3 Eyl'),
    m('Hafta2_Siralama.pdf', 'slayt', 34, '10 Eyl'),
    m('Hafta3_Bol_ve_Yonet.pdf', 'slayt', 30, '17 Eyl'),
    m('Hafta4_Acgozlu.pdf', 'slayt', 26, '24 Eyl'),
    m('Algoritma_Notlari.pdf', 'not', 18, '26 Eyl'),
    m('CLRS_Bolum4.pdf', 'pdf', 38, '5 Eyl'),
    m('Hafta5_Dinamik_Programlama.pdf', 'slayt', 42, '5 Eki', 'reading', { auto: true, demo: true }),
    m('Vize_2023.pdf', 'sinav', 5, '5 Eki', 'preparing', { auto: true, demo: true }),
    m('Hafta6_Graf_Algoritmalari.pdf', 'slayt', 36, '6 Eki', 'uploaded', { auto: true, demo: true }),
  ],
  veritabani: [
    'Hafta1_Iliskisel_Model.pdf', 'Hafta2_SQL_Temelleri.pdf', 'Hafta3_Birlestirme.pdf', 'Hafta4_Normalizasyon.pdf',
    'Hafta5_Islemler.pdf', 'Hafta6_Indeksler.pdf', 'Hafta7_Sorgu_Planlari.pdf',
  ].map((n, i) => m(n, 'slayt', 24 + i * 2, `${2 + i * 7} Eyl`)).concat([
    m('VT_Ders_Notlari.pdf', 'not', 14, '20 Eyl'),
    m('Lab_SQL_Alistirma.pdf', 'pdf', 10, '22 Eyl'),
    m('Vize_2023.pdf', 'sinav', 6, '30 Eyl'),
    m('Proje_Yonergesi.pdf', 'pdf', 4, '1 Eki'),
  ]),
  yazilim: [
    'Hafta1_Surecler.pdf', 'Hafta2_Gereksinimler.pdf', 'Hafta3_UML.pdf', 'Hafta4_Tasarim_Oruntuleri.pdf',
    'Hafta5_Test.pdf', 'Hafta6_Cevik.pdf',
  ].map((n, i) => m(n, 'slayt', 22 + i * 3, `${4 + i * 7} Eyl`)).concat([
    m('Hafta5_Tarama.pdf', 'pdf', 14, '4 Eki', 'error', { issue: 'Taranmış sayfalar okunamadı. Daha net bir kopya yükleyebilirsin.' }),
    m('YM_Notlari.pdf', 'not', 9, '2 Eki'),
  ]),
}

export function readiness(list) {
  const ready = list.filter((x) => x.status === 'ready').length
  const error = list.some((x) => x.status === 'error')
  const total = list.length
  if (error) return { ready, total, tone: 'error', text: 'Bir materyalde sorun var' }
  if (ready === total) return { ready, total, tone: 'ready', text: 'Kaynaklı çalışmaya hazır' }
  return { ready, total, tone: 'busy', text: `${total - ready} materyal hazırlanıyor` }
}

// ─── Bilgi İpi: konular (ders sırasıyla) ───────────────────────────────────────
// score: 0 = henüz çalışılmadı. Tek başına yüzde olarak gösterilmez.
export const TOPICS = [
  { id: 'bst', name: 'İkili arama ağacı', week: 'Hafta 4', score: 0.9, answered: 5, correct: 5, cite: { doc: 'slides', page: 16, seg: 's16-a', label: 'Slayt · s.16' } },
  { id: 'bst-dengesizlik', name: 'Dengesiz ağaç sorunu', week: 'Hafta 4', score: 0.82, answered: 3, correct: 3, cite: { doc: 'slides', page: 17, seg: 's17-b', label: 'Slayt · s.17' } },
  { id: 'avl-denge', name: 'AVL denge koşulu', week: 'Hafta 4', score: 0.8, answered: 4, correct: 3, cite: { doc: 'slides', page: 18, seg: 's18-balance', label: 'Slayt · s.18' } },
  { id: 'denge-faktoru', name: 'Denge faktörü', week: 'Hafta 4', score: 0.62, answered: 3, correct: 2, cite: { doc: 'slides', page: 19, seg: 's19-bf', label: 'Slayt · s.19' } },
  { id: 'rotasyon', name: 'Rotasyon mantığı', week: 'Hafta 4', score: 0.55, answered: 4, correct: 2, cite: { doc: 'slides', page: 20, seg: 's20-b', label: 'Slayt · s.20' } },
  { id: 'lr-rl', name: 'LR / RL çift rotasyon', week: 'Hafta 4', score: 0.28, answered: 4, correct: 1, cite: { doc: 'notes', page: 3, seg: 'n3-lr', label: 'Notlar · s.3' } },
  { id: 'rotasyon-sayisi', name: 'Rotasyon sayısı', week: 'Hafta 4', score: 0.45, answered: 2, correct: 1, cite: { doc: 'notes', page: 3, seg: 'n3-count', label: 'Notlar · s.3' } },
  { id: 'avl-kirmizi-siyah', name: 'AVL ve kırmızı-siyah', week: 'Hafta 4', score: 0.5, answered: 2, correct: 1, cite: { doc: 'notes', page: 1, seg: 'n1-tight', label: 'Notlar · s.1' } },
  { id: 'heap', name: 'Heap ve öncelik kuyruğu', week: 'Hafta 5', score: 0, answered: 0, correct: 0 },
  { id: 'hash', name: 'Hash tabloları', week: 'Hafta 6', score: 0, answered: 0, correct: 0 },
]

export const topicState = (score) => (score <= 0 ? 'open' : score >= 0.72 ? 'tight' : score >= 0.4 ? 'loose' : 'weak')

export const STATE_TEXT = {
  tight: 'Sıkı',
  loose: 'Gevşek',
  weak: 'Zayıf',
  open: 'Henüz bağlanmadı',
}

// Bir kaynak sayfasının kapsaması (Analitik: kaynakla desteklenen ilerleme)
export const COVERAGE = [
  { name: 'Hafta4_AVL_Agaclari.pdf', used: 9, total: 32 },
  { name: 'VY_Ders_Notlari.pdf', used: 5, total: 12 },
  { name: 'Hafta3_Yigin_ve_Kuyruk.pdf', used: 11, total: 26 },
  { name: 'Hafta2_Diziler_ve_Listeler.pdf', used: 14, total: 30 },
  { name: 'Hafta5_Heap_ve_Oncelik.pdf', used: 0, total: 28 },
]

// ─── Quiz bankası ──────────────────────────────────────────────────────────
const c = (doc, page, seg, label) => ({ doc, page, seg, label })

export const QUIZ_BANK = [
  {
    id: 'q1', topic: 'avl-denge', source: 'Hafta 4 slaytları · AVL bölümü',
    stem: 'AVL ağacında bir düğümün sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?',
    options: ['0', '1', '2', '3'], correct: 1,
    explanation: 'Fark 2 ya da daha fazla olduğunda denge bozulur ve rotasyon gerekir; bu yüzden izin verilen en büyük fark 1’dir.',
    cite: c('slides', 18, 's18-balance', 'Slayt · s.18'),
  },
  {
    id: 'q2', topic: 'denge-faktoru', source: 'Hafta 4 slaytları · Denge faktörü',
    stem: 'Bir düğümün denge faktörü nasıl hesaplanır?',
    options: ['Sağ alt ağaç yüksekliği − sol alt ağaç yüksekliği', 'Sol alt ağaç yüksekliği − sağ alt ağaç yüksekliği', 'Alt ağaçlardaki toplam düğüm sayısı', 'Düğümün kökten uzaklığı'], correct: 1,
    explanation: 'İşaret önemlidir: sol taraf ağırsa denge faktörü pozitif, sağ taraf ağırsa negatif çıkar.',
    cite: c('slides', 19, 's19-bf', 'Slayt · s.19'),
  },
  {
    id: 'q3', topic: 'lr-rl', source: 'Ders notların · Rotasyon notları',
    stem: 'Bir düğümün sol çocuğunun sağ alt ağacına ekleme yapıldı ve düğüm dengesiz kaldı. Hangi rotasyon gerekir?',
    options: ['LL', 'RR', 'LR', 'RL'], correct: 2,
    explanation: 'Sol çocuğun sağ alt ağacındaki ekleme LR durumudur. Önce sol çocukta sola, sonra düğümde sağa döndürülür.',
    cite: c('notes', 3, 'n3-lr', 'Notlar · s.3'),
    wrong: { 0: 'LL, ekleme sol çocuğun sol alt ağacında olduğunda oluşur.', 1: 'RR, ekleme sağ çocuğun sağ alt ağacında olduğunda oluşur.', 3: 'RL, ekleme sağ çocuğun sol alt ağacında olduğunda oluşur.' },
  },
  {
    id: 'q4', topic: 'rotasyon', source: 'Hafta 4 slaytları · Rotasyon',
    stem: 'Tek bir rotasyon işleminin zaman maliyeti nedir?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], correct: 0,
    explanation: 'Ağaç ne kadar büyürse büyüsün rotasyon yalnızca birkaç işaretçiyi değiştirir; maliyet sabit kalır.',
    cite: c('slides', 20, 's20-b', 'Slayt · s.20'),
  },
  {
    id: 'q5', topic: 'bst-dengesizlik', source: 'Hafta 4 slaytları · Dengesiz ağaç',
    stem: 'Sıralı veri eklenen dengesiz bir BST’de arama maliyeti ne olur?',
    options: ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], correct: 2,
    explanation: 'Zincire dönüşen ağaçta her arama düğümleri tek tek gezer; bu yüzden maliyet düğüm sayısıyla birlikte büyür.',
    cite: c('slides', 17, 's17-b', 'Slayt · s.17'),
  },
  {
    id: 'q6', topic: 'rotasyon-sayisi', source: 'Ders notların · Rotasyon notları',
    stem: 'AVL ağacında bir ekleme sonrasında dengeyi sağlamak için en fazla bir (tek ya da çift) rotasyon yeterlidir.',
    options: ['Doğru', 'Yanlış'], correct: 0, tf: true,
    explanation: 'Eklemede en fazla bir rotasyon yeter. Silmede ise O(log n) rotasyon gerekebilir.',
    cite: c('notes', 3, 'n3-count', 'Notlar · s.3'),
  },
  {
    id: 'q7', topic: 'avl-kirmizi-siyah', source: 'Ders notların · Genel notlar',
    stem: 'Notlarına göre hangi ağaç daha sıkı dengelidir ve aramada genellikle daha hızlıdır?',
    options: ['Dengesiz BST', 'AVL', 'Kırmızı-siyah ağaç', 'İkisi de aynı'], correct: 1,
    explanation: 'Sıkı denge aramayı hızlandırır; ama her güncellemede daha fazla düzeltme gerektirdiği için güncelleme biraz yavaşlar.',
    cite: c('notes', 1, 'n1-tight', 'Notlar · s.1'),
  },
  {
    id: 'q8', topic: 'lr-rl', source: 'Ders notların · Rotasyon notları',
    stem: 'Aşağıdakilerden hangisi çift rotasyon gerektirir?',
    options: ['LL ve RR', 'LR ve RL', 'Yalnızca LL', 'Hiçbiri'], correct: 1,
    explanation: 'LL ve RR tek rotasyonla çözülür; LR ve RL ise iki adımlı (çift) rotasyon gerektirir.',
    cite: c('notes', 3, 'n3-single', 'Notlar · s.3'),
  },
]

export const QUIZ_SCOPES = [
  { id: 'all', label: 'Tüm Veri Yapıları', hint: 'Yüklü materyallerin tamamından' },
  { id: 'weak', label: 'Zayıf noktalarım', hint: 'Gevşek kalan konulardan' },
  { id: 'week4', label: 'Hafta 4 · AVL ağaçları', hint: 'Slaytlar ve ders notların' },
  { id: 'exam', label: 'Çıkmış sorular', hint: 'Vize 2024 ve çalışma soruları' },
]

export const QUIZ_AMOUNTS = [3, 5, 8]

export const RECENT_ACTIVITY = [
  { when: 'Dün', text: 'Quiz · Ağaçlar', detail: '4 / 5 doğru' },
  { when: 'Dün', text: '3 soru sordun', detail: 'Veri Yapıları' },
  { when: 'Pzt', text: 'Hafta 4 slaytları hazır oldu', detail: 'Veri Yapıları' },
]

export const RECENT_MATERIALS = [
  { name: 'Hafta4_AVL_Agaclari.pdf', course: 'Veri Yapıları', where: 's.18’de kaldın', doc: 'slides', page: 18 },
  { name: 'VY_Ders_Notlari.pdf', course: 'Veri Yapıları', where: 's.3’te kaldın', doc: 'notes', page: 3 },
  { name: 'Hafta3_Bol_ve_Yonet.pdf', course: 'Algoritmalar', where: 's.12’de kaldın' },
]
