import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from '@phosphor-icons/react'
import { AppProvider, useApp, pathFor } from './app/store'
import { useMediaQuery } from './hooks/useMediaQuery'
import NavRail, { NAV, NavButton, KnotMark } from './components/NavRail'
import { EASE_DRAWER, EASE_OUT } from './lib/motion'
import Home from './pages/Home'
import Courses from './pages/Courses'
import CourseDetail from './pages/CourseDetail'
import Workspace from './pages/Workspace'
import Quiz from './pages/Quiz'
import Analytics from './pages/Analytics'

// Rota prop olarak donar: çıkış animasyonundaki eski sayfa yeni rotayı okuyup erken oluşmaz.
function Page({ route }) {
  const { navigate } = useApp()
  const { view, courseId } = route
  useEffect(() => {
    if (view === 'workspace' && courseId !== 'veri-yapilari') navigate(`/dersler/${courseId}`)
  }, [view, courseId, navigate])
  switch (view) {
    case 'list': return <Courses />
    case 'course': return <CourseDetail courseId={courseId} />
    case 'workspace': return courseId === 'veri-yapilari' ? <Workspace courseId={courseId} /> : null
    case 'quiz': return <Quiz />
    case 'analytics': return <Analytics />
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
    const names = { home: 'Ana Sayfa', list: 'Dersler', course: 'Ders', workspace: 'Çalışma alanı', quiz: 'Quiz', analytics: 'Bilgi İpi' }
    document.title = `${names[route.view] || 'K-not'} — K-not`
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
            <Page route={route} />
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
            </motion.nav>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
