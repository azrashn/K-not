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

export const TYPE_LABEL = { slayt: 'Slayt', pdf: 'PDF', not: 'Not', sinav: 'Geçmiş sınav' }

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
    m('Hafta6_Hash_Tablolari.pdf', 'slayt', 34, '1 Eki', 'ready', { openable: 'hash' }),
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
// score: 0 = henüz çalışılmadı. Prototip verisi; yüzde olarak gösterilmez.
const t = (id, name, week, score, answered, correct, cite) => ({ id, name, week, score, answered, correct, cite })
const cs = (doc, page, seg, label) => ({ doc, page, seg, label })

export const TOPICS = [
  t('bst', 'İkili arama ağacı', 'Hafta 4', 0.9, 5, 5, cs('slides', 16, 's16-a', 'Slayt · s.16')),
  t('bst-dengesizlik', 'Dengesiz ağaç sorunu', 'Hafta 4', 0.82, 3, 3, cs('slides', 17, 's17-b', 'Slayt · s.17')),
  t('avl-denge', 'AVL denge koşulu', 'Hafta 4', 0.8, 4, 3, cs('slides', 18, 's18-balance', 'Slayt · s.18')),
  t('denge-faktoru', 'Denge faktörü', 'Hafta 4', 0.62, 3, 2, cs('slides', 19, 's19-bf', 'Slayt · s.19')),
  t('rotasyon', 'Rotasyon mantığı', 'Hafta 4', 0.55, 4, 2, cs('slides', 20, 's20-b', 'Slayt · s.20')),
  t('lr-rl', 'LR / RL çift rotasyon', 'Hafta 4', 0.28, 4, 1, cs('notes', 3, 'n3-lr', 'Notlar · s.3')),
  t('rotasyon-sayisi', 'Rotasyon sayısı', 'Hafta 4', 0.45, 2, 1, cs('notes', 3, 'n3-count', 'Notlar · s.3')),
  t('avl-kirmizi-siyah', 'AVL ve kırmızı-siyah', 'Hafta 4', 0.5, 2, 1, cs('notes', 1, 'n1-tight', 'Notlar · s.1')),
  t('heap', 'Heap ve öncelik kuyruğu', 'Hafta 5', 0, 0, 0, null),
  t('hash-fonksiyon', 'Hash fonksiyonu', 'Hafta 6', 0.78, 4, 3, cs('hash', 11, 'h11-a', 'Hafta 6 · s.11')),
  t('hash-cakisma', 'Çakışma ve zincirleme', 'Hafta 6', 0.5, 4, 2, cs('hash', 12, 'h12-chain', 'Hafta 6 · s.12')),
  t('acik-adresleme', 'Açık adresleme', 'Hafta 6', 0.22, 3, 1, cs('hash', 13, 'h13-probe', 'Hafta 6 · s.13')),
]

// Bilgi İpi satırları: her ünite bir ip, her konu bir düğüm.
export const UNITS = [
  { id: 'bst', name: 'İkili Arama Ağacı', topics: ['bst', 'bst-dengesizlik'] },
  { id: 'avl', name: 'AVL Ağaçları', topics: ['avl-denge', 'denge-faktoru', 'rotasyon', 'lr-rl', 'rotasyon-sayisi'] },
  { id: 'karsilastirma', name: 'AVL ve Kırmızı-Siyah', topics: ['avl-kirmizi-siyah'] },
  { id: 'heap', name: 'Heap', topics: ['heap'] },
  { id: 'hash', name: 'Hash Tabloları', topics: ['hash-fonksiyon', 'hash-cakisma', 'acik-adresleme'] },
]

export const topicState = (score) => (score <= 0 ? 'open' : score >= 0.72 ? 'tight' : score >= 0.4 ? 'loose' : 'weak')

export const STATE_TEXT = { tight: 'Sıkı', loose: 'Gevşek', weak: 'Zayıf', open: 'Henüz bağlanmadı' }

