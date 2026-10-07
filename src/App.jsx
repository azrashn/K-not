import { useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import logoK from './assets/K.png'
import logoKnot from './assets/Knot.png'
import {
  House,
  BookOpen,
  ChartBar,
  Lightning,
  CaretLeft,
  CaretRight,
  CaretDoubleRight,
  PaperPlaneTilt,
  SealCheck,
  Warning,
  Scissors,
  Sparkle,
  Brain,
  ChatCircleText,
  FileText,
  MagnifyingGlass,
  TrendUp,
  Clock,
  Books,
  ArrowRight,
  CheckCircle,
  Circle,
  SignOut,
} from '@phosphor-icons/react'

// ─── Spring Configs (Emil Kowalski style) ────────────────────────────────────
const spring = {
  snappy:  { type: 'spring', stiffness: 400, damping: 30 },
  smooth:  { type: 'spring', stiffness: 280, damping: 26 },
  gentle:  { type: 'spring', stiffness: 180, damping: 22 },
  panel:   { type: 'spring', stiffness: 340, damping: 32 },
}
const EASE = [0.16, 1, 0.3, 1]

// ─── Shared fade-slide variants ───────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 8, filter: 'blur(2px)' },
  show:   { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit:   { opacity: 0, y: -6, filter: 'blur(2px)' },
}

// ─── Design Tokens ───────────────────────────────────────────────────────────
const T = {
  paper:   '#FAF8F4',
  white:   '#FFFFFF',
  subtle:  '#F5F3EF',
  navBg:   '#0E1726',
  ink900:  '#111827',
  ink700:  '#374151',
  ink500:  '#6B7280',
  ink400:  '#9CA3AF',
  ink300:  '#D1D5DB',
  ink200:  '#E5E7EB',
  ink100:  '#F3F4F6',
  teal50:  '#F0FDFA',
  teal100: '#CCFBF1',
  teal200: '#99F6E4',
  teal600: '#0D9488',
  teal700: '#0F766E',
  border:  '#E5E7EB',
}

const shadow = {
  xs:   '0 1px 2px rgba(0,0,0,0.05)',
  sm:   '0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.04)',
  md:   '0 4px 8px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.04)',
  card: '0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)',
}

const KNOT_CFG = {
  SIKI: {
    text: '#065F46', bg: '#ECFDF5', border: '#6EE7B7',
    dot: '#10B981', stripe: '#10B981', icon: SealCheck,
    label: 'SIKI', sub: '2/2 iddia kaynakla destekleniyor',
  },
  GEVESEK: {
    text: '#92400E', bg: '#FFFBEB', border: '#FCD34D',
    dot: '#F59E0B', stripe: '#F59E0B', icon: Warning,
    label: 'GEVEŞEK', sub: 'Bazı iddialar zayıf destekli',
  },
  KOPUK: {
    text: '#7F1D1D', bg: '#FEF2F2', border: '#FECACA',
    dot: '#EF4444', stripe: '#EF4444', icon: Scissors,
    label: 'KOPUK', sub: 'İlgili kaynak bulunamadı',
  },
}

// ─── Mock Documents ───────────────────────────────────────────────────────────
const DOCUMENTS = {
  slides: {
    id: 'slides',
    filename: 'Hafta 4 - AVL Trees.pdf',
    docLabel: 'Ders Slaytları — Hafta 4',
    totalPages: 32,
    pages: {
      16: {
        title: 'İkili Arama Ağacı — Giriş',
        content: [
          { text: 'İkili arama ağacı (BST), her düğümün solundaki tüm değerlerin daha küçük, sağındaki tüm değerlerin daha büyük olduğu bir veri yapısıdır.', highlight: false },
          { text: 'BST\'de arama, ekleme ve silme işlemleri ortalama O(log n) karmaşıklığındadır; ancak ağaç dengesizleşirse O(n)\'e çıkabilir.', highlight: false },
          { text: 'Bu sorunu çözmek için dengeli ağaç yapıları geliştirilmiştir.', highlight: false },
        ],
      },
      17: {
        title: 'Dengesiz Ağaçlar — Problem',
        content: [
          { text: 'Sıralı veri eklendiğinde BST tek yönlü büyür ve tam bağlantılı listeye dönüşür.', highlight: false },
          { text: 'Bu durumda arama karmaşıklığı O(n)\'e düşer ve ağaç işe yaramaz hale gelir.', highlight: false },
          { text: 'Çözüm: Denge faktörünü takip eden ve gerektiğinde kendini yeniden düzenleyen ağaçlar.', highlight: true },
        ],
      },
      18: {
        title: 'AVL Ağaçları — Denge Koşulu',
        content: [
          { text: 'AVL ağacı, her düğümün sol ve sağ alt ağaçlarının yükseklikleri arasındaki farkın en fazla 1 olduğu dengeli bir ikili arama ağacıdır.', highlight: false },
          { text: 'Denge koşulu bozulduğunda — yani herhangi bir düğümde yükseklik farkı 2 veya daha fazla olduğunda — ağacı yeniden dengelemek için rotasyon işlemleri uygulanır.', highlight: true },
          { text: 'Rotasyon, belirli bir alt ağaçtaki düğümlerin konumunu değiştirerek yükseklik farkını telafi eder ve O(log n) arama karmaşıklığını garanti eder.', highlight: false },
        ],
      },
      19: {
        title: 'AVL — Denge Faktörü Hesabı',
        content: [
          { text: 'Denge faktörü (bf) = sol alt ağaç yüksekliği − sağ alt ağaç yüksekliği.', highlight: false },
          { text: 'bf ∈ {-1, 0, 1} ise düğüm dengelidir. bf < -1 veya bf > 1 ise rotasyon gerekir.', highlight: false },
          { text: 'Her ekleme/silme sonrası köke kadar tüm düğümlerin denge faktörü güncellenir.', highlight: false },
        ],
      },
    },
  },
  notes: {
    id: 'notes',
    filename: 'Kisisel-Notlar-DS.pdf',
    docLabel: 'Kişisel Ders Notları',
    totalPages: 12,
    pages: {
      1: {
        title: 'Hafta 4 — Genel Notlar',
        content: [
          { text: 'AVL ağaçları 1962\'de Adelson-Velsky ve Landis tarafından geliştirildi.', highlight: false },
          { text: 'Öz-dengeleme özelliği sayesinde tüm temel işlemler garantili O(log n) karmaşıklığındadır.', highlight: false },
          { text: 'Pratikte kırmızı-siyah ağaçlara kıyasla daha sıkı dengeli; arama daha hızlı, güncelleme biraz yavaş.', highlight: false },
        ],
      },
      2: {
        title: 'Rotasyonların Özeti',
        content: [
          { text: 'Toplam 4 rotasyon türü: LL, RR, LR, RL.', highlight: false },
          { text: 'LL ve RR → tek rotasyon (single rotation). Bir döndürme yeterli.', highlight: false },
          { text: 'LR ve RL → çift rotasyon (double rotation). İki aşamalı düzeltme gerekir.', highlight: false },
        ],
      },
      3: {
        title: 'AVL — Rotasyon Notları',
        content: [
          { text: 'Dört temel rotasyon durumu vardır: LL, RR, LR ve RL.', highlight: true },
          { text: 'LL ve RR tek döndürme (single rotation), LR ve RL çift döndürme (double rotation) içerir.', highlight: false },
          { text: 'Rotasyon sayısı eklemede en fazla 1, silmede O(log n) olabilir.', highlight: false },
          { text: 'Pratik ipucu: Denge faktörü (balance factor) = sol yükseklik − sağ yükseklik.', highlight: false },
        ],
      },
      4: {
        title: 'Karmaşıklık Karşılaştırması',
        content: [
          { text: 'BST (dengesiz): Arama/Ekleme/Silme — en kötü O(n).', highlight: false },
          { text: 'AVL ağacı: Arama/Ekleme/Silme — garanti O(log n).', highlight: true },
          { text: 'Kırmızı-Siyah ağaç: O(log n) ama daha gevşek denge; ekleme/silme biraz daha hızlı.', highlight: false },
        ],
      },
    },
  },
}

// ─── Conversation Data ────────────────────────────────────────────────────────
const CONVERSATION = {
  question: 'AVL ağaçlarında denge nasıl sağlanır?',
  claims: [
    {
      id: 'claim-1',
      text: 'AVL ağacında denge bozulduğunda rotasyon uygulanır.',
      citation: { docId: 'slides', page: 18, label: 'Slayt · s.18' },
    },
    {
      id: 'claim-2',
      text: 'Dört temel rotasyon durumu vardır: LL, RR, LR ve RL.',
      citation: { docId: 'notes', page: 3, label: 'Notlar · s.3' },
    },
  ],
  knotState: 'SIKI',
}

// ─── Nav Items ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'home',      icon: House,     label: 'Ana Sayfa' },
  { id: 'courses',   icon: BookOpen,  label: 'Dersler'   },
  { id: 'quiz',      icon: Lightning, label: 'Test'      },
  { id: 'analytics', icon: ChartBar,  label: 'Analitik'  },
]

