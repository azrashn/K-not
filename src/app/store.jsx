import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { INITIAL_REVIEW, SUPPORT_SEED, TOPICS } from '../data/academic'

// ─── Hash router ────────────────────────────────────────────────────────────
export function parseHash(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'dersler') {
    if (parts[1] && parts[2] === 'calisma') return { section: 'courses', view: 'workspace', courseId: parts[1] }
    if (parts[1]) return { section: 'courses', view: 'course', courseId: parts[1] }
    return { section: 'courses', view: 'list' }
  }
  if (parts[0] === 'quiz') return { section: 'quiz', view: 'quiz' }
  if (parts[0] === 'analitik') return { section: 'analytics', view: 'analytics' }
  return { section: 'home', view: 'home' }
}

const MOCK_COURSE_PATH = /^\/dersler\/(veri-yapilari|algoritmalar|veritabani|yazilim)(\/|$)/

const SECTION_PATH = { home: '/', courses: '/dersler', quiz: '/quiz', analytics: '/analitik' }
export const pathFor = (section) => SECTION_PATH[section]

// ─── State ──────────────────────────────────────────────────────────────────
// Yalnızca henüz arka ucu olmayan ekranların (Ana Sayfa, Quiz, Analitik — WBS-6/7/8) örnek durumu.
// Dersler, materyaller ve yanıtlar gerçek API'den gelir (src/api), burada tutulmaz.
const init = () => ({
  topics: TOPICS.map((t) => ({ ...t })),
  review: INITIAL_REVIEW.map((r) => ({ ...r })),
  stats: { ...SUPPORT_SEED.stats },
  unsupported: SUPPORT_SEED.unsupported.map((u) => ({ ...u })),
  recentAnswered: 12,
})

function reducer(state, a) {
  switch (a.type) {
    case 'ANSWER': {
      const topics = state.topics.map((t) => {
        if (t.id !== a.topicId) return t
        const score = a.correct ? Math.min(1, (t.score || 0.3) + 0.1) : Math.max(0.06, (t.score || 0.3) - 0.12)
        return { ...t, score, answered: t.answered + 1, correct: t.correct + (a.correct ? 1 : 0) }
      })
      return { ...state, topics, recentAnswered: state.recentAnswered + 1 }
    }
    // Her yanıt, kanıt durumuna göre Kaynak Güveni sayaçlarına işlenir.
    case 'ASKED': {
      const key = a.state === 'SIKI' ? 'full' : a.state === 'GEVESEK' ? 'partial' : 'none'
      const unsupported = a.state === 'KOPUK' ? [{ question: a.question, when: 'Az önce' }, ...state.unsupported] : state.unsupported
      return { ...state, stats: { ...state.stats, [key]: state.stats[key] + 1 }, unsupported }
    }
    case 'REVIEW_ADD':
      if (state.review.some((r) => r.topicId === a.topicId)) return state
      return { ...state, review: [...state.review, { topicId: a.topicId, from: a.from }] }
    case 'REVIEW_DONE':
      return { ...state, review: state.review.filter((r) => r.topicId !== a.topicId) }
    default:
      return state
  }
}

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const [route, setRoute] = useState(() => parseHash(window.location.hash))
  const [menuOpen, setMenuOpen] = useState(false)
  const intent = useRef(null)

  useEffect(() => {
    const on = () => { setRoute(parseHash(window.location.hash)); setMenuOpen(false) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const navigate = useCallback((rawPath, nextIntent) => {
    // Örnek ekranlar (Ana Sayfa/Quiz/Analitik) eski örnek ders adreslerine bağlanır; gerçek
    // derslerin kimlikleri farklıdır. Bu bağlantılar gerçek ders listesine yönlendirilir.
    const mockLink = MOCK_COURSE_PATH.test(rawPath)
    const path = mockLink ? '/dersler' : rawPath
    intent.current = mockLink ? null : nextIntent || null
    const target = `#${path}`
    if (window.location.hash === target) setRoute(parseHash(target))
    else window.location.hash = target
  }, [])

  // Sayfalar arası niyet (ör. Analitik → çalışma alanında sor) bir kez tüketilir.
  const takeIntent = useCallback(() => {
    const i = intent.current
    intent.current = null
    return i
  }, [])

  const value = useMemo(
    () => ({ ...state, dispatch, route, navigate, takeIntent, menuOpen, setMenuOpen }),
    [state, route, navigate, takeIntent, menuOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