// Kaynak kapsamı (prototip verisi): hangi sayfalar yanıt ya da değerlendirmede kanıt olarak kullanıldı
export const COVERAGE = [
  { name: 'Hafta4_AVL_Agaclari.pdf', used: 9, total: 32 },
  { name: 'VY_Ders_Notlari.pdf', used: 5, total: 12 },
  { name: 'Hafta6_Hash_Tablolari.pdf', used: 6, total: 34 },
  { name: 'Hafta3_Yigin_ve_Kuyruk.pdf', used: 11, total: 26 },
  { name: 'Hafta5_Heap_ve_Oncelik.pdf', used: 0, total: 28 },
]

// Kaynak güveni başlangıç değerleri (prototip verisi): son 30 gündeki yanıtlar
export const SUPPORT_SEED = {
  stats: { full: 18, partial: 5, none: 2 },
  unsupported: [
    { question: 'B+ ağaçlarında düğüm bölünmesi nasıl olur?', when: '3 gün önce' },
    { question: 'Skip list arama maliyeti nedir?', when: '1 hafta önce' },
  ],
}

export const INITIAL_REVIEW = [
  { topicId: 'lr-rl', from: 'quiz' },
  { topicId: 'rotasyon-sayisi', from: 'quiz' },
  { topicId: 'acik-adresleme', from: 'quiz' },
]

// ─── Pratik: konu grupları ve soru bankası ─────────────────────────────────────
const f = { slides: 'Hafta4_AVL_Agaclari.pdf', notes: 'VY_Ders_Notlari.pdf', hash: 'Hafta6_Hash_Tablolari.pdf' }
export const DOC_FILE = f

export const QUIZ_GROUPS = [
  { id: 'avl', label: 'AVL Ağaçları', hint: 'Denge, rotasyon ve kırmızı-siyah karşılaştırması', topics: ['avl-denge', 'denge-faktoru', 'rotasyon', 'lr-rl', 'rotasyon-sayisi', 'avl-kirmizi-siyah'], materials: ['Hafta4_AVL_Agaclari.pdf', 'VY_Ders_Notlari.pdf', 'Lab4_Dengeli_Agaclar.pdf'] },
  { id: 'bst', label: 'İkili Arama Ağacı', hint: 'BST ve dengesizlik sorunu', topics: ['bst', 'bst-dengesizlik'], materials: ['Hafta4_AVL_Agaclari.pdf', 'Lab3_Agac_Uygulamalari.pdf'] },
  { id: 'hash', label: 'Hash Tabloları', hint: 'Hash fonksiyonu, çakışma, açık adresleme', topics: ['hash-fonksiyon', 'hash-cakisma', 'acik-adresleme'], materials: ['Hafta6_Hash_Tablolari.pdf'] },
  { id: 'weak', label: 'Zayıf noktalarım', hint: 'Gevşek ya da zayıf kalan konulardan', topics: null, materials: null },
]

export const QUIZ_MODES = [
  { id: 'mc', label: 'Çoktan seçmeli', hint: 'Dört seçenekten kaynağa uygun olanı seç.' },
  { id: 'tf', label: 'Doğru / Yanlış', hint: 'İfadenin kaynakla örtüşüp örtüşmediğine karar ver.' },
  { id: 'open', label: 'Açık uçlu', hint: 'Cevabını kendi cümlelerinle yaz; kaynak noktalarıyla değerlendirilir.' },
]

export const QUIZ_AMOUNTS = [3, 5, 8]

const mc = (id, topic, source, stem, options, correct, explanation, cite, wrong) => ({ id, type: 'mc', topic, source, stem, options, correct, explanation, cite, wrong })
const tf = (id, topic, source, stem, truth, explanation, cite) => ({ id, type: 'tf', topic, source, stem, options: ['Doğru', 'Yanlış'], correct: truth ? 0 : 1, explanation, cite })
const pt = (id, label, kw, w, cite, strong, miss) => ({ id, label, kw, w, cite, strong, miss })
const op = (id, topic, source, stem, points, model) => ({ id, type: 'open', topic, source, stem, points, model, cite: points[0].cite })

