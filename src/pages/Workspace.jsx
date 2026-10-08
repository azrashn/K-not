import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { api } from '../api/endpoints'
import { adaptAnswer } from '../lib/answer'
import { TYPE_LABEL, toMaterial } from '../lib/materials'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useCourseDocuments, useResource } from '../hooks/useApi'
import { useApp } from '../app/store'
import Header from '../components/Header'
import Turn from '../components/Turn'
import AskBox from '../components/AskBox'
import SourceViewer from '../components/SourceViewer'
import ThreadOverlay from '../components/ThreadOverlay'
import Sheet from '../components/Sheet'
import { PageFrame } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { LoadState } from './Courses'

export const scanSummary = (list) => {
  const counts = {}
  list.forEach((m) => { counts[m.type] = (counts[m.type] || 0) + 1 })
  return Object.entries(counts).map(([t, n]) => `${n} ${TYPE_LABEL[t] ?? t}`).join(' · ')
}

export default function Workspace({ courseId }) {
  const reduce = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { navigate, takeIntent, setMenuOpen } = useApp()
  const course = useResource((signal) => api.course(courseId, signal), [courseId])
  const { docs } = useCourseDocuments(courseId)
  const materials = useMemo(() => (docs ?? []).map(toMaterial), [docs])
  const ready = materials.filter((m) => m.status === 'ready')
  const activeCount = ready.length

  const seq = useRef(1)
  const [turns, setTurns] = useState([])
  const [active, setActive] = useState(null)
  const [view, setView] = useState(null) // { docId, page, indexingVersion? }
  const [pulse, setPulse] = useState(0)
  const [thread, setThread] = useState({ n: 0, key: '', delay: 340 })
  const [sheetOpen, setSheetOpen] = useState(false)
  const scroller = useRef(null)

  // Görüntüleyicideki belge sekmeleri: etkin yanıtın kaynakları + ders materyal bilgisi.
  const sources = useMemo(() => {
    const turn = turns.find((t) => t.id === active?.turnId)
    const base = turn?.answer?.sources ?? []
    const byId = new Map(materials.map((m) => [m.id, m]))
    const list = base.map((s) => ({ ...s, pageCount: s.pageCount ?? byId.get(s.id)?.pages ?? null, filename: s.filename ?? byId.get(s.id)?.name }))
    if (view && !list.some((s) => s.id === view.docId)) {
      const m = byId.get(view.docId)
      list.push({ id: view.docId, title: m?.title ?? 'Belge', filename: m?.name, documentType: m?.documentType ?? 'other', pageCount: m?.pages ?? null })
    }
    return list
  }, [turns, active?.turnId, materials, view])

  const activate = useCallback((turnId, claim, cite, opts = {}) => {
    const c = cite || claim.cites?.[0] || null
    setActive({ turnId, claim, cite: c })
    setPulse((p) => p + 1)
    // KOPUK iddia: alıntısı olsa bile "kanıt yok" paneli açılır (destek yükseltilmez).
    setView(c && !claim.unsupported ? { docId: c.docId, page: c.page ?? 1, indexingVersion: c.indexingVersion } : null)
    if (opts.quiet) return
    if (desktop) {
      if (c && !claim.unsupported) setThread((t) => ({ n: t.n + 1, key: `${turnId}:${claim.id}`, delay: 340 }))
    } else {
      setSheetOpen(true)
    }
  }, [desktop])

  const run = useCallback(async (turnId, question) => {
    setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, status: 'searching', error: null } : t)))
    try {
      const answer = adaptAnswer(await api.answer(courseId, question))
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, status: 'ready', answer } : t)))
      const first = answer.claims[0]
      activate(turnId, first, first.unsupported ? null : first.cites?.[0], { quiet: true })
    } catch (error) {
      setTurns((ts) => ts.map((t) => (t.id === turnId ? { ...t, status: 'error', error } : t)))
    }
  }, [courseId, activate])

  const ask = useCallback((question) => {
    const id = `t${seq.current++}`
    setTurns((ts) => [...ts, { id, question, status: 'searching' }])
    setSheetOpen(false)
    setTimeout(() => {
      const el = scroller.current?.querySelector(`[data-turn="${id}"]`)
      if (el) scroller.current.scrollTo({ top: el.offsetTop - 8, behavior: reduce ? 'auto' : 'smooth' })
    }, 60)
    run(id, question)
  }, [run, reduce])

  // Sayfalar arası niyet: Ders sayfasından "Kaynakta aç" ya da bir sorunun aktarılması.
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const intent = takeIntent()
    if (intent?.question) ask(intent.question)
    if (intent?.openDoc) {
      const { id, page } = intent.openDoc
      setActive({ turnId: 'open', claim: { id: 'open', text: 'Materyal görüntüleniyor', cites: [], tag: 'Kaynak' }, cite: null })
      setView({ docId: id, page: page ?? 1 })
      if (!desktop) setSheetOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (course.loading || course.error) {
    return (
      <PageFrame><MobileBar />
        <div className="pt-14">
          {course.error?.code === 'NOT_FOUND'
            ? <p className="m-0 text-ink-2">Ders bulunamadı ya da bu derse kayıtlı değilsin.</p>
            : <LoadState loading={course.loading} error={course.error} onRetry={course.reload} />}
        </div>
      </PageFrame>
    )
  }

  const busy = turns.some((t) => t.status === 'searching')
  const activeId = active ? `${active.turnId}:${active.claim.id}` : null

  const viewer = (
    <SourceViewer
      view={view}
      setView={setView}
      active={active}
      evidence={active?.cite || null}
      pulse={pulse}
      sources={sources}
      scan={{ count: activeCount, groups: scanSummary(ready) }}
      onClose={desktop ? undefined : () => setSheetOpen(false)}
      onAddMaterial={() => navigate(`/dersler/${courseId}`, { upload: true })}
    />
  )

  return (
    <div className="flex h-full min-w-0">
      <section className="flex min-w-0 flex-1 flex-col">
        <Header showMenu={!desktop} onMenu={() => setMenuOpen(true)} course={course.data} materials={materials} onBack={() => navigate(`/dersler/${courseId}`)} />
        <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 sm:px-8" data-scroll>
          <div className="mx-auto w-full max-w-[42rem] pb-[32dvh]">
            {turns.length === 0 && (
              <div className="pt-12" data-empty-workspace>
                <h2 className="display m-0 text-[30px] text-ink sm:text-[36px]">Materyallerine bir soru sor</h2>
                <p className="m-0 mt-3 max-w-[34rem] text-[15.5px] leading-relaxed text-ink-2">
                  {activeCount > 0
                    ? `Yanıtlar yalnızca bu dersteki hazır ${activeCount} materyalden gelir; her iddia kaynağındaki sayfaya bağlanır.`
                    : 'Bu derste henüz hazır materyal yok. Önce bir PDF yükle; hazır olduğunda soru sorabilirsin.'}
                </p>
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id} data-turn={t.id} className="[&+&]:border-t [&+&]:border-hair">
                <Turn turn={t} activeId={activeId} activeCount={activeCount} onActivate={activate} onRetry={() => run(t.id, t.question)} />
              </div>
            ))}
          </div>
        </div>
        <AskBox onAsk={ask} busy={busy} disabled={activeCount === 0} />
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
