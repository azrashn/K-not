import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// ─── Hash router ────────────────────────────────────────────────────────────
export function parseHash(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'dersler') {
    if (parts[1] && parts[2] === 'quiz') return { section:'quiz',view:'quiz',courseId:parts[1] }
    if (parts[1] && parts[2] === 'sinavlar') return { section: 'exams', view: 'exams', courseId: parts[1] }
    if (parts[1] && parts[2] === 'ogrenme') return { section: 'courses', view: 'learning', courseId: parts[1] }
    if (parts[1] && parts[2] === 'tekrar') return { section: 'courses', view: 'review', courseId: parts[1] }
    if (parts[1] && parts[2] === 'videolar') return { section: 'courses', view: 'videos', courseId: parts[1] }
    if (parts[1] && parts[2] === 'calisma') return { section: 'courses', view: 'workspace', courseId: parts[1] }
    if (parts[1]) return { section: 'courses', view: 'course', courseId: parts[1] }
    return { section: 'courses', view: 'list' }
  }
  if (parts[0] === 'quiz') return { section: 'quiz', view: 'quiz' }
  if (parts[0] === 'sinav') return { section: 'exams', view: 'exams' }
  if (parts[0] === 'analitik' || parts[0] === 'analiz') return { section: 'analytics', view: 'analytics' }
  if (parts.length === 0) return { section: 'home', view: 'home' }
  return { section: 'home', view: 'notfound' }
}

const MOCK_COURSE_PATH = /^\/dersler\/(veri-yapilari|algoritmalar|veritabani|yazilim)(\/|$)/

const SECTION_PATH = { home: '/', courses: '/dersler', quiz: '/quiz', exams: '/sinav', analytics: '/analitik' }
export const pathFor = (section) => SECTION_PATH[section]

// Gezinme dışında paylaşılan durum yok: dersler, materyaller ve yanıtlar gerçek API'den gelir (src/api).

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
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
    () => ({ route, navigate, takeIntent, menuOpen, setMenuOpen }),
    [route, navigate, takeIntent, menuOpen],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