export const QUIZ_BANK = [
  mc('q1', 'avl-denge', 'Hafta 4 slaytları · AVL bölümü', 'AVL ağacında bir düğümün sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?', ['0', '1', '2', '3'], 1,
    'Fark 2 ya da daha fazla olduğunda denge bozulur ve rotasyon gerekir; bu yüzden izin verilen en büyük fark 1’dir.', cs('slides', 18, 's18-balance', 'Slayt · s.18')),
  mc('q2', 'denge-faktoru', 'Hafta 4 slaytları · Denge faktörü', 'Bir düğümün denge faktörü nasıl hesaplanır?',
    ['Sağ alt ağaç yüksekliği − sol alt ağaç yüksekliği', 'Sol alt ağaç yüksekliği − sağ alt ağaç yüksekliği', 'Alt ağaçlardaki toplam düğüm sayısı', 'Düğümün kökten uzaklığı'], 1,
    'İşaret önemlidir: sol taraf ağırsa denge faktörü pozitif, sağ taraf ağırsa negatif çıkar.', cs('slides', 19, 's19-bf', 'Slayt · s.19')),
  mc('q3', 'lr-rl', 'Ders notların · Rotasyon notları', 'Bir düğümün sol çocuğunun sağ alt ağacına ekleme yapıldı ve düğüm dengesiz kaldı. Hangi rotasyon gerekir?', ['LL', 'RR', 'LR', 'RL'], 2,
    'Sol çocuğun sağ alt ağacındaki ekleme LR durumudur. Önce sol çocukta sola, sonra düğümde sağa döndürülür.', cs('notes', 3, 'n3-lr', 'Notlar · s.3'),
    { 0: 'LL, ekleme sol çocuğun sol alt ağacında olduğunda oluşur.', 1: 'RR, ekleme sağ çocuğun sağ alt ağacında olduğunda oluşur.', 3: 'RL, ekleme sağ çocuğun sol alt ağacında olduğunda oluşur.' }),
  mc('q4', 'rotasyon', 'Hafta 4 slaytları · Rotasyon', 'Tek bir rotasyon işleminin zaman maliyeti nedir?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 0,
    'Ağaç ne kadar büyürse büyüsün rotasyon yalnızca birkaç işaretçiyi değiştirir; maliyet sabit kalır.', cs('slides', 20, 's20-b', 'Slayt · s.20')),
  mc('q5', 'bst-dengesizlik', 'Hafta 4 slaytları · Dengesiz ağaç', 'Sıralı veri eklenen dengesiz bir BST’de arama maliyeti ne olur?', ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 2,
    'Zincire dönüşen ağaçta her arama düğümleri tek tek gezer; bu yüzden maliyet düğüm sayısıyla birlikte büyür.', cs('slides', 17, 's17-b', 'Slayt · s.17')),
  mc('q7', 'avl-kirmizi-siyah', 'Ders notların · Genel notlar', 'Notlarına göre hangi ağaç daha sıkı dengelidir ve aramada genellikle daha hızlıdır?', ['Dengesiz BST', 'AVL', 'Kırmızı-siyah ağaç', 'İkisi de aynı'], 1,
    'Sıkı denge aramayı hızlandırır; ama her güncellemede daha fazla düzeltme gerektirdiği için güncelleme biraz yavaşlar.', cs('notes', 1, 'n1-tight', 'Notlar · s.1')),
  mc('q8', 'lr-rl', 'Ders notların · Rotasyon notları', 'Aşağıdakilerden hangisi çift rotasyon gerektirir?', ['LL ve RR', 'LR ve RL', 'Yalnızca LL', 'Hiçbiri'], 1,
    'LL ve RR tek rotasyonla çözülür; LR ve RL ise iki adımlı (çift) rotasyon gerektirir.', cs('notes', 3, 'n3-single', 'Notlar · s.3')),
  mc('h1', 'hash-cakisma', 'Hafta 6 slaytları · Çakışma', 'Aynı indekse düşen anahtarları bir bağlı listede tutan çakışma çözümü hangisidir?', ['Doğrusal yoklama', 'Zincirleme', 'İkili arama', 'Yeniden boyutlandırma'], 1,
    'Zincirleme, çakışan anahtarları aynı gözde bir bağlı listede toplar; tablo dolsa bile eklemeye devam edilebilir.', cs('hash', 12, 'h12-chain', 'Hafta 6 · s.12')),
  mc('h2', 'acik-adresleme', 'Hafta 6 slaytları · Açık adresleme', 'Doğrusal yoklamada çakışma olduğunda ne yapılır?', ['Anahtar silinir', 'Bir sonraki boş göz aranır', 'Tablo ikiye bölünür', 'Anahtar bağlı listeye eklenir'], 1,
    'Anahtar kendi gözüne yerleşemezse tablo sırayla taranır; bu yoklama kümelenmeye yol açabilir.', cs('hash', 13, 'h13-probe', 'Hafta 6 · s.13')),

  tf('t1', 'avl-denge', 'Hafta 4 slaytları · AVL bölümü', 'AVL ağacında her düğümün sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla 1’dir.', true,
    'Bu, AVL ağacının tanımıdır. Fark 2’ye çıktığında rotasyonla düzeltilir.', cs('slides', 18, 's18-balance', 'Slayt · s.18')),
  tf('t2', 'lr-rl', 'Ders notların · Rotasyon notları', 'LL ve RR durumları çift rotasyon gerektirir.', false,
    'LL ve RR tek rotasyonla çözülür. Çift rotasyon LR ve RL durumlarına aittir.', cs('notes', 3, 'n3-single', 'Notlar · s.3')),
  tf('t3', 'rotasyon', 'Hafta 4 slaytları · Rotasyon', 'Bir rotasyon işleminin maliyeti ağaç büyüdükçe artar.', false,
    'Rotasyon yalnızca birkaç işaretçiyi değiştirir; ağaç büyüse de maliyet sabit kalır.', cs('slides', 20, 's20-b', 'Slayt · s.20')),
  tf('t4', 'bst-dengesizlik', 'Hafta 4 slaytları · Dengesiz ağaç', 'Sıralı veri eklenirse BST bağlı listeye dönüşebilir.', true,
    'Her yeni değer aynı tarafa eklendiği için ağaç tek yöne uzar ve zincire dönüşür.', cs('slides', 17, 's17-a', 'Slayt · s.17')),
  tf('q6', 'rotasyon-sayisi', 'Ders notların · Rotasyon notları', 'AVL ağacında bir ekleme sonrasında dengeyi sağlamak için en fazla bir (tek ya da çift) rotasyon yeterlidir.', true,
    'Eklemede en fazla bir rotasyon yeter. Silmede ise O(log n) rotasyon gerekebilir.', cs('notes', 3, 'n3-count', 'Notlar · s.3')),
  tf('t5', 'acik-adresleme', 'Hafta 6 slaytları · Açık adresleme', 'Açık adreslemede anahtarlar tablonun dışındaki bağlı listelerde saklanır.', false,
    'Açık adreslemede tüm anahtarlar tablonun kendisinde saklanır. Bağlı liste kullanan yöntem zincirlemedir.', cs('hash', 13, 'h13-a', 'Hafta 6 · s.13')),

  op('o1', 'avl-denge', 'Hafta 4 slaytları · AVL bölümü', 'AVL ağacında denge bozulduğunda ne olur ve denge koşulu nedir? Kendi cümlelerinle açıkla.', [
    pt('p1', 'Denge bozulduğunda rotasyon uygulanır', ['rotasyon', 'döndür'], 4, cs('slides', 18, 's18-rotate', 'Slayt · s.18'),
      'Denge bozulduğunda rotasyon gerektiğini doğru açıkladın.', 'Denge bozulduğunda ağacın rotasyonla yeniden dengelendiğini yazmadın.'),
    pt('p2', 'Yükseklik farkı en fazla 1 olmalı', ['en fazla 1', 'fark', '≤ 1', '1’den'], 3, cs('slides', 18, 's18-balance', 'Slayt · s.18'),
      'Yükseklik farkının sınırını (en fazla 1) belirttin.', 'Denge koşulunun hangi aralıkta olması gerektiğini (yükseklik farkı en fazla 1) belirtmedin.'),
    pt('p3', 'Amaç: arama O(log n) kalır', ['log', 'arama', 'hızlı'], 3, cs('slides', 18, 's18-cost', 'Slayt · s.18'),
      'Dengenin amacını, yani aramanın O(log n) kalmasını açıkladın.', 'Dengenin amacını, yani aramanın O(log n) kalmasını açıklamadın.'),
  ], 'AVL ağacında her düğümün sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla 1 olmalıdır. Bu koşul bozulduğunda ağaç rotasyonla yeniden dengelenir; böylece arama O(log n) kalır.'),
  op('o2', 'lr-rl', 'Ders notların · Rotasyon notları', 'Bir düğümün sol çocuğunun sağ alt ağacına ekleme yapıldığında hangi rotasyon gerekir ve nasıl uygulanır?', [
    pt('p1', 'Durum LR olarak adlandırılır', ['lr'], 3, cs('notes', 3, 'n3-lr', 'Notlar · s.3'),
      'Durumu doğru adlandırdın: bu bir LR durumu.', 'Durumun LR olarak adlandırıldığını belirtmedin.'),
    pt('p2', 'Çift rotasyon gerekir', ['çift', 'iki'], 3, cs('notes', 3, 'n3-single', 'Notlar · s.3'),
      'LR için çift (iki adımlı) rotasyon gerektiğini belirttin.', 'LR’nin tek değil, çift rotasyon gerektirdiğini belirtmedin.'),
    pt('p3', 'Önce sol çocukta sola, sonra düğümde sağa', ['sola', 'sağa'], 4, cs('notes', 3, 'n3-lr', 'Notlar · s.3'),
      'Adımların sırasını (önce sola, sonra sağa) doğru verdin.', 'Adımların sırasını belirtmedin: önce sol çocukta sola, sonra düğümde sağa döndürülür.'),
  ], 'Bu bir LR durumudur ve çift rotasyon gerektirir: önce sol çocukta sola, sonra düğümde sağa döndürülür.'),
  op('o3', 'bst-dengesizlik', 'Hafta 4 slaytları · Dengesiz ağaç', 'Sıralı veri eklenen bir BST’de neden sorun yaşanır ve AVL bunu nasıl çözer?', [
    pt('p1', 'Ağaç bağlı listeye dönüşür', ['liste', 'zincir', 'tek yön'], 3, cs('slides', 17, 's17-a', 'Slayt · s.17'),
      'Ağacın bağlı listeye dönüştüğünü doğru belirttin.', 'Ağacın tek yöne uzayıp bağlı listeye dönüştüğünü belirtmedin.'),
    pt('p2', 'Arama maliyeti O(n) olur', ['o(n)', 'doğrusal', 'yavaş'], 3, cs('slides', 17, 's17-b', 'Slayt · s.17'),
      'Arama maliyetinin O(n)’e çıktığını açıkladın.', 'Arama maliyetinin O(n)’e çıktığını belirtmedin.'),
    pt('p3', 'AVL dengeyi rotasyonla korur', ['rotasyon', 'denge'], 4, cs('slides', 18, 's18-rotate', 'Slayt · s.18'),
      'AVL’nin dengeyi koruyarak sorunu çözdüğünü belirttin.', 'AVL’nin dengeyi rotasyonla koruyarak sorunu nasıl çözdüğünü açıklamadın.'),
  ], 'Sıralı eklemede BST tek yöne uzayıp bağlı listeye dönüşür ve arama O(n) olur. AVL, her ekleme sonrası dengeyi rotasyonla koruyarak bunu önler.'),
  op('o4', 'avl-kirmizi-siyah', 'Ders notların · Karşılaştırma', 'AVL ve kırmızı-siyah ağaçları arama ve güncelleme açısından karşılaştır.', [
    pt('p1', 'AVL daha sıkı dengeli, arama daha hızlı', ['sıkı', 'arama', 'hızlı'], 4, cs('notes', 1, 'n1-tight', 'Notlar · s.1'),
      'AVL’nin daha sıkı dengeli olduğunu ve aramayı hızlandırdığını belirttin.', 'AVL’nin daha sıkı dengeli olduğunu ve aramada avantajlı olduğunu belirtmedin.'),
    pt('p2', 'Kırmızı-siyahta güncelleme biraz daha hızlı', ['güncelle', 'ekleme', 'silme'], 3, cs('notes', 4, 'n4-rb', 'Notlar · s.4'),
      'Kırmızı-siyah ağaçta güncellemenin biraz daha hızlı olduğunu belirttin.', 'Kırmızı-siyah ağaçta ekleme ve silmenin biraz daha hızlı olduğunu belirtmedin.'),
    pt('p3', 'İkisi de O(log n)', ['log'], 3, cs('notes', 4, 'n4-table', 'Notlar · s.4'),
      'İki ağacın da O(log n) sağladığını belirttin.', 'İki ağacın da O(log n) karmaşıklığına sahip olduğunu belirtmedin.'),
  ], 'İkisi de O(log n) sağlar. AVL daha sıkı dengelidir, bu yüzden arama daha hızlıdır; kırmızı-siyah ağaçta ekleme ve silme biraz daha hızlıdır.'),
  op('o5', 'hash-cakisma', 'Hafta 6 slaytları · Çakışma', 'Hash tablosunda çakışma nedir ve zincirleme bu sorunu nasıl çözer?', [
    pt('p1', 'İki anahtar aynı indekse düşer', ['aynı', 'indeks', 'çakış'], 3, cs('hash', 12, 'h12-a', 'Hafta 6 · s.12'),
      'Çakışmanın, iki anahtarın aynı indekse düşmesi olduğunu doğru açıkladın.', 'Çakışmanın, iki farklı anahtarın aynı indekse düşmesi olduğunu belirtmedin.'),
    pt('p2', 'Zincirleme: aynı gözde bağlı liste', ['bağlı liste', 'liste', 'zincir'], 4, cs('hash', 12, 'h12-chain', 'Hafta 6 · s.12'),
      'Zincirlemede anahtarların bağlı listede tutulduğunu belirttin.', 'Zincirlemede aynı indekse düşen anahtarların bir bağlı listede tutulduğunu belirtmedin.'),
    pt('p3', 'Doluluk arttıkça zincirler uzar', ['uzar', 'doluluk', 'yavaş'], 3, cs('hash', 12, 'h12-load', 'Hafta 6 · s.12'),
      'Doluluk arttıkça zincirlerin uzayıp aramanın yavaşladığını belirttin.', 'Doluluk arttıkça zincirlerin uzayıp aramanın yavaşladığını belirtmedin.'),
  ], 'Çakışma, iki farklı anahtarın aynı indekse düşmesidir. Zincirlemede bu anahtarlar aynı gözde bir bağlı listede tutulur; doluluk arttıkça zincirler uzar ve arama yavaşlar.'),
]

export const RECENT_MATERIALS = [
  { name: 'Hafta4_AVL_Agaclari.pdf', course: 'Veri Yapıları', where: 's.18’de kaldın', doc: 'slides', page: 18 },
  { name: 'VY_Ders_Notlari.pdf', course: 'Veri Yapıları', where: 's.3’te kaldın', doc: 'notes', page: 3 },
  { name: 'Hafta3_Bol_ve_Yonet.pdf', course: 'Algoritmalar', where: 's.12’de kaldın' },
]
