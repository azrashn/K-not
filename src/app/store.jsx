import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { INITIAL_MATERIALS, STATE_ORDER, TOPICS } from '../data/academic'

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

const SECTION_PATH = { home: '/', courses: '/dersler', quiz: '/quiz', analytics: '/analitik' }
export const pathFor = (section) => SECTION_PATH[section]

// ─── State ──────────────────────────────────────────────────────────────────
const init = () => ({
  topics: TOPICS.map((t) => ({ ...t })),
  review: [{ topicId: 'lr-rl', from: 'quiz' }],
  materials: JSON.parse(JSON.stringify(INITIAL_MATERIALS)),
  viewing: null,
})

function reducer(state, a) {
  switch (a.type) {
    case 'ANSWER': {
      const topics = state.topics.map((t) => {
        if (t.id !== a.topicId) return t
        const score = a.correct ? Math.min(1, (t.score || 0.3) + 0.1) : Math.max(0.06, (t.score || 0.3) - 0.12)
        return { ...t, score, answered: t.answered + 1, correct: t.correct + (a.correct ? 1 : 0) }
      })
      return { ...state, topics }
    }
    case 'REVIEW_ADD':
      if (state.review.some((r) => r.topicId === a.topicId)) return state
      return { ...state, review: [...state.review, { topicId: a.topicId, from: a.from }] }
    case 'REVIEW_DONE':
      return { ...state, review: state.review.filter((r) => r.topicId !== a.topicId) }
    case 'MAT_ADD':
      return { ...state, materials: { ...state.materials, [a.courseId]: [a.material, ...state.materials[a.courseId]] } }
    case 'VIEW':
      return state.viewing === a.courseId ? state : { ...state, viewing: a.courseId }
    case 'MAT_TICK': {
      const materials = {}
      for (const [cid, list] of Object.entries(state.materials)) {
        materials[cid] = list.map((x) => {
          if (!x.auto || x.status === 'ready') return x
          // Örnek (demo) materyaller yalnızca kendi ders sayfası açıkken ilerler.
          if (x.demo && state.viewing !== cid) return x
          const next = STATE_ORDER[STATE_ORDER.indexOf(x.status) + 1]
          return next === 'ready' ? { ...x, status: 'ready', auto: false } : { ...x, status: next }
        })
      }
      return { ...state, materials }
    }
    case 'MAT_RETRY': {
      const list = state.materials[a.courseId].map((x) => (x.id === a.id ? { ...x, status: 'reading', auto: true, issue: undefined } : x))
      return { ...state, materials: { ...state.materials, [a.courseId]: list } }
    }
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

  const navigate = useCallback((path, nextIntent) => {
    intent.current = nextIntent || null
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

  // Materyal hazırlığı: Yüklendi → Okunuyor → Hazırlanıyor → Hazır
  const busy = Object.entries(state.materials).some(([cid, l]) => l.some((x) => x.auto && x.status !== 'ready' && (!x.demo || state.viewing === cid)))
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => dispatch({ type: 'MAT_TICK' }), 1700)
    return () => clearInterval(t)
  }, [busy])

  const value = useMemo(
    () => ({ ...state, dispatch, route, navigate, takeIntent, menuOpen, setMenuOpen }),
    [state, route, navigate, takeIntent, menuOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
