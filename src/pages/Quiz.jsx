import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, X, FilePdf } from '@phosphor-icons/react'
import { COURSES, DOC_FILE, QUIZ_AMOUNTS, QUIZ_BANK, QUIZ_GROUPS, QUIZ_MODES, STATE_TEXT, topicState } from '../data/academic'
import { useApp } from '../app/store'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { excerpt, docFile } from '../lib/docs'
import { EASE_DRAWER, EASE_OUT } from '../lib/motion'
import { Btn, TextLink } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { MiniThread } from '../components/Threads'
import CitationPill from '../components/Citation'
import SourceViewer from '../components/SourceViewer'
import ThreadOverlay from '../components/ThreadOverlay'
import Sheet from '../components/Sheet'

const STAGES = [
  { id: 'practice', label: 'Alıştır' },
  { id: 'answer', label: 'Cevapla' },
  { id: 'feedback', label: 'Değerlendirme' },
  { id: 'source', label: 'Kaynak' },
  { id: 'review', label: 'Tekrar' },
]
const LETTERS = ['A', 'B', 'C', 'D']
const MODE_LABEL = Object.fromEntries(QUIZ_MODES.map((m) => [m.id, m.label]))
const norm = (s) => s.toLocaleLowerCase('tr').replace(/ı/g, 'i')

// ─── Soru havuzu: Ders → Konu → Seçili materyaller ─────────────────────────────
function weakIds(topics) {
  return topics.filter((t) => ['loose', 'weak'].includes(topicState(t.score))).map((t) => t.id)
}
function byScope(scope, topics, bank) {
  if (scope === 'weak') {
    const ids = weakIds(topics)
    const rank = (id) => topics.find((t) => t.id === id)?.score ?? 1
    return bank.filter((q) => ids.includes(q.topic)).sort((a, b) => rank(a.topic) - rank(b.topic))
  }
  if (scope.startsWith('topic:')) return bank.filter((q) => q.topic === scope.slice(6))
  const g = QUIZ_GROUPS.find((x) => x.id === scope)
  return g?.topics ? bank.filter((q) => g.topics.includes(q.topic)) : bank
}
function candidateFiles(scope, topics) {
  const g = QUIZ_GROUPS.find((x) => x.id === scope)
  if (g?.materials) return g.materials
  return [...new Set(byScope(scope, topics, QUIZ_BANK).map((q) => DOC_FILE[q.cite.doc]))]
}
function buildPool(scope, mode, topics, files) {
  return byScope(scope, topics, QUIZ_BANK.filter((q) => q.type === mode)).filter((q) => files.has(DOC_FILE[q.cite.doc]))
}
const scopeName = (scope, topics) =>
  scope.startsWith('topic:') ? topics.find((t) => t.id === scope.slice(6))?.name : QUIZ_GROUPS.find((g) => g.id === scope)?.label

// ─── Açık uçlu cevap değerlendirmesi (prototip kuralı: kaynak noktalarıyla örtüşme) ──
function evaluate(q, text) {
  const n = norm(text)
  const points = q.points.map((p) => {
    let at = -1
    let len = 0
    for (const k of p.kw) {
      const i = n.indexOf(norm(k))
      if (i >= 0 && (at < 0 || i < at)) { at = i; len = k.length }
    }
    return { ...p, hit: at >= 0, at, len }
  })
  const score = points.filter((p) => p.hit).reduce((a, p) => a + p.w, 0)
  return { score, points }
}
// Öğrencinin cevabını, kaynakla örtüşen kısımlar işaretlenerek parçalara böler.
function segmentAnswer(text, points) {
  const spans = points.filter((p) => p.hit).map((p) => ({ s: p.at, e: p.at + p.len, id: p.id })).sort((a, b) => a.s - b.s)
  const out = []
  let cur = 0
  for (const sp of spans) {
    if (sp.s < cur) continue
    if (sp.s > cur) out.push({ t: text.slice(cur, sp.s) })
    out.push({ t: text.slice(sp.s, sp.e), id: sp.id })
    cur = sp.e
  }
  if (cur < text.length) out.push({ t: text.slice(cur) })
  return out
}