// ─── Helper: mono label ───────────────────────────────────────────────────────
const monoStyle = (extra = {}) => ({
  fontFamily: 'JetBrains Mono, monospace',
  ...extra,
})

// ─── Profile data ─────────────────────────────────────────────────────────────
const PROFILE = {
  name:   'Azra Şahin',
  role:   '3. Sınıf · Bilgisayar Müh.',
  avatar: 'https://i.pravatar.cc/96?img=47',
}

// ─── NavRail ─────────────────────────────────────────────────────────────────
function NavRail({ activeNav, onNav, isExpanded, onToggle }) {
  const reduce = useReducedMotion()

  const NAV_W_OPEN   = 240
  const NAV_W_CLOSED = 72

  return (
    <motion.nav
      aria-label="Ana navigasyon"
      animate={{ width: isExpanded ? NAV_W_OPEN : NAV_W_CLOSED }}
      transition={spring.smooth}
      style={{
        flexShrink: 0, overflow: 'hidden',
        background: T.navBg,
        display: 'flex', flexDirection: 'column',
        padding: '0', gap: 0,
        minHeight: '100dvh', position: 'sticky', top: 0,
        zIndex: 20,
      }}
    >
      {/* ── Top: Logo + toggle ────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: isExpanded ? 'space-between' : 'center',
        padding: isExpanded ? '18px 16px 14px' : '18px 0 14px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* Logo — click toggles panel */}
        <motion.button
          id="nav-logo"
          onClick={onToggle}
          aria-label={isExpanded ? 'Paneli kapat' : 'Paneli aç'}
          whileHover={reduce ? {} : { scale: 1.04 }}
          whileTap={reduce ? {} : { scale: 0.96 }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
        >
          <AnimatePresence mode="wait">
            {isExpanded ? (
              <motion.img
                key="logo-full"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring.snappy}
                src={logoKnot}
                alt="K-not Logo"
                style={{ height: 40, width: 'auto', objectFit: 'contain' }}
              />
            ) : (
              <motion.img
                key="logo-icon"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring.snappy}
                src={logoK}
                alt="K Logo"
                style={{ height: 56, width: 56, objectFit: 'contain' }}
              />
            )}
          </AnimatePresence>
        </motion.button>

        {/* Collapse arrow — only visible when expanded */}
        <AnimatePresence>
          {isExpanded && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={spring.snappy}
              onClick={onToggle}
              aria-label="Kapat"
              whileHover={reduce ? {} : { scale: 1.1 }}
              whileTap={reduce ? {} : { scale: 0.9 }}
              style={{
                background: 'rgba(255,255,255,0.08)', border: 'none',
                width: 26, height: 26, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.5)', flexShrink: 0,
              }}
            >
              <CaretLeft size={13} weight="bold" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Nav items ─────────────────────────────────── */}
      <div style={{ flex: 1, padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = activeNav === item.id
          return (
            <div key={item.id} style={{ padding: '0 12px' }}>
              <motion.button
                id={`nav-${item.id}`}
                onClick={() => onNav(item.id)}
                title={!isExpanded ? item.label : undefined}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                whileHover={reduce ? {} : { scale: isExpanded ? 1.01 : 1.06 }}
                whileTap={reduce ? {} : { scale: 0.94 }}
                style={{
                  position: 'relative', width: '100%', height: 40,
                  borderRadius: 10, border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center',
                  justifyContent: isExpanded ? 'flex-start' : 'center',
                  gap: 10, padding: isExpanded ? '0 10px' : 0,
                  background: 'transparent',
                  color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                  transition: 'color 0.18s',
                }}
              >
                {isActive && (
                  <motion.div
                    layoutId="nav-pill"
                    transition={spring.snappy}
                    style={{
                      position: 'absolute', inset: 0, borderRadius: 10,
                      background: 'rgba(255,255,255,0.11)',
                    }}
                  />
                )}
                <Icon size={19} weight={isActive ? 'fill' : 'regular'} style={{ position: 'relative', zIndex: 1, flexShrink: 0 }} />
                <AnimatePresence>
                  {isExpanded && (
                    <motion.span
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={spring.snappy}
                      style={{
                        position: 'relative', zIndex: 1,
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 13, fontWeight: isActive ? 600 : 400,
                        whiteSpace: 'nowrap',
                        color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.55)',
                      }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          )
        })}
      </div>

      {/* ── Bottom: mini avatar (collapsed) or sign-out (expanded) ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '12px',
        display: 'flex', alignItems: 'center',
        justifyContent: isExpanded ? 'space-between' : 'center',
        gap: 8,
      }}>
        {/* Mini avatar — always visible */}
        <motion.button
          onClick={onToggle}
          aria-label="Profil"
          whileHover={reduce ? {} : { scale: 1.06 }}
          whileTap={reduce ? {} : { scale: 0.94 }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', gap: 8, minWidth: 0,
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0, overflow: 'hidden',
            border: '1.5px solid rgba(110,231,183,0.3)',
          }}>
            <img
              src={PROFILE.avatar}
              alt={PROFILE.name}
              width={30} height={30}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              onError={e => {
                e.target.style.display = 'none'
                e.target.parentElement.style.background = 'linear-gradient(135deg,#0D9488,#065F46)'
                e.target.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;font-size:11px;font-weight:700;color:#fff">AŞ</div>'
              }}
            />
          </div>
          <AnimatePresence>
            {isExpanded && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={spring.snappy}
                style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}
              >
                {PROFILE.name}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>

        {/* Sign-out — only when expanded */}
        <AnimatePresence>
          {isExpanded && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring.snappy}
              aria-label="Çıkış"
              whileHover={reduce ? {} : { scale: 1.1 }}
              whileTap={reduce ? {} : { scale: 0.9 }}
              style={{
                background: 'rgba(255,255,255,0.06)', border: 'none',
                width: 28, height: 28, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'rgba(255,255,255,0.4)', flexShrink: 0,
              }}
            >
              <SignOut size={14} />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  )
}

