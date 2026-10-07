import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from '@phosphor-icons/react'
import { COURSE, SCENARIOS, answerFor } from './data/mock'
import { useMediaQuery } from './hooks/useMediaQuery'
import NavRail, { NAV, NavButton, KnotMark } from './components/NavRail'
import Header from './components/Header'
import Turn from './components/Turn'
import AskBox from './components/AskBox'
import SourceViewer from './components/SourceViewer'
import ThreadOverlay from './components/ThreadOverlay'
import Sheet from './components/Sheet'
import Toast from './components/Toast'
import { EASE_DRAWER } from './lib/motion'

let seq = 1
const makeTurn = (scenario, fresh = false) => ({ id: `t${seq++}`, scenario, status: fresh ? 'searching' : 'ready', fresh })

export default function App() {
  const reduce = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1024px)')

  const [turns, setTurns] = useState(() => [makeTurn(SCENARIOS.avl)])
  // Başlangıç: ilk iddia etkin, kanıt vurgulu.
  const [active, setActive] = useState(() => {
    const claim = SCENARIOS.avl.claims[0]
    return { turnId: 't1', claim, cite: claim.cites[0] }
  })
  const [view, setView] = useState({ doc: 'slides', page: 18 })
  const [pulse, setPulse] = useState(0)
  const [thread, setThread] = useState({ n: 0, key: '', delay: 340 })
  const [sheetOpen, setSheetOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [toast, setToast] = useState('')
  const scroller = useRef(null)
  const activeCount = COURSE.activeCount

  const activate = useCallback((turnId, claim, cite, opts = {}) => {
    const c = cite || claim.cites?.[0] || null
    setActive({ turnId, claim, cite: c })
    setPulse((p) => p + 1)
    setView(c ? { doc: c.doc, page: c.page } : null)
    if (opts.quiet) return
    if (desktop) {
      if (c) setThread((t) => ({ n: t.n + 1, key: `${turnId}:${claim.id}`, delay: 340 }))
    } else {
      setSheetOpen(true)
    }
  }, [desktop])

  // Açılışta tek seferlik: iddia → düğüm → kaynak bağlantısını göster.
  useEffect(() => {
    if (!desktop || reduce) return
    const t = setTimeout(() => setThread({ n: 1, key: 't1:c1', delay: 80 }), 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = turns.some((t) => t.status === 'searching')

  const ask = useCallback((question) => {
    const scenario = answerFor(question)
    const turn = makeTurn({ ...scenario, question }, true)
    setTurns((ts) => [...ts, turn])
    setSheetOpen(false)
    // Yeni turun başlığına kaydır: soru ve yanıt birlikte görünür kalır.
    const toTurn = () => {
      const el = scroller.current?.querySelector(`[data-turn="${turn.id}"]`)
      if (el) scroller.current.scrollTo({ top: el.offsetTop - 8, behavior: reduce ? 'auto' : 'smooth' })
    }
    setTimeout(toTurn, 60)
    setTimeout(() => {
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'ready' } : t)))
      const first = scenario.claims[0]
      activate(turn.id, first, first.cites?.[0], { quiet: true })
    }, reduce ? 300 : 1000)
  }, [activate, reduce])

  const onNav = (id) => {
    setNavOpen(false)
    if (id === 'courses') return
    setToast('Bu prototipte yalnızca AI Çalışma Alanı var.')
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const activeId = active ? `${active.turnId}:${active.claim.id}` : null
  const nearest = active?.claim?.gap ? turns.find((t) => t.id === active.turnId)?.scenario.nearest : null
  const viewer = (
    <SourceViewer
      view={view}
      setView={setView}
      active={active}
      evidence={active?.cite || null}
      pulse={pulse}
      nearest={nearest}
      onClose={desktop ? undefined : () => setSheetOpen(false)}
    />
  )

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-paper">
      {desktop && <NavRail current="courses" onSelect={onNav} />}

      <main className="flex min-w-0 flex-1 flex-col">
        <Header showMenu={!desktop} onMenu={() => setNavOpen(true)} />
        <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 sm:px-6" data-scroll>
          <div className="mx-auto w-full max-w-[44rem] pb-[32dvh]">
            {turns.map((t, i) => (
              <div key={t.id} data-turn={t.id} className={i ? 'border-t border-line' : ''}>
                <Turn
                  turn={t}
                  activeId={activeId}
                  activeCount={activeCount}
                  onActivate={activate}
                  onAsk={ask}
                />
              </div>
            ))}
          </div>
        </div>
        <AskBox onAsk={ask} busy={busy} />
      </main>

      {desktop ? (
        <aside className="w-[clamp(400px,38vw,560px)] shrink-0 border-l border-line">{viewer}</aside>
      ) : (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>{viewer}</Sheet>
      )}

      <AnimatePresence>
        {navOpen && !desktop && (
          <>
            <motion.button
              type="button" aria-label="Menüyü kapat" tabIndex={-1} onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-40 bg-ink/35"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            />
            <motion.nav
              aria-label="Ana gezinme"
              className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line-strong bg-paper p-3"
              initial={{ x: '-100%' }} animate={{ x: 0, transition: { duration: reduce ? 0.12 : 0.28, ease: EASE_DRAWER } }}
              exit={{ x: '-100%', transition: { duration: reduce ? 0.1 : 0.2, ease: EASE_DRAWER } }}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <KnotMark size={30} />
                <button type="button" onClick={() => setNavOpen(false)} aria-label="Menüyü kapat" className="press grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white"><X size={18} /></button>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {NAV.map((item) => (
                  <li key={item.id}><NavButton item={item} vertical={false} current={item.id === 'courses'} onSelect={onNav} /></li>
                ))}
              </ul>
            </motion.nav>
          </>
        )}
      </AnimatePresence>

      <ThreadOverlay trigger={thread} enabled={desktop && !reduce} />
      <Toast message={toast} />
    </div>
  )
}
