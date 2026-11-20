import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from '@phosphor-icons/react'
import { AppProvider, useApp, pathFor } from './app/store'
import { useMediaQuery } from './hooks/useMediaQuery'
import NavRail, { NAV, NavButton, KnotMark, UserBadge, ThemeToggle } from './components/NavRail'
import { AuthProvider, useAuth } from './app/auth'
import Login from './pages/Login'
import { EASE_DRAWER, EASE_OUT } from './lib/motion'
import Home from './pages/HomeDashboard'
import Courses from './pages/Courses'

// Ağır sayfalar ilk açılışta yüklenmez; rota açılınca ayrı parça olarak gelir.
const CourseDetail = lazy(() => import('./pages/CourseDetail'))
const Workspace = lazy(() => import('./pages/Workspace'))
const Quiz = lazy(() => import('./pages/CourseQuiz'))
const CourseExams = lazy(() => import('./pages/CourseExams'))
const ExamsHome = lazy(() => import('./pages/ExamsHome'))
const Analytics = lazy(() => import('./pages/LearningAnalytics'))
const Videos = lazy(() => import('./pages/Videos'))
const LearningWorkspace = lazy(() => import('./pages/LearningWorkspace'))

function PageLoading() {
  return <div role="status" aria-live="polite" className="p-6 text-sm text-ink-2">Yükleniyor…</div>
}

function NotFound() {
  const { navigate } = useApp()
  return (
    <div role="alert" className="grid h-full place-content-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold tracking-[-0.03em]">Sayfa bulunamadı</h1>
      <p className="text-sm text-ink-2">Bu adreste bir sayfa yok. Adresi kontrol et ya da Ana Sayfa'ya dön.</p>
      <button type="button" className="press mx-auto rounded-lg px-4 py-2 text-sm shadow-[0_0_0_1px_var(--color-line-strong)]" onClick={() => navigate('/')}>Ana Sayfa</button>
    </div>
  )
}

// Rota prop olarak donar: çıkış animasyonundaki eski sayfa yeni rotayı okuyup erken oluşmaz.
function Page({ route }) {
  const { view, courseId } = route
  switch (view) {
    case 'list': return <Courses />
    case 'course': return <CourseDetail courseId={courseId} />
    case 'workspace': return <Workspace courseId={courseId} />
    case 'learning': return <LearningWorkspace key={courseId} courseId={courseId} />
    case 'videos': return <Videos courseId={courseId} />
    case 'quiz': return <Quiz courseId={courseId} />
    case 'exams': return courseId ? <CourseExams key={courseId} courseId={courseId} /> : <ExamsHome />
    case 'analytics': return <Analytics />
    case 'notfound': return <NotFound />
    default: return <Home />
  }
}

function Shell() {
  const reduce = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { route, navigate, menuOpen, setMenuOpen } = useApp()
  const onNav = (id) => { setMenuOpen(false); navigate(pathFor(id)) }
  const pageKey = `${route.view}:${route.courseId || ''}`
  useEffect(() => {
    const names = { home: 'Ana Sayfa', list: 'Dersler', course: 'Ders', workspace: 'Çalışma alanı', quiz: 'Quiz', exams: 'Sınav', analytics: 'Öğrenme Analizi' }
    document.title = `${route.view === 'videos' ? 'Ders videoları' : names[route.view] || 'K-not'} — K-not`
  }, [route.view])

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper">
      {desktop && <NavRail current={route.section} onSelect={onNav} />}
      <main className="min-w-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pageKey}
            className="h-full"
            initial={{ opacity: 0, y: reduce ? 0 : 6, filter: reduce ? 'blur(0px)' : 'blur(2px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: reduce ? 0.1 : 0.24, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0.06 : 0.1, ease: EASE_OUT } }}
          >
            <Suspense fallback={<PageLoading />}><Page route={route} /></Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {menuOpen && !desktop && (
          <>
            <motion.button
              type="button" aria-label="Menüyü kapat" tabIndex={-1} onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            />
            <motion.nav
              aria-label="Ana gezinme"
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-paper p-3 shadow-[8px_0_32px_-12px_rgba(22,24,30,0.3)]"
              initial={{ x: '-100%' }} animate={{ x: 0, transition: { duration: reduce ? 0.12 : 0.28, ease: EASE_DRAWER } }}
              exit={{ x: '-100%', transition: { duration: reduce ? 0.1 : 0.2, ease: EASE_DRAWER } }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <KnotMark size={30} />
                <button type="button" onClick={() => setMenuOpen(false)} aria-label="Menüyü kapat" className="press grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white"><X size={18} /></button>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {NAV.map((item) => (
                  <li key={item.id}><NavButton item={item} vertical={false} current={item.id === route.section} onSelect={onNav} /></li>
                ))}
              </ul>
              <div className="mt-auto flex flex-col gap-1 px-1"><ThemeToggle /><UserBadge vertical={false} /></div>
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// Tahta deneme sayfası (#/tahta-deneme) yalnızca geliştirmede vardır; production build'e girmez.
const DevRoutes = import.meta.env.DEV ? (() => {
  const BoardDemo = lazy(() => import('./pages/BoardDemo'))
  const onHash = (cb) => { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb) }
  const isBoardDemo = () => /^#\/?tahta-deneme\/?$/.test(window.location.hash)
  return function DevRoutes({ children }) {
    const demo = useSyncExternalStore(onHash, isBoardDemo)
    return demo ? <Suspense fallback={null}><BoardDemo /></Suspense> : children
  }
})() : ({ children }) => children

// Korunan uygulama: oturum yoksa (ya da süresi dolduysa) giriş ekranı. Rota (#/...) korunur.
function Gate() {
  const { authenticated } = useAuth()
  if (!authenticated) return <Login />
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

export default function App() {
  return (
    <DevRoutes>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </DevRoutes>
  )
}