// ─── Dashboard View ───────────────────────────────────────────────────────────
const COURSES = [
  { id: 'ds',   name: 'Veri Yapıları',    code: 'CS201', progress: 72, materials: 14, active: true  },
  { id: 'algo', name: 'Algoritmalar',      code: 'CS301', progress: 45, materials: 9,  active: false },
  { id: 'os',   name: 'İşletim Sistemleri',code: 'CS401', progress: 28, materials: 11, active: false },
]
const RECENT = [
  { id: 'r1', label: 'AVL ağaçlarında denge nasıl sağlanır?', course: 'Veri Yapıları', ago: '14 dk önce' },
  { id: 'r2', label: 'Merge sort ve quick sort karmaşıklığı?', course: 'Algoritmalar',  ago: '2 saat önce' },
  { id: 'r3', label: 'Deadlock nedir, nasıl önlenir?',         course: 'İşl. Sistemleri', ago: 'dün' },
]

function DashboardView({ onNavigate }) {
  const reduce = useReducedMotion()
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '40px 32px', background: T.paper }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Greeting */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show"
          transition={{ duration: 0.5, ease: EASE }}
          style={{ marginBottom: 40 }}
        >
          <h1 style={{
            fontFamily: "'Fraunces', Georgia, serif",
            fontSize: 32, fontWeight: 600, color: T.ink900,
            letterSpacing: '-0.03em', lineHeight: 1.25, margin: '0 0 8px',
          }}>
            Hoş geldin, Azra.
          </h1>
          <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: T.ink500, margin: 0 }}>
            3 aktif ders · Bu hafta 5 oturum
          </p>
        </motion.div>

        {/* Stats row */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show"
          transition={{ duration: 0.5, delay: 0.06, ease: EASE }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 32 }}
        >
          {[
            { icon: ChatCircleText, label: 'Toplam soru',  value: '47',  color: T.teal600 },
            { icon: SealCheck,      label: 'Desteklenen',  value: '38',  color: '#065F46' },
            { icon: TrendUp,        label: 'Bu hafta',     value: '12',  color: '#6366F1' },
          ].map((stat) => {
            const Icon = stat.icon
            return (
              <div key={stat.label} style={{
                background: T.white, borderRadius: 14, padding: '16px 20px',
                border: `1px solid ${T.border}`, boxShadow: shadow.sm,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: `${stat.color}12`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={18} weight="fill" style={{ color: stat.color }} />
                </div>
                <div>
                  <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 22, fontWeight: 700, color: T.ink900, lineHeight: 1 }}>{stat.value}</p>
                  <p style={{ margin: '3px 0 0', ...monoStyle({ fontSize: 11, color: T.ink400, textTransform: 'uppercase', letterSpacing: '0.07em' }) }}>{stat.label}</p>
                </div>
              </div>
            )
          })}
        </motion.div>

        {/* Courses */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show"
          transition={{ duration: 0.5, delay: 0.12, ease: EASE }}
          style={{ marginBottom: 32 }}
        >
          <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 500, color: T.ink900, letterSpacing: '-0.02em', margin: '0 0 14px' }}>
            Aktif Dersler
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {COURSES.map((course, i) => (
              <motion.div
                key={course.id}
                initial={reduce ? false : { opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.15 + i * 0.07, ease: EASE }}
                onClick={() => onNavigate('courses')}
                whileHover={reduce ? {} : { y: -1, boxShadow: shadow.md }}
                style={{
                  background: T.white, borderRadius: 12, padding: '14px 16px',
                  border: `1px solid ${course.active ? T.teal200 : T.border}`,
                  boxShadow: course.active ? `0 0 0 2px rgba(13,148,136,0.08), ${shadow.sm}` : shadow.xs,
                  cursor: 'pointer', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: course.active ? T.teal50 : T.subtle,
                  border: `1px solid ${course.active ? T.teal200 : T.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Books size={18} weight={course.active ? 'fill' : 'regular'} style={{ color: course.active ? T.teal600 : T.ink400 }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 600, color: T.ink900 }}>{course.name}</span>
                    <span style={{ ...monoStyle({ fontSize: 10, color: T.ink400, textTransform: 'uppercase', letterSpacing: '0.08em' }) }}>{course.code}</span>
                    {course.active && (
                      <span style={{ ...monoStyle({ fontSize: 10, color: T.teal700, background: T.teal50, border: `1px solid ${T.teal200}`, padding: '1px 7px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '0.06em' }) }}>Aktif</span>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div style={{ height: 4, background: T.ink100, borderRadius: 9999, overflow: 'hidden' }}>
                    <motion.div
                      initial={reduce ? false : { width: 0 }}
                      animate={{ width: `${course.progress}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + i * 0.1, ease: EASE }}
                      style={{ height: '100%', background: course.active ? T.teal600 : T.ink300, borderRadius: 9999 }}
                    />
                  </div>
                  <p style={{ margin: '5px 0 0', fontFamily: 'Inter, sans-serif', fontSize: 11, color: T.ink400 }}>
                    %{course.progress} tamamlandı · {course.materials} materyal
                  </p>
                </div>
                <ArrowRight size={16} style={{ color: T.ink300, flexShrink: 0 }} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Recent activity */}
        <motion.div
          variants={fadeUp} initial="hidden" animate="show"
          transition={{ duration: 0.5, delay: 0.2, ease: EASE }}
        >
          <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 18, fontWeight: 500, color: T.ink900, letterSpacing: '-0.02em', margin: '0 0 14px' }}>
            Son Sorular
          </h2>
          <div style={{ background: T.white, borderRadius: 14, border: `1px solid ${T.border}`, boxShadow: shadow.sm, overflow: 'hidden' }}>
            {RECENT.map((item, i) => (
              <div
                key={item.id}
                onClick={() => onNavigate('courses')}
                style={{
                  padding: '12px 16px',
                  borderBottom: i < RECENT.length - 1 ? `1px solid ${T.border}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.subtle}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Clock size={14} style={{ color: T.ink300, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 13, color: T.ink700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </p>
                  <p style={{ margin: '2px 0 0', fontFamily: 'Inter, sans-serif', fontSize: 11, color: T.ink400 }}>
                    {item.course} · {item.ago}
                  </p>
                </div>
                <ArrowRight size={13} style={{ color: T.ink300, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

// ─── Placeholder Views ────────────────────────────────────────────────────────
function PlaceholderView({ icon: Icon, title, desc }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.paper }}>
      <motion.div
        variants={fadeUp} initial="hidden" animate="show"
        transition={{ duration: 0.4, ease: EASE }}
        style={{ textAlign: 'center', padding: 40 }}
      >
        <div style={{
          width: 56, height: 56, borderRadius: 16, background: T.white,
          border: `1px solid ${T.border}`, boxShadow: shadow.sm,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <Icon size={26} style={{ color: T.ink300 }} />
        </div>
        <h2 style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 22, fontWeight: 500, color: T.ink900, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
          {title}
        </h2>
        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: T.ink400, margin: 0, maxWidth: 280 }}>
          {desc}
        </p>
      </motion.div>
    </div>
  )
}

// ─── Course Context Bar ───────────────────────────────────────────────────────
function CourseContextBar() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 24px', borderBottom: `1px solid ${T.border}`, background: T.white,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          ...monoStyle({ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }),
          color: T.teal700, background: T.teal50, border: `1px solid ${T.teal200}`,
          padding: '4px 10px', borderRadius: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.teal600, display: 'inline-block' }} />
          Veri Yapıları
        </span>
        <span style={{ color: T.ink300, fontSize: 13 }}>·</span>
        <span style={{ ...monoStyle({ fontSize: 11, color: T.ink500 }) }}>14 materyal aktif</span>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, ...monoStyle({ fontSize: 10, color: T.ink400 }) }}>
        <MagnifyingGlass size={11} />
        <span>Yalnızca ders materyallerinde aranıyor</span>
      </div>
    </div>
  )
}

// ─── Citation Pill ────────────────────────────────────────────────────────────
function CitationPill({ label, isActive, onClick, reduce }) {
  return (
    <motion.button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      whileHover={reduce ? {} : { scale: 1.05 }}
      whileTap={reduce ? {} : { scale: 0.95 }}
      animate={{
        background: isActive ? T.teal600 : T.teal50,
        color: isActive ? '#FFFFFF' : T.teal700,
        borderColor: isActive ? T.teal600 : T.teal200,
        boxShadow: isActive ? '0 2px 10px rgba(13,148,136,0.3)' : shadow.xs,
      }}
      transition={spring.snappy}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
        ...monoStyle({ fontSize: 11, fontWeight: 500 }),
        padding: '4px 12px', borderRadius: 9999, border: '1px solid',
        cursor: 'pointer',
      }}
    >
      <FileText size={11} weight={isActive ? 'fill' : 'regular'} />
      {label}
    </motion.button>
  )
}

// ─── Claim Row ────────────────────────────────────────────────────────────────
function ClaimRow({ claim, isActive, onCite, index, reduce }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12, filter: 'blur(2px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.4, delay: index * 0.1, ease: EASE }}
      onClick={() => onCite(claim)}
      whileHover={reduce ? {} : { y: -1 }}
      animate={{
        opacity: 1, y: 0, filter: 'blur(0px)',
        borderColor: isActive ? T.teal200 : T.border,
        background: isActive ? T.teal50 : T.white,
        boxShadow: isActive ? `0 0 0 3px rgba(13,148,136,0.1), ${shadow.sm}` : shadow.xs,
      }}
      transition={spring.smooth}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '14px 16px', borderRadius: 12, border: '1px solid',
        cursor: 'pointer',
      }}
    >
      {/* Index badge */}
      <motion.div
        animate={{ background: isActive ? T.teal600 : T.subtle, color: isActive ? '#FFFFFF' : T.ink500 }}
        transition={spring.snappy}
        style={{
          width: 24, height: 24, borderRadius: 8, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...monoStyle({ fontSize: 10, fontWeight: 600 }), marginTop: 1,
        }}
      >
        {index + 1}
      </motion.div>

      {/* Text */}
      <motion.p
        animate={{ color: isActive ? T.ink900 : T.ink700, fontWeight: isActive ? 500 : 400 }}
        transition={spring.smooth}
        style={{ flex: 1, margin: 0, fontSize: 14, lineHeight: 1.65, fontFamily: 'Inter, sans-serif' }}
      >
        {claim.text}
      </motion.p>

      {/* Pill */}
      <CitationPill
        label={claim.citation.label}
        isActive={isActive}
        onClick={() => onCite(claim)}
        reduce={reduce}
      />
    </motion.div>
  )
}

// ─── Knot Strength ────────────────────────────────────────────────────────────
function KnotStrength({ state, reduce }) {
  const cfg = KNOT_CFG[state]
  const Icon = cfg.icon
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.28, ease: EASE }}
      style={{
        display: 'flex', alignItems: 'stretch', borderRadius: 14,
        border: `1px solid ${cfg.border}`, background: cfg.bg,
        overflow: 'hidden', boxShadow: shadow.sm,
      }}
    >
      <div style={{ width: 4, background: cfg.stripe, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon size={18} weight="fill" style={{ color: cfg.text, flexShrink: 0, marginTop: 1 }} />
        <div>
          <span style={{ ...monoStyle({ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: T.ink400 }) }}>
            Düğüm Gücü
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, boxShadow: `0 0 0 3px ${cfg.bg}, 0 0 0 4px ${cfg.dot}50` }} />
            <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, fontWeight: 700, color: cfg.text, letterSpacing: '0.02em' }}>
              {cfg.label}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', fontFamily: 'Inter, sans-serif', fontSize: 12, color: cfg.text, opacity: 0.72, lineHeight: 1.5 }}>
            {cfg.sub}
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Next Steps ──────────────────────────────────────────────────────────────
function NextSteps({ reduce }) {
  const actions = [
    { id: 'test',    icon: Lightning,      label: 'Bunu test et',           primary: true  },
    { id: 'explain', icon: ChatCircleText, label: 'Basitçe açıkla',         primary: false },
    { id: 'gaps',    icon: Brain,          label: 'Eksik noktaları göster', primary: false },
  ]
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.38, ease: EASE }}
    >
      <p style={{ ...monoStyle({ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: T.ink400 }), marginBottom: 10 }}>
        Sonraki adım
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {actions.map((action, i) => {
          const Icon = action.icon
          return (
            <motion.button
              key={action.id} id={`action-${action.id}`} aria-label={action.label}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.42 + i * 0.07, ease: EASE }}
              whileHover={reduce ? {} : { y: -1, boxShadow: shadow.md }}
              whileTap={reduce ? {} : { scale: 0.97, y: 0 }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                padding: '8px 14px', borderRadius: 10, border: '1px solid',
                cursor: 'pointer', transition: 'box-shadow 0.18s',
                background:   action.primary ? T.ink900 : T.white,
                color:        action.primary ? '#FFFFFF' : T.ink700,
                borderColor:  action.primary ? T.ink900  : T.border,
                boxShadow:    action.primary ? shadow.sm  : shadow.xs,
              }}
            >
              <Icon size={14} weight={action.primary ? 'fill' : 'regular'} />
              {action.label}
            </motion.button>
          )
        })}
      </div>
    </motion.div>
  )
}

// ─── Workspace (Courses) View ─────────────────────────────────────────────────
function WorkspaceView({ activeClaim, onCite, reduce }) {
  const [inputValue, setInputValue] = useState('')
  const handleSubmit = (e) => { e.preventDefault(); if (inputValue.trim()) setInputValue('') }

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: '100dvh', background: T.paper }}>
      <CourseContextBar />

      {/* Conversation */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
        <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>

          {/* User bubble */}
          <motion.div
            initial={reduce ? false : fadeUp.hidden} animate={fadeUp.show}
            transition={{ duration: 0.4, ease: EASE }}
            style={{ display: 'flex', justifyContent: 'flex-end' }}
          >
            <div style={{ maxWidth: 400 }}>
              <div style={{
                background: T.ink900, color: '#FFFFFF',
                borderRadius: '18px 18px 4px 18px', padding: '12px 16px',
                fontFamily: 'Inter, sans-serif', fontSize: 14, lineHeight: 1.6,
                boxShadow: shadow.sm,
              }}>
                {CONVERSATION.question}
              </div>
              <p style={{ textAlign: 'right', marginTop: 6, ...monoStyle({ fontSize: 11, color: T.ink400 }) }}>Siz</p>
            </div>
          </motion.div>

          {/* AI answer block */}
          <div>
            {/* K-not header */}
            <motion.div
              initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.1 }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                background: T.teal50, border: `1px solid ${T.teal200}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sparkle size={14} weight="fill" style={{ color: T.teal600 }} />
              </div>
              <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 13, fontWeight: 500, color: T.ink900, letterSpacing: '-0.01em' }}>K-not</span>
              <span style={{ ...monoStyle({ fontSize: 10, color: T.ink400, textTransform: 'uppercase', letterSpacing: '0.08em' }) }}>yanıtı</span>
            </motion.div>

            {/* Claims */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {CONVERSATION.claims.map((claim, i) => (
                <ClaimRow
                  key={claim.id} claim={claim}
                  isActive={activeClaim?.id === claim.id}
                  onCite={onCite} index={i} reduce={reduce}
                />
              ))}
            </div>

            <div style={{ height: 1, background: T.border, margin: '20px 0' }} />
            <KnotStrength state={CONVERSATION.knotState} reduce={reduce} />
          </div>

          {/* Next steps */}
          <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24 }}>
            <NextSteps reduce={reduce} />
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div style={{ borderTop: `1px solid ${T.border}`, background: T.white, padding: '16px 24px' }}>
        <form onSubmit={handleSubmit} style={{ maxWidth: 680, margin: '0 auto' }}>
          <motion.div
            animate={{
              borderColor: inputValue ? T.teal200 : T.border,
              boxShadow: inputValue ? `0 0 0 3px rgba(13,148,136,0.08)` : shadow.xs,
            }}
            transition={spring.smooth}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: T.paper, border: '1.5px solid', borderRadius: 14, padding: '10px 14px',
            }}
          >
            <input
              id="chat-input" type="text" value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Veri Yapıları hakkında bir soru sorun…"
              aria-label="Soru girişi"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'Inter, sans-serif', fontSize: 14, color: T.ink900 }}
            />
            <motion.button
              type="submit" id="send-button" aria-label="Gönder"
              animate={{ background: inputValue.trim() ? T.teal600 : T.ink100, color: inputValue.trim() ? '#FFFFFF' : T.ink400 }}
              transition={spring.snappy}
              whileTap={reduce ? {} : { scale: 0.9 }}
              style={{ width: 32, height: 32, borderRadius: 8, border: 'none', cursor: inputValue.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <PaperPlaneTilt size={15} weight="fill" />
            </motion.button>
          </motion.div>
          <p style={{ marginTop: 8, textAlign: 'center', ...monoStyle({ fontSize: 10, color: T.ink400 }) }}>
            Yalnızca seçili ders materyallerinde aranıyor
          </p>
        </form>
      </div>
    </div>
  )
}