function Stepper({ stage }) {
  const idx = STAGES.findIndex((s) => s.id === stage)
  return (
    <ol aria-label="Alıştırma döngüsü" className="m-0 flex list-none items-center gap-1 p-0 text-[12.5px]">
      {STAGES.map((s, i) => {
        const done = i < idx
        const now = i === idx
        return (
          <li key={s.id} className="flex items-center gap-1" aria-current={now ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={`h-px w-2.5 transition-colors duration-300 sm:w-5 ${done || now ? 'bg-accent' : 'bg-line-strong'}`} />}
            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-200 ${now ? 'text-ink' : done ? 'text-accent' : 'text-ink-3'}`}>
              <span aria-hidden className={`size-[7px] rounded-full transition-colors duration-200 ${now ? 'bg-accent' : done ? 'bg-accent/50' : 'bg-line-strong'}`} />
              <span className={now ? '' : 'max-sm:hidden'}>{s.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function Quiz() {
  const reduce = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const wide = useMediaQuery('(min-width: 1280px)')
  const { navigate, topics, dispatch, takeIntent } = useApp()

  const [phase, setPhase] = useState('setup') // setup | session | summary
  const [scope, setScopeState] = useState('avl')
  const [mode, setMode] = useState('mc')
  const [amount, setAmount] = useState(5)
  const [off, setOff] = useState(() => new Set())

  const [qs, setQs] = useState([])
  const [idx, setIdx] = useState(0)
  const [pick, setPick] = useState(null)
  const [text, setText] = useState('')
  const [checked, setChecked] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [ev, setEv] = useState(null) // açık uçlu değerlendirme
  const [results, setResults] = useState([])
  const [fb, setFb] = useState(null)
  const [ctx, setCtx] = useState(null) // oturum bağlamı: konu + materyal sayısı

  const [source, setSource] = useState(null)
  const [view, setView] = useState(null)
  const [pulse, setPulse] = useState(0)
  const [thread, setThread] = useState({ n: 0, key: '', delay: 520 })
  const scroller = useRef(null)

  const candidates = useMemo(() => candidateFiles(scope, topics), [scope, topics])
  const files = useMemo(() => new Set(candidates.filter((f) => !off.has(f))), [candidates, off])
  const pool = useMemo(() => buildPool(scope, mode, topics, files), [scope, mode, topics, files])
  const count = Math.min(amount, pool.length)

  const setScope = (s) => { setScopeState(s); setOff(new Set()) }

  const begin = useCallback((list, label, fileCount) => {
    setQs(list); setIdx(0); setPick(null); setText(''); setChecked(false); setEvaluating(false); setEv(null)
    setResults([]); setFb(null); setSource(null)
    setCtx({ label, fileCount })
    setPhase('session')
    scroller.current?.scrollTo({ top: 0 })
  }, [])

  const start = () => begin(pool.slice(0, count), scopeName(scope, topics), files.size)

  // Çalışma alanı / Analitik'ten gelen niyet
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    if (!i) return
    const group = i.topic && QUIZ_GROUPS.find((g) => g.topics?.includes(i.topic))
    const md = i.mode || 'mc'
    // Çalışma alanından gelen test, konunun ünitesi bağlamında açılır; ilk sorular o konudan seçilir.
    const sc = i.auto && group ? group.id : i.topic ? `topic:${i.topic}` : i.scope || 'avl'
    setScopeState(sc); setMode(md)
    if (i.auto) {
      const cand = candidateFiles(sc, topics)
      const list = buildPool(sc, md, topics, new Set(cand))
        .sort((a, b) => Number(b.topic === i.topic) - Number(a.topic === i.topic)).slice(0, 3)
      if (list.length) begin(list, scopeName(sc, topics), cand.length)
    } else if (i.topic) setAmount(3)
  }, [takeIntent, topics, begin])

  const q = qs[idx]
  const typed = q?.type === 'open' ? text.trim().length > 0 : pick !== null
  const stage = phase === 'summary' ? 'review' : source && checked ? 'source' : checked ? 'feedback' : typed ? 'answer' : 'practice'

  const record = useCallback((entry) => {
    dispatch({ type: 'ANSWER', topicId: entry.q.topic, correct: entry.correct })
    if (!entry.correct) dispatch({ type: 'REVIEW_ADD', topicId: entry.q.topic, from: 'quiz' })
    const t = topics.find((x) => x.id === entry.q.topic)
    const before = topicState(t.score)
    const nextScore = entry.correct ? Math.min(1, (t.score || 0.3) + 0.1) : Math.max(0.06, (t.score || 0.3) - 0.12)
    setFb({ before, after: topicState(nextScore), correct: entry.correct, topic: t.name })
    setResults((r) => [...r, entry])
    setChecked(true)
  }, [dispatch, topics])

  const check = useCallback(() => {
    if (!q || checked || evaluating) return
    if (q.type === 'open') {
      if (text.trim().length < 12) return
      setEvaluating(true)
      setTimeout(() => {
        const e = evaluate(q, text)
        setEv(e)
        setEvaluating(false)
        record({ q, text, correct: e.score >= 7, score: e.score, points: e.points })
      }, reduce ? 150 : 900)
      return
    }
    if (pick === null) return
    record({ q, pick, correct: pick === q.correct })
  }, [q, pick, text, checked, evaluating, reduce, record])

  const next = useCallback(() => {
    setSource(null)
    if (idx + 1 >= qs.length) { setPhase('summary'); scroller.current?.scrollTo({ top: 0 }); return }
    setIdx((i) => i + 1); setPick(null); setText(''); setChecked(false); setEv(null); setFb(null)
  }, [idx, qs.length])

  // Benzer soru: aynı konudan, henüz sorulmamış; yoksa aynı tipten
  const similar = useMemo(() => {
    if (!q) return null
    const used = new Set(qs.map((x) => x.id))
    const free = QUIZ_BANK.filter((x) => !used.has(x.id))
    return free.find((x) => x.topic === q.topic && x.type === q.type) || free.find((x) => x.topic === q.topic) || free.find((x) => x.type === q.type && QUIZ_GROUPS.find((g) => g.id === scope)?.topics?.includes(x.topic)) || null
  }, [q, qs, scope])
  const askSimilar = () => {
    if (!similar) return
    setQs((list) => [...list.slice(0, idx + 1), similar, ...list.slice(idx + 1)])
    setSource(null)
    setIdx((i) => i + 1); setPick(null); setText(''); setChecked(false); setEv(null); setFb(null)
  }

  // Kanıtı Kaynak Görüntüleyici'de aç (tüm soru tiplerinde aynı)
  const openEvidence = useCallback(({ id, text: label, cite, tag }) => {
    setSource({ id, cite, label, tag })
    setView({ doc: cite.doc, page: cite.page })
    setPulse((p) => p + 1)
    if (desktop && !reduce) setThread((t) => ({ n: t.n + 1, key: `quiz:${id}`, delay: source ? 340 : 560 }))
  }, [desktop, reduce, source])

  // Klavye: 1–4 seç, Enter kontrol et / sonraki (animasyonsuz)
  useEffect(() => {
    if (phase !== 'session') return
    const on = (e) => {
      if (e.target.closest('input, textarea')) return
      if (q && q.type !== 'open' && !checked && /^[1-4]$/.test(e.key) && Number(e.key) <= q.options.length) setPick(Number(e.key) - 1)
      if (e.key === 'Enter' && !e.target.closest('button:not([role=radio])')) {
        e.preventDefault()
        if (checked) next()
        else check()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [phase, checked, q, check, next])

  const active = source && { turnId: 'quiz', claim: { id: source.id, text: source.label, cites: [source.cite], tag: source.tag }, cite: source.cite }
  const viewer = (
    <SourceViewer
      view={view} setView={setView} active={active} evidence={source?.cite || null} pulse={pulse}
      nearest={null} scan={{ count: 14, groups: '' }} onClose={() => setSource(null)}
    />
  )
  const asideW = wide ? 500 : 420
  const ask = (question) => navigate('/dersler/veri-yapilari/calisma', { question })

  return (
    <div className="flex h-full min-w-0">
      <div ref={scroller} className="scroll-quiet min-w-0 flex-1 overflow-y-auto" data-scroll>
        <MobileBar />
        <div className={`mx-auto w-full px-5 pb-28 sm:px-10 ${phase === 'setup' ? 'max-w-[68rem]' : 'max-w-[44rem]'}`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              {phase === 'setup' && (
                <Setup
                  scope={scope} setScope={setScope} mode={mode} setMode={setMode} amount={amount} setAmount={setAmount}
                  candidates={candidates} files={files} off={off} setOff={setOff} pool={pool} count={count} topics={topics} onStart={start}
                />
              )}
              {phase === 'session' && q && (
                <Session
                  q={q} idx={idx} total={qs.length} ctx={ctx} stage={stage} reduce={reduce}
                  pick={pick} setPick={setPick} text={text} setText={setText} checked={checked} evaluating={evaluating} ev={ev} fb={fb}
                  results={results} onCheck={check} onNext={next} onEvidence={openEvidence} sourceId={source?.id}
                  similar={similar} onSimilar={askSimilar} onExplain={() => ask(`AVL ağaçlarında ${topics.find((t) => t.id === q.topic)?.name} nasıl çalışır?`)}
                  onExit={() => { setSource(null); setPhase('setup') }}
                />
              )}
              {phase === 'summary' && (
                <Summary
                  results={results} topics={topics} reduce={reduce} ctx={ctx}
                  onEvidence={openEvidence} onAgain={() => { setSource(null); setPhase('setup') }}
                  onAsk={ask} onThread={(id) => navigate('/analitik', { topic: id })}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {desktop ? (
        <AnimatePresence initial={false}>
          {source && (
            <motion.aside
              key="quiz-source"
              initial={{ width: 0 }}
              animate={{ width: asideW, transition: { duration: reduce ? 0.12 : 0.32, ease: EASE_DRAWER } }}
              exit={{ width: 0, transition: { duration: reduce ? 0.1 : 0.22, ease: EASE_DRAWER } }}
              className="shrink-0 overflow-hidden"
            >
              <div style={{ width: asideW }} className="h-full">{viewer}</div>
            </motion.aside>
          )}
        </AnimatePresence>
      ) : (
        <Sheet open={!!source} onClose={() => setSource(null)}>{viewer}</Sheet>
      )}
      <ThreadOverlay trigger={thread} enabled={desktop && !reduce} />
    </div>
  )
}

// ─── Kurulum ──────────────────────────────────────────────────────────────────
function Chip({ on, disabled, onClick, children, title }) {
  return (
    <button
      type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick} title={title}
      className={`press h-9 rounded-lg px-3.5 text-[14px] font-medium ${on ? 'bg-accent-tint text-accent' : disabled ? 'text-ink-3 opacity-55' : 'bg-ink/[0.05] text-ink-2 hover:bg-ink/[0.09] hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

function Setup({ scope, setScope, mode, setMode, amount, setAmount, candidates, files, off, setOff, pool, count, topics, onStart }) {
  const used = [...new Set(pool.slice(0, count).map((x) => x.topic))].map((id) => topics.find((t) => t.id === id)).filter(Boolean)
  const group = QUIZ_GROUPS.find((g) => g.id === scope)
  const modeInfo = QUIZ_MODES.find((m) => m.id === mode)
  const name = scopeName(scope, topics)
  const toggle = (f) => setOff((o) => { const n = new Set(o); if (n.has(f)) n.delete(f); else n.add(f); return n })

  return (
    <div className="pt-4 lg:pt-14">
      <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Ne çalışmak istersin?</h1>
      <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
        Sorular yalnızca yüklediğin materyallerden üretilir. Her cevap bir kaynak sayfasına bağlanır.
      </p>
      <p className="m-0 mt-5 text-[14px] text-ink-2" aria-live="polite" data-quiz-context>
        Veri Yapıları <span aria-hidden className="mx-1 text-ink-3">›</span> {name}
        <span aria-hidden className="mx-1 text-ink-3">›</span>
        <span className="font-medium text-ink">{files.size} materyal kullanılıyor</span>
      </p>

      <div className="mt-10 grid gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <form onSubmit={(e) => { e.preventDefault(); if (count) onStart() }} className="flex min-w-0 flex-col gap-9">
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[12.5px] font-medium text-ink-3">Ders</legend>
            <div role="radiogroup" aria-label="Ders" className="flex flex-wrap gap-2">
              {COURSES.map((c) => <Chip key={c.id} on={c.id === 'veri-yapilari'} disabled={c.id !== 'veri-yapilari'} title={c.id === 'veri-yapilari' ? '' : 'Bu prototipte kapalı'}>{c.name}</Chip>)}
            </div>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[12.5px] font-medium text-ink-3">Konu</legend>
            <div role="radiogroup" aria-label="Konu" className="flex flex-wrap gap-2">
              {QUIZ_GROUPS.map((g) => <Chip key={g.id} on={scope === g.id} onClick={() => setScope(g.id)}>{g.label}</Chip>)}
              {scope.startsWith('topic:') && <Chip on>{name}</Chip>}
            </div>
            <p className="m-0 mt-2 text-[13px] text-ink-3">{group?.hint || 'Analitik’ten seçtiğin konu'}</p>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[12.5px] font-medium text-ink-3">Soru tipi</legend>
            <div role="radiogroup" aria-label="Soru tipi" className="inline-flex flex-wrap gap-1 rounded-xl bg-ink/[0.05] p-1">
              {QUIZ_MODES.map((m) => (
                <button
                  key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                  className={`press h-9 rounded-lg px-4 text-[14px] font-medium ${mode === m.id ? 'bg-white text-ink shadow-[0_1px_2px_rgba(22,24,30,0.12)]' : 'text-ink-3 hover:text-ink'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="m-0 mt-2 text-[13px] text-ink-3">{modeInfo.hint}</p>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[12.5px] font-medium text-ink-3">Soru sayısı</legend>
            <div role="radiogroup" aria-label="Soru sayısı" className="inline-flex gap-1 rounded-xl bg-ink/[0.05] p-1">
              {QUIZ_AMOUNTS.map((n) => (
                <button
                  key={n} type="button" role="radio" aria-checked={amount === n} onClick={() => setAmount(n)}
                  className={`press h-9 min-w-14 rounded-lg px-4 font-mono text-[14px] font-medium ${amount === n ? 'bg-white text-ink shadow-[0_1px_2px_rgba(22,24,30,0.12)]' : 'text-ink-3 hover:text-ink'}`}
                >
                  {n}
                </button>
              ))}
            </div>
            {count > 0 && count < amount && <p className="m-0 mt-2 text-[13px] text-ink-3">Seçili materyallerde bu tipte {count} soru var.</p>}
          </fieldset>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Btn arrow className="group" type="submit" disabled={!count}>Alıştırmayı başla</Btn>
            {count ? (
              <span className="text-[13.5px] text-ink-3"><span className="num">{count}</span> {MODE_LABEL[mode].toLocaleLowerCase('tr')} soru · yaklaşık {Math.max(2, Math.round(count * (mode === 'open' ? 2.5 : 1.2)))} dk</span>
            ) : (
              <span className="text-[13.5px] text-gevesek">Bu konu, tip ve materyal seçiminde soru üretilemiyor.</span>
            )}
          </div>
        </form>

        <aside className="min-w-0 space-y-9 lg:pt-6" aria-label="Kullanılan materyaller">
          <div>
            <h2 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Kullanılan materyaller</h2>
            <ul className="m-0 list-none p-0">
              {candidates.map((f) => {
                const on = files.has(f)
                return (
                  <li key={f}>
                    <button
                      type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f)}
                      className="press -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-ink/[0.04]"
                    >
                      <span aria-hidden className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] transition-colors duration-150 ${on ? 'bg-accent text-white' : 'bg-ink/[0.08]'}`}>{on && <Check size={12} weight="bold" />}</span>
                      <FilePdf size={16} className="shrink-0 text-ink-3" aria-hidden />
                      <span className={`min-w-0 flex-1 truncate font-mono text-[12.5px] ${on ? 'font-medium text-ink' : 'text-ink-3'}`}>{f}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          {used.length > 0 && (
            <div>
              <h2 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Kapsanan konular</h2>
              <ul className="m-0 list-none p-0">
                {used.map((t) => {
                  const st = topicState(t.score)
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-1.5 text-[14px]">
                      <span className="min-w-0 truncate text-ink">{t.name}</span>
                      <span className={`shrink-0 text-[12.5px] ${st === 'tight' ? 'text-siki' : 'text-gevesek'}`}>{STATE_TEXT[st]}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// ─── Oturum ─────────────────────────────────────────────────────────────────
function Session(props) {
  const { q, idx, total, ctx, stage, reduce, results, onExit } = props
  const prog = Array.from({ length: total }, (_, i) => (i < results.length ? (results[i].correct ? 'tight' : 'loose') : 'open'))
  return (
    <div className="pt-4 lg:pt-12">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <button type="button" onClick={onExit} className="press -ml-2 rounded-md px-2 py-1 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">← Alıştırmayı bırak</button>
        <MiniThread states={prog} current={idx} gap={22} label={`Soru ${idx + 1} / ${total}`} />
      </div>
      <p className="m-0 mt-4 text-[13px] text-ink-3" data-quiz-context>
        Veri Yapıları <span aria-hidden>›</span> {ctx.label} <span aria-hidden>›</span> {ctx.fileCount} materyal kullanılıyor
      </p>
      <div className="mt-4"><Stepper stage={stage} /></div>

      <h1 className="display m-0 mt-10 text-[30px] text-ink sm:text-[34px]">{q.stem}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
        <span className="font-mono text-[12px] num">Soru {idx + 1} / {total}</span>
        <span aria-hidden>·</span>
        <span>{MODE_LABEL[q.type]}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5"><FilePdf size={14} aria-hidden /> {q.source}</span>
      </div>

      {q.type === 'open' ? <OpenAnswer {...props} /> : <Choices {...props} />}
    </div>
  )
}

function Actions({ q, checked, idx, total, onNext, similar, onSimilar, onEvidence, onExplain, evidenceTarget }) {
  return (
    <div className="mt-9 flex flex-wrap items-center gap-2.5">
      <Btn arrow className="group" onClick={onNext}>{idx + 1 >= total ? 'Sonucu gör' : 'Sonraki soru'}</Btn>
      <Btn variant="soft" onClick={() => onEvidence(evidenceTarget)}>Kaynağa dön</Btn>
      <Btn variant="soft" disabled={!similar} onClick={onSimilar} title={similar ? '' : 'Bu konuda başka soru kalmadı'}>Benzer soru çöz</Btn>
      <Btn variant="quiet" onClick={onExplain}>Konuyu tekrar açıkla</Btn>
    </div>
  )
}

function Choices({ q, idx, total, pick, setPick, checked, fb, reduce, onCheck, onNext, onEvidence, sourceId, similar, onSimilar, onExplain }) {
  const right = checked && pick === q.correct
  const tfLabels = ['D', 'Y']
  const target = { id: q.id, text: q.explanation, cite: q.cite, tag: 'Cevabı doğrulayan kaynak' }
  return (
    <>
      <div role="radiogroup" aria-label="Seçenekler" className={`mt-7 ${q.type === 'tf' ? 'grid grid-cols-2 gap-2' : 'space-y-2'}`}>
        {q.options.map((o, i) => {
          const sel = pick === i
          const isRight = checked && i === q.correct
          const isWrong = checked && sel && i !== q.correct
          return (
            <button
              key={o} type="button" role="radio" aria-checked={sel} disabled={checked} onClick={() => setPick(i)}
              className={`press flex w-full items-center gap-3.5 rounded-xl px-4 py-3.5 text-left text-[16px] disabled:cursor-default ${
                isRight ? 'bg-siki-tint text-ink' : isWrong ? 'bg-kopuk-tint text-ink' : sel ? 'bg-accent-tint text-ink' : checked ? 'bg-ink/[0.03] text-ink-3' : 'bg-ink/[0.045] text-ink hover:bg-ink/[0.08]'
              }`}
            >
              <span aria-hidden className={`grid size-6 shrink-0 place-items-center rounded-full font-mono text-[11.5px] font-semibold transition-colors duration-200 ${
                isRight ? 'bg-siki text-white' : isWrong ? 'bg-kopuk text-white' : sel ? 'bg-accent text-white' : 'bg-ink/[0.08] text-ink-2'
              }`}>
                {isRight ? <Check size={13} weight="bold" /> : isWrong ? <X size={13} weight="bold" /> : q.type === 'tf' ? tfLabels[i] : LETTERS[i]}
              </span>
              <span className="min-w-0 flex-1">{o}</span>
            </button>
          )
        })}
      </div>

      {!checked && (
        <div className="mt-6 flex items-center gap-3">
          <Btn disabled={pick === null} onClick={onCheck}>Cevabı kontrol et</Btn>
          <span className="hidden text-[12.5px] text-ink-3 sm:inline">{pick === null ? `${q.options.length === 2 ? '1–2' : '1–4'} ile seç, Enter ile onayla` : 'Enter'}</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {checked && fb && (
          <motion.section
            aria-live="polite" aria-label="Geri bildirim"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
            className="mt-10"
          >
            <h2 className={`display m-0 text-[28px] ${right ? 'text-siki' : 'text-kopuk'}`}>{right ? 'Doğru.' : 'Tam değil.'}</h2>
            <p className="m-0 mt-2 max-w-[36rem] text-[16.5px] leading-[1.65] text-ink">
              {!right && q.wrong?.[pick] && <>{q.wrong[pick]} </>}
              {q.explanation}
            </p>
            <EvidenceQuote q={q} sourceId={sourceId} onEvidence={onEvidence} target={target} />
            <KnowledgeNote fb={fb} />
            <Actions q={q} checked={checked} idx={idx} total={total} onNext={onNext} similar={similar} onSimilar={onSimilar} onEvidence={onEvidence} onExplain={onExplain} evidenceTarget={target} />
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

// Soru ↔ kaynak ilişkisi: kanıt, alıntı olarak ve tıklanabilir etiketle görünür.
function EvidenceQuote({ q, sourceId, onEvidence, target }) {
  return (
    <figure className="m-0 mt-6 max-w-[36rem]">
      <blockquote className="m-0 font-serif text-[17.5px] leading-[1.6] text-ink-2">
        <mark className="evidence" data-strength="full">{excerpt(q.cite)}</mark>
      </blockquote>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-3">
        <CitationPill turnId="quiz" claim={{ id: q.id }} cite={q.cite} active={sourceId === q.id} onActivate={() => onEvidence(target)} />
        <span className="font-mono text-[12px]">{docFile(q.cite.doc)} · sayfa {q.cite.page}</span>
      </figcaption>
    </figure>
  )
}

function KnowledgeNote({ fb }) {
  return (
    <div className="mt-8 flex max-w-[36rem] items-center gap-3.5" role="status">
      <MiniThread states={[fb.before, fb.after]} gap={30} label="Konu durumu" />
      <p className="m-0 text-[14px] leading-snug text-ink-2">
        <span className="font-medium text-ink">{fb.topic}</span>
        {' · '}
        {fb.correct
          ? (fb.after === 'tight' ? <span className="text-siki">ip sıkılaştı</span> : <span className="text-gevesek">biraz sıkılaştı, hâlâ gevşek</span>)
          : <span className="text-gevesek">eksik nokta · tekrar listesine eklendi</span>}
      </p>
    </div>
  )
}

// Açık uçlu: cevap yazılır, kaynak noktalarıyla karşılaştırılır, kanıtla değerlendirilir.
function OpenAnswer({ q, idx, total, text, setText, checked, evaluating, ev, fb, reduce, onCheck, onNext, onEvidence, sourceId, similar, onSimilar, onExplain }) {
  const good = ev ? ev.points.filter((p) => p.hit) : []
  const miss = ev ? ev.points.filter((p) => !p.hit) : []
  const segs = ev ? segmentAnswer(text, ev.points) : []
  const sentence = !ev ? '' : ev.score >= 8 ? 'Cevabın kaynakla büyük ölçüde örtüşüyor.' : ev.score >= 5 ? 'Ana fikri yakaladın; birkaç nokta eksik kaldı.' : 'Cevabın kaynaktaki temel noktalardan uzak kaldı.'
  const evTarget = (p, hit) => ({ id: `${q.id}-${p.id}`, text: p.label, cite: p.cite, tag: hit ? 'Cevabını destekleyen kaynak' : 'Eksik nokta' })
  const first = miss[0] || good[0]
  const states = ev ? ev.points.map((p) => (p.hit ? 'tight' : 'open')) : []

  return (
    <>
      <div className="mt-7">
        <label htmlFor="open-answer" className="sr-only">Cevabın</label>
        <textarea
          id="open-answer" value={text} readOnly={checked || evaluating} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onCheck() } }}
          rows={checked ? 1 : 6} placeholder="Cevabını kendi cümlelerinle yaz…"
          className={`block w-full resize-none rounded-2xl bg-white p-4 text-[16px] leading-[1.65] text-ink shadow-[0_1px_2px_rgba(22,24,30,0.06),0_0_0_1px_rgba(22,24,30,0.07)] outline-none transition-shadow duration-150 placeholder:text-ink-3 focus:shadow-[0_0_0_2px_var(--color-accent)] ${checked ? 'sr-only' : ''}`}
        />
      </div>

      {!checked && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn disabled={text.trim().length < 12 || evaluating} onClick={onCheck}>{evaluating ? 'Kaynaklarla karşılaştırılıyor…' : 'Cevabı gönder'}</Btn>
          <span className="text-[12.5px] text-ink-3">{text.trim().length < 12 ? 'En az bir cümle yaz.' : 'Ctrl/⌘ + Enter'}</span>
        </div>
      )}

      <AnimatePresence initial={false}>
        {checked && ev && fb && (
          <motion.section
            aria-live="polite" aria-label="Değerlendirme"
            initial={{ opacity: 0, y: reduce ? 0 : 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_OUT } }}
            className="mt-2"
          >
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <h2 className="m-0 text-[12.5px] font-medium text-ink-3">Değerlendirme</h2>
                <p className="display m-0 mt-1 text-[52px] leading-none text-ink" aria-label={`${ev.score} üzerinden 10`}><span className="num">{ev.score}</span> <span className="text-ink-3">/ 10</span></p>
              </div>
              <div className="pb-1.5">
                <MiniThread states={states} gap={34} label="Kaynak noktaları" />
                <p className="m-0 mt-1.5 text-[14px] text-ink-2">{sentence} {good.length}/{ev.points.length} kaynak noktası cevabında var.</p>
              </div>
            </div>

            <div className="mt-8">
              <h3 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Cevabın · kaynakla örtüşen kısımlar işaretli</h3>
              <p className="m-0 max-w-[38rem] text-[16.5px] leading-[1.7] text-ink">
                {segs.map((s, i) => s.id ? (
                  <button
                    key={i} type="button" data-supported={s.id}
                    onClick={() => { const p = ev.points.find((x) => x.id === s.id); onEvidence(evTarget(p, true)) }}
                    className="press rounded-[3px] bg-siki-tint px-0.5 text-ink underline decoration-siki/50 decoration-2 underline-offset-[5px] hover:bg-[#d6ecdf]"
                    title="Bu kısmı destekleyen kaynağı aç"
                  >{s.t}</button>
                ) : <span key={i}>{s.t}</span>)}
              </p>
            </div>

            <div className="mt-8 grid gap-x-12 gap-y-6 sm:grid-cols-2">
              <div>
                <h3 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Güçlü nokta</h3>
                {good.length ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {good.map((p) => <li key={p.id} className="text-[15.5px] leading-[1.55] text-ink">“{p.strong}”</li>)}
                  </ul>
                ) : <p className="m-0 text-[15px] text-ink-2">Bu cevapta kaynakla örtüşen bir nokta bulunamadı.</p>}
              </div>
              <div>
                <h3 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Eksik nokta</h3>
                {miss.length ? (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {miss.map((p) => <li key={p.id} className="text-[15.5px] leading-[1.55] text-ink">“{p.miss}”</li>)}
                  </ul>
                ) : <p className="m-0 text-[15px] text-ink-2">Kaynaktaki tüm noktaları kapsadın.</p>}
              </div>
            </div>

            <div className="mt-9">
              <h3 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Kanıt</h3>
              <ul className="m-0 list-none p-0">
                {ev.points.map((p) => {
                  const t = evTarget(p, p.hit)
                  return (
                    <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-t border-hair py-3 first:border-t-0">
                      <div className="min-w-0">
                        <p className="m-0 text-[15px] text-ink">
                          <span className={p.hit ? 'text-siki' : 'text-gevesek'}>{p.hit ? '✓' : '○'}</span> {p.label}
                        </p>
                        {!p.hit && <p className="m-0 mt-1 font-serif text-[15.5px] leading-[1.55] text-ink-2">Kaynakta: “{excerpt(p.cite)}”</p>}
                        <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{p.hit ? 'Cevabını destekler' : 'Cevabında eksik'}</p>
                      </div>
                      <CitationPill turnId="quiz" claim={{ id: t.id }} cite={p.cite} active={sourceId === t.id} onActivate={() => onEvidence(t)} />
                    </li>
                  )
                })}
              </ul>
            </div>

            <KnowledgeNote fb={fb} />
            <Actions q={q} checked idx={idx} total={total} onNext={onNext} similar={similar} onSimilar={onSimilar} onEvidence={onEvidence} onExplain={onExplain} evidenceTarget={evTarget(first, first.hit)} />
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── Sonuç ────────────────────────────────────────────────────────────────────
function Summary({ results, topics, reduce, ctx, onEvidence, onAgain, onAsk, onThread }) {
  const correct = results.filter((r) => r.correct).length
  const weak = []
  results.forEach((r) => {
    if (r.q.type === 'open') r.points.filter((p) => !p.hit).forEach((p) => weak.push({ topic: r.q.topic, label: p.label, cite: p.cite, id: `${r.q.id}-${p.id}` }))
    else if (!r.correct) weak.push({ topic: r.q.topic, label: topics.find((t) => t.id === r.q.topic)?.name, cite: r.q.cite, id: r.q.id })
  })
  const weakTopics = [...new Set(weak.map((w) => w.topic))]
  const names = weakTopics.map((id) => topics.find((t) => t.id === id)?.name)

  return (
    <div className="pt-4 lg:pt-14">
      <div className="mb-8"><Stepper stage="review" /></div>
      <h1 className="display m-0 text-[44px] text-ink sm:text-[56px]"><span className="num">{correct}</span> / <span className="num">{results.length}</span> yeterli cevap.</h1>
      <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
        {names.length === 0
          ? 'Her cevabın kaynağıyla örtüştü. İpin sıkılaştı.'
          : `${names.join(' ve ')} konusunda ipin hâlâ gevşek. Eksik kalan noktaların kaynağı aşağıda.`}
      </p>
      <p className="m-0 mt-2 text-[13px] text-ink-3">{ctx.label} · {ctx.fileCount} materyal kullanıldı</p>

      <section className="mt-12" aria-label="Sorular">
        <h2 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Sorular ve kaynakları</h2>
        <ul className="m-0 list-none p-0">
          {results.map((r, i) => {
            const target = { id: r.q.id, text: r.q.explanation || r.q.model, cite: r.q.cite, tag: 'Soru kaynağı' }
            return (
              <motion.li
                key={`${r.q.id}-${i}`}
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.26, delay: reduce ? 0 : 0.04 * i, ease: EASE_OUT } }}
                className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 border-t border-hair py-3.5 first:border-t-0"
              >
                <span aria-label={r.correct ? 'Yeterli' : 'Eksik'} className={`mt-1 grid size-[18px] place-items-center rounded-full text-white ${r.correct ? 'bg-siki' : 'bg-gevesek'}`}>
                  {r.correct ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[15.5px] leading-snug text-ink">{r.q.stem}</p>
                  <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
                    {MODE_LABEL[r.q.type]}
                    {r.q.type === 'open' && <span className="font-mono text-ink-2"><span className="num">{r.score}</span> / 10</span>}
                    <CitationPill turnId="quiz" claim={{ id: r.q.id }} cite={r.q.cite} active={false} onActivate={() => onEvidence(target)} />
                  </p>
                </div>
              </motion.li>
            )
          })}
        </ul>
      </section>

      {weak.length > 0 && (
        <section className="mt-12" aria-label="Tekrar edilecekler">
          <h2 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Eksik kalan noktalar</h2>
          <ul className="m-0 list-none p-0">
            {weak.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hair py-3.5 first:border-t-0">
                <span className="min-w-0">
                  <span className="block text-[15.5px] font-medium text-ink">{w.label}</span>
                  <span className="block text-[13px] text-gevesek">{topics.find((t) => t.id === w.topic)?.name} · tekrar listesinde</span>
                </span>
                <CitationPill turnId="quiz" claim={{ id: `sum-${w.id}` }} cite={w.cite} active={false} onActivate={() => onEvidence({ id: `sum-${w.id}`, text: w.label, cite: w.cite, tag: 'Eksik nokta' })} />
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn variant="soft" size="sm" onClick={() => onAsk(`AVL ağaçlarında ${names[0]} nasıl çalışır?`)}>Çalışma alanında açıkla</Btn>
            <Btn variant="quiet" size="sm" onClick={() => onThread(weakTopics[0])}>İpte gör</Btn>
          </div>
        </section>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Btn arrow className="group" onClick={onAgain}>Yeni alıştırma</Btn>
        <TextLink className="text-[14px]" onClick={() => onThread(null)}>Bilgi İpini aç</TextLink>
      </div>
    </div>
  )
}
