import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { SCENARIOS, answerFor } from '../data/mock'
import { COURSES } from '../data/academic'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useApp } from '../app/store'
import Header from '../components/Header'
import Turn from '../components/Turn'
import AskBox from '../components/AskBox'
import SourceViewer from '../components/SourceViewer'
import ThreadOverlay from '../components/ThreadOverlay'
import Sheet from '../components/Sheet'

const makeTurn = (id, scenario, fresh = false) => ({ id, scenario, status: fresh ? 'searching' : 'ready', fresh })

const PLURAL = { slayt: 'slayt', not: 'ders notu', pdf: 'PDF', sinav: 'çıkmış soru seti' }
export const scanSummary = (list) => {
  const counts = {}
  list.forEach((m) => { counts[m.type] = (counts[m.type] || 0) + 1 })
  return Object.entries(counts).map(([t, n]) => `${n} ${PLURAL[t]}`).join(' · ')
}

export default function Workspace({ courseId }) {
  const reduce = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { materials, navigate, takeIntent, setMenuOpen } = useApp()
  const course = COURSES.find((c) => c.id === courseId) || COURSES[0]
  const ready = materials[course.id].filter((m) => m.status === 'ready')
  const activeCount = ready.length

  const seq = useRef(2)
  const [turns, setTurns] = useState(() => [makeTurn('t1', SCENARIOS.avl)])
  const [active, setActive] = useState(() => {
    const claim = { ...SCENARIOS.avl.claims[0], n: 1, tag: 'İddia 1' }
    return { turnId: 't1', claim, cite: claim.cites[0] }
  })
  const [view, setView] = useState({ doc: 'slides', page: 18 })
  const [pulse, setPulse] = useState(0)
  const [thread, setThread] = useState({ n: 0, key: '', delay: 340 })
  const [sheetOpen, setSheetOpen] = useState(false)
  const scroller = useRef(null)
  const countRef = useRef(activeCount)
  countRef.current = activeCount

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

  const ask = useCallback((question) => {
    const scenario = answerFor(question, countRef.current)
    const turn = makeTurn(`t${seq.current++}`, { ...scenario, question }, true)
    setTurns((ts) => [...ts, turn])
    setSheetOpen(false)
    const toTurn = () => {
      const el = scroller.current?.querySelector(`[data-turn="${turn.id}"]`)
      if (el) scroller.current.scrollTo({ top: el.offsetTop - 8, behavior: reduce ? 'auto' : 'smooth' })
    }
    setTimeout(toTurn, 60)
    setTimeout(() => {
      setTurns((ts) => ts.map((t) => (t.id === turn.id ? { ...t, status: 'ready' } : t)))
      const first = { ...scenario.claims[0], n: 1, tag: scenario.claims[0].gap && !scenario.claims[0].unsupported ? 'Yanıt' : 'İddia 1' }
      activate(turn.id, first, first.cites?.[0], { quiet: true })
    }, reduce ? 300 : 1000)
  }, [activate, reduce])

  // Sayfalar arası niyet: Ana Sayfa / Analitik / Quiz'den gelen soru ya da kaynak
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const intent = takeIntent()
    if (!intent) {
      if (desktop && !reduce) {
        const t = setTimeout(() => setThread({ n: 1, key: 't1:c1', delay: 80 }), 900)
        return () => clearTimeout(t)
      }
      return
    }
    if (intent.question) setTimeout(() => ask(intent.question), 350)
    if (intent.open) {
      const o = intent.open
      const claim = { id: 'open', text: o.text, cites: [o.cite], tag: o.tag || 'Kaynak' }
      setTimeout(() => activate('open', claim, o.cite), 250)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = turns.some((t) => t.status === 'searching')
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
      scan={{ count: activeCount, groups: scanSummary(ready) }}
      onClose={desktop ? undefined : () => setSheetOpen(false)}
      onAddMaterial={() => navigate(`/dersler/${course.id}`, { upload: true })}
    />
  )

  return (
    <div className="flex h-full min-w-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <Header showMenu={!desktop} onMenu={() => setMenuOpen(true)} course={course} materials={materials[course.id]} onBack={() => navigate(`/dersler/${course.id}`)} />
        <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 sm:px-8" data-scroll>
          <div className="mx-auto w-full max-w-[42rem] pb-[32dvh]">
            {turns.map((t) => (
              <div key={t.id} data-turn={t.id} className="[&+&]:border-t [&+&]:border-hair">
                <Turn turn={t} activeId={activeId} activeCount={activeCount} onActivate={activate} onAsk={ask} />
              </div>
            ))}
          </div>
        </div>
        <AskBox onAsk={ask} busy={busy} />
      </section>

      {desktop ? (
        <aside className="w-[clamp(400px,38vw,560px)] shrink-0">{viewer}</aside>
      ) : (
        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)}>{viewer}</Sheet>
      )}

      <ThreadOverlay trigger={thread} enabled={desktop && !reduce} />
    </div>
  )
}