// ─── Document Preview ─────────────────────────────────────────────────────────
function DocumentPreview({ doc, page, pageData, reduce }) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 12px' }}>
      <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, overflow: 'hidden', background: T.white, boxShadow: shadow.card }}>
        {/* macOS chrome */}
        <div style={{ padding: '9px 14px', borderBottom: `1px solid ${T.border}`, background: T.subtle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {['#FC6058','#FEC02F','#29CC43'].map(c => (
              <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: 0.85 }} />
            ))}
          </div>
          <span style={{ flex: 1, textAlign: 'center', marginLeft: -34, ...monoStyle({ fontSize: 10, color: T.ink500 }) }}>
            {doc.filename}
          </span>
        </div>

        {/* Content */}
        <div style={{ padding: '18px 16px' }}>
          <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${T.border}` }}>
            <h3 style={{ margin: 0, fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink900, letterSpacing: '-0.02em', lineHeight: 1.35 }}>
              {pageData.title}
            </h3>
            <p style={{ margin: '3px 0 0', ...monoStyle({ fontSize: 10, color: T.ink400 }) }}>
              Sayfa {page} / {doc.totalPages}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pageData.content.map((item, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.28, delay: i * 0.06, ease: EASE }}
              >
                {item.highlight ? (
                  <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                    <motion.div
                      initial={reduce ? false : { scaleY: 0, originY: 0 }}
                      animate={{ scaleY: 1 }}
                      transition={{ duration: 0.35, delay: 0.12, ease: EASE }}
                      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: T.teal600, borderRadius: '3px 0 0 3px' }}
                    />
                    <motion.p
                      initial={reduce ? false : { backgroundColor: 'rgba(240,253,250,0)' }}
                      animate={{ backgroundColor: 'rgba(240,253,250,1)' }}
                      transition={{ duration: 0.4, delay: 0.18 }}
                      style={{
                        margin: 0, padding: '10px 28px 10px 16px',
                        fontSize: 13, lineHeight: 1.65, fontFamily: 'Inter, sans-serif',
                        color: T.ink900, fontWeight: 500,
                        border: `1px solid ${T.teal100}`, borderLeft: 'none',
                        borderRadius: '0 6px 6px 0',
                      }}
                    >
                      {item.text}
                    </motion.p>
                    <motion.span
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, delay: 0.38 }}
                      style={{
                        position: 'absolute', top: 6, right: 8,
                        ...monoStyle({ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }),
                        color: T.teal700, background: T.teal100, padding: '2px 6px', borderRadius: 4,
                      }}
                    >
                      Kanıt
                    </motion.span>
                  </div>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, fontFamily: 'Inter, sans-serif', color: T.ink500 }}>
                    {item.text}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Source Viewer ────────────────────────────────────────────────────────────
function SourceViewer({ activeClaim, reduce }) {
  const [currentPage, setCurrentPage] = useState(null)
  const prevClaimId = useRef(null)

  const hasActive = !!activeClaim
  const doc        = hasActive ? DOCUMENTS[activeClaim.citation.docId] : null
  const targetPage = hasActive ? activeClaim.citation.page : null

  // Reset page override whenever the active claim changes
  if (activeClaim?.id !== prevClaimId.current) {
    prevClaimId.current = activeClaim?.id
    if (currentPage !== null) setCurrentPage(null)
  }

  const effectivePage = currentPage ?? targetPage

  // All available pages in sorted order
  const allPages = doc ? Object.keys(doc.pages).map(Number).sort((a, b) => a - b) : []
  const pageIdx  = allPages.indexOf(effectivePage)
  const pageData = doc && effectivePage ? doc.pages[effectivePage] : null

  const goPage = useCallback((dir) => {
    const next = pageIdx + dir
    if (next >= 0 && next < allPages.length) setCurrentPage(allPages[next])
  }, [pageIdx, allPages])

  return (
    <aside
      aria-label="Kaynak görüntüleyici"
      style={{
        width: 360, flexShrink: 0,
        borderLeft: `1px solid ${T.border}`, background: T.subtle,
        display: 'flex', flexDirection: 'column', minHeight: '100dvh',
        position: 'sticky', top: 0, maxHeight: '100dvh',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 20px', borderBottom: `1px solid ${T.border}`, background: T.white,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <FileText size={14} style={{ color: T.ink400 }} />
          <span style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 13, fontWeight: 500, color: T.ink900, letterSpacing: '-0.01em' }}>
            Kaynak
          </span>
        </div>
        <AnimatePresence mode="wait">
          {hasActive && (
            <motion.span
              key={activeClaim.id}
              initial={{ opacity: 0, scale: 0.85, x: 6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85, x: 6 }}
              transition={spring.snappy}
              style={{
                ...monoStyle({ fontSize: 10, fontWeight: 500 }),
                color: T.teal700, background: T.teal50,
                border: `1px solid ${T.teal200}`, padding: '3px 8px', borderRadius: 6,
              }}
            >
              {activeClaim.citation.label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Doc label */}
      <AnimatePresence mode="wait">
        {hasActive && doc && (
          <motion.div
            key={`doc-${doc.id}`}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={spring.smooth}
            style={{ padding: '10px 20px', borderBottom: `1px solid ${T.border}`, background: T.white }}
          >
            <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: T.ink900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {doc.docLabel}
            </p>
            <p style={{ margin: '2px 0 0', ...monoStyle({ fontSize: 10, color: T.ink400 }) }}>
              {doc.filename}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content area */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <AnimatePresence mode="wait">
          {hasActive && pageData ? (
            <motion.div
              key={`${activeClaim?.id}-p${effectivePage}`}
              initial={{ opacity: 0, y: 10, filter: 'blur(3px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(3px)' }}
              transition={spring.panel}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              <DocumentPreview doc={doc} page={effectivePage} pageData={pageData} reduce={reduce} />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center' }}
            >
              <div style={{ width: 48, height: 48, borderRadius: 14, background: T.white, border: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, boxShadow: shadow.sm }}>
                <FileText size={22} style={{ color: T.ink300 }} />
              </div>
              <p style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: 15, fontWeight: 500, color: T.ink700, marginBottom: 8, letterSpacing: '-0.01em' }}>
                Kaynak Seçilmedi
              </p>
              <p style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, lineHeight: 1.6, color: T.ink400, maxWidth: 210 }}>
                Bir iddia kaynağına tıklayarak ilgili belgeyi burada görüntüleyin.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Page nav */}
      {hasActive && doc && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderTop: `1px solid ${T.border}`, background: T.white }}>
          <motion.button
            id="page-prev" onClick={() => goPage(-1)} aria-label="Önceki sayfa"
            disabled={pageIdx <= 0}
            whileHover={reduce || pageIdx <= 0 ? {} : { x: -2 }}
            whileTap={reduce || pageIdx <= 0 ? {} : { scale: 0.94 }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, ...monoStyle({ fontSize: 11 }), color: pageIdx <= 0 ? T.ink300 : T.ink500, background: 'none', border: 'none', cursor: pageIdx <= 0 ? 'default' : 'pointer', padding: '4px 6px', borderRadius: 6 }}
          >
            <CaretLeft size={12} /> Önceki
          </motion.button>

          <span style={{ ...monoStyle({ fontSize: 11, color: T.ink400 }) }}>s. {effectivePage}</span>

          <motion.button
            id="page-next" onClick={() => goPage(1)} aria-label="Sonraki sayfa"
            disabled={pageIdx >= allPages.length - 1}
            whileHover={reduce || pageIdx >= allPages.length - 1 ? {} : { x: 2 }}
            whileTap={reduce || pageIdx >= allPages.length - 1 ? {} : { scale: 0.94 }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, ...monoStyle({ fontSize: 11 }), color: pageIdx >= allPages.length - 1 ? T.ink300 : T.ink500, background: 'none', border: 'none', cursor: pageIdx >= allPages.length - 1 ? 'default' : 'pointer', padding: '4px 6px', borderRadius: 6 }}
          >
            Sonraki <CaretRight size={12} />
          </motion.button>
        </div>
      )}
    </aside>
  )
}

// ─── Center Shell — switches views ────────────────────────────────────────────
function CenterShell({ activeNav, activeClaim, onCite, onNavigate, reduce }) {
  return (
    <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <AnimatePresence mode="wait">
        {activeNav === 'home' && (
          <motion.div key="home" variants={fadeUp} initial="hidden" animate="show" exit="exit"
            transition={{ duration: 0.35, ease: EASE }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <DashboardView onNavigate={onNavigate} />
          </motion.div>
        )}
        {activeNav === 'courses' && (
          <motion.div key="courses" variants={fadeUp} initial="hidden" animate="show" exit="exit"
            transition={{ duration: 0.35, ease: EASE }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <WorkspaceView activeClaim={activeClaim} onCite={onCite} reduce={reduce} />
          </motion.div>
        )}
        {activeNav === 'quiz' && (
          <motion.div key="quiz" variants={fadeUp} initial="hidden" animate="show" exit="exit"
            transition={{ duration: 0.35, ease: EASE }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <PlaceholderView icon={Lightning} title="Test Modu" desc="AVL ağaçları üzerinde kendinizi sınamak için bir test başlatın." />
          </motion.div>
        )}
        {activeNav === 'analytics' && (
          <motion.div key="analytics" variants={fadeUp} initial="hidden" animate="show" exit="exit"
            transition={{ duration: 0.35, ease: EASE }} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <PlaceholderView icon={ChartBar} title="Analitik" desc="Öğrenme sürecinizi ve kaynak kullanımınızı takip edin." />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [activeNav,    setActiveNav]    = useState('courses')
  const [activeClaim,  setActiveClaim]  = useState(CONVERSATION.claims[0])
  const [navExpanded,  setNavExpanded]  = useState(false)
  const reduce = useReducedMotion()

  const handleCite = useCallback((claim) => {
    setActiveClaim(prev => prev?.id === claim.id ? null : claim)
  }, [])

  const handleNav = useCallback((id) => {
    setActiveNav(id)
    if (id !== 'courses') setActiveClaim(null)
    if (id === 'courses') setActiveClaim(CONVERSATION.claims[0])
  }, [])

  const handleToggleNav = useCallback(() => {
    setNavExpanded(prev => !prev)
  }, [])

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', fontFamily: 'Inter, sans-serif', background: T.paper }}>
      <NavRail
        activeNav={activeNav}
        onNav={handleNav}
        isExpanded={navExpanded}
        onToggle={handleToggleNav}
      />
      <CenterShell
        activeNav={activeNav}
        activeClaim={activeClaim}
        onCite={handleCite}
        onNavigate={handleNav}
        reduce={reduce}
      />
      <AnimatePresence>
        {activeNav === 'courses' && (
          <motion.div
            key="source-viewer"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={spring.gentle}
            style={{ display: 'flex' }}
          >
            <SourceViewer activeClaim={activeClaim} reduce={reduce} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
