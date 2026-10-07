import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, X, FilePdf, ArrowRight } from '@phosphor-icons/react'
import { COURSES, QUIZ_AMOUNTS, QUIZ_BANK, QUIZ_SCOPES, STATE_TEXT, topicState } from '../data/academic'
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

const EXAM_IDS = ['q1', 'q5', 'q6', 'q8']
const STAGES = [
  { id: 'practice', label: 'Alıştır' },
  { id: 'answer', label: 'Cevapla' },
  { id: 'feedback', label: 'Geri bildirim' },
  { id: 'source', label: 'Kaynak' },
  { id: 'review', label: 'Tekrar' },
]
const LETTERS = ['A', 'B', 'C', 'D']

function poolFor(scope, topics) {
  const rank = (id) => topics.find((t) => t.id === id)?.score ?? 1
  if (scope === 'weak') {
    const weak = topics.filter((t) => ['loose', 'weak'].includes(topicState(t.score))).map((t) => t.id)
    const pool = QUIZ_BANK.filter((q) => weak.includes(q.topic)).sort((a, b) => rank(a.topic) - rank(b.topic))
    return pool.length ? pool : QUIZ_BANK
  }
  if (scope.startsWith('topic:')) {
    const pool = QUIZ_BANK.filter((q) => q.topic === scope.slice(6))
    return pool.length ? pool : QUIZ_BANK
  }
  if (scope === 'exam') return QUIZ_BANK.filter((q) => EXAM_IDS.includes(q.id))
  return QUIZ_BANK
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
  const [scope, setScope] = useState('all')
  const [amount, setAmount] = useState(5)
  const [qs, setQs] = useState([])
  const [idx, setIdx] = useState(0)
  const [pick, setPick] = useState(null)
  const [checked, setChecked] = useState(false)
  const [results, setResults] = useState([])
  const [fb, setFb] = useState(null) // geri bildirim: önceki/sonraki konu durumu

  // Kaynak paneli
  const [source, setSource] = useState(null) // { q }
  const [view, setView] = useState(null)
  const [pulse, setPulse] = useState(0)
  const [thread, setThread] = useState({ n: 0, key: '', delay: 520 })
  const scroller = useRef(null)

  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    if (i?.scope) setScope(i.scope)
    if (i?.topic) { setScope(`topic:${i.topic}`); setAmount(3) }
  }, [takeIntent])

  const pool = useMemo(() => poolFor(scope, topics), [scope, topics])
  const count = Math.min(amount, pool.length)
  const scopeLabel = scope.startsWith('topic:')
    ? topics.find((t) => t.id === scope.slice(6))?.name
    : QUIZ_SCOPES.find((s) => s.id === scope)?.label

  const start = () => {
    setQs(pool.slice(0, count))
    setIdx(0); setPick(null); setChecked(false); setResults([]); setFb(null); setSource(null)
    setPhase('session')
    scroller.current?.scrollTo({ top: 0 })
  }

  const q = qs[idx]
  const stage = phase === 'summary' ? 'review' : source && checked ? 'source' : checked ? 'feedback' : pick !== null ? 'answer' : 'practice'

  const check = useCallback(() => {
    if (!q || pick === null || checked) return
    const correct = pick === q.correct
    const t = topics.find((x) => x.id === q.topic)
    const before = topicState(t.score)
    const nextScore = correct ? Math.min(1, (t.score || 0.3) + 0.1) : Math.max(0.06, (t.score || 0.3) - 0.12)
    setFb({ before, after: topicState(nextScore), correct, topic: t.name })
    dispatch({ type: 'ANSWER', topicId: q.topic, correct })
    if (!correct) dispatch({ type: 'REVIEW_ADD', topicId: q.topic, from: 'quiz' })
    setResults((r) => [...r, { q, pick, correct }])
    setChecked(true)
  }, [q, pick, checked, topics, dispatch])

  const next = useCallback(() => {
    setSource(null)
    if (idx + 1 >= qs.length) { setPhase('summary'); scroller.current?.scrollTo({ top: 0 }); return }
    setIdx((i) => i + 1); setPick(null); setChecked(false); setFb(null)
  }, [idx, qs.length])

  const openSource = useCallback((question) => {
    const text = excerpt(question.cite)
    setSource({ q: question, text })
    setView({ doc: question.cite.doc, page: question.cite.page })
    setPulse((p) => p + 1)
    if (desktop && !reduce) setThread((t) => ({ n: t.n + 1, key: `quiz:${question.id}`, delay: source ? 340 : 560 }))
  }, [desktop, reduce, source])

  // Klavye: 1–4 seç, Enter kontrol et / sonraki (animasyonsuz)
  useEffect(() => {
    if (phase !== 'session') return
    const on = (e) => {
      if (e.target.closest('input, textarea')) return
      if (!checked && /^[1-4]$/.test(e.key) && q && Number(e.key) <= q.options.length) setPick(Number(e.key) - 1)
      if (e.key === 'Enter' && !e.target.closest('button:not([role=radio])')) {
        e.preventDefault()
        if (checked) next()
        else check()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [phase, checked, q, check, next])

  const active = source && { turnId: 'quiz', claim: { id: source.q.id, text: source.text || source.q.explanation, cites: [source.q.cite], tag: 'Quiz kaynağı' }, cite: source.q.cite }
  const viewer = (
    <SourceViewer
      view={view} setView={setView} active={active} evidence={source?.q.cite || null} pulse={pulse}
      nearest={null} scan={{ count: 14, groups: '' }}
      onClose={() => setSource(null)}
    />
  )
  const asideW = wide ? 500 : 420

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
              {phase === 'setup' && <Setup scope={scope} setScope={setScope} amount={amount} setAmount={setAmount} pool={pool} count={count} topics={topics} onStart={start} scopeLabel={scopeLabel} />}
              {phase === 'session' && q && (
                <Session
                  q={q} idx={idx} total={qs.length} pick={pick} setPick={setPick} checked={checked} fb={fb} stage={stage}
                  results={results} onCheck={check} onNext={next} onSource={openSource} sourceOpen={!!source} reduce={reduce}
                  onExit={() => { setSource(null); setPhase('setup') }}
                />
              )}
              {phase === 'summary' && (
                <Summary
                  results={results} topics={topics} reduce={reduce}
                  onSource={openSource} onAgain={() => { setSource(null); setPhase('setup') }}
                  onAsk={(question) => navigate('/dersler/veri-yapilari/calisma', { question })}
                  onThread={(id) => navigate('/analitik', { topic: id })}
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
function Radio({ on, disabled, onClick, title, hint }) {
  return (
    <button
      type="button" role="radio" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`press -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-3.5 rounded-xl px-3 py-2.5 text-left disabled:opacity-45 ${on ? 'bg-accent-tint' : 'hover:bg-ink/[0.035] disabled:hover:bg-transparent'}`}
    >
      <span aria-hidden className={`mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full transition-colors duration-200 ${on ? 'bg-accent text-white' : 'bg-ink/[0.08]'}`}>
        {on && <Check size={11} weight="bold" />}
      </span>
      <span className="min-w-0">
        <span className={`block text-[15.5px] font-medium ${on ? 'text-accent' : 'text-ink'}`}>{title}</span>
        {hint && <span className="block text-[13px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </button>
  )
}

function Setup({ scope, setScope, amount, setAmount, pool, count, topics, onStart, scopeLabel }) {
  const files = useMemo(() => {
    const m = new Map()
    pool.slice(0, count).forEach((q) => {
      const f = docFile(q.cite.doc)
      m.set(f, [...(m.get(f) || []), q.cite.page])
    })
    return [...m].map(([f, pages]) => ({ f, pages: [...new Set(pages)].sort((a, b) => a - b) }))
  }, [pool, count])
  const used = [...new Set(pool.slice(0, count).map((q) => q.topic))].map((id) => topics.find((t) => t.id === id)).filter(Boolean)

  return (
    <div className="pt-4 lg:pt-14">
      <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Ne çalışmak istersin?</h1>
      <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
        Sorular yalnızca yüklediğin materyallerden üretilir. Her cevap, bir kaynak sayfasına bağlanır.
      </p>

      <div className="mt-12 grid gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <form onSubmit={(e) => { e.preventDefault(); onStart() }} className="flex min-w-0 flex-col gap-10">
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 p-0 text-[12.5px] font-medium text-ink-3">Ders</legend>
            <div role="radiogroup" aria-label="Ders" className="flex flex-wrap gap-2">
              {COURSES.map((c) => {
                const on = c.id === 'veri-yapilari'
                return (
                  <button
                    key={c.id} type="button" role="radio" aria-checked={on} disabled={!on}
                    title={on ? '14 materyal hazır' : 'Bu prototipte kapalı'}
                    className={`press h-9 rounded-lg px-3.5 text-[14px] font-medium ${on ? 'bg-accent-tint text-accent' : 'text-ink-3 opacity-60'}`}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[12.5px] font-medium text-ink-3">Kapsam</legend>
            <div role="radiogroup" aria-label="Kapsam">
              {QUIZ_SCOPES.map((s) => (
                <Radio key={s.id} on={scope === s.id} onClick={() => setScope(s.id)} title={s.label} hint={s.hint} />
              ))}
              {scope.startsWith('topic:') && <Radio on onClick={() => {}} title={scopeLabel} hint="Analitik’ten seçtiğin konu" />}
            </div>
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
            {count < amount && <p className="m-0 mt-2 text-[13px] text-ink-3">Bu kapsamda {count} soru var.</p>}
          </fieldset>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <Btn arrow className="group" type="submit">Alıştırmayı başla</Btn>
            <span className="text-[13.5px] text-ink-3"><span className="num">{count}</span> soru · yaklaşık {Math.max(2, Math.round(count * 1.2))} dk</span>
          </div>
        </form>

        <aside className="min-w-0 space-y-9 lg:pt-6" aria-label="Kapsam özeti">
          <div>
            <h2 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Şu kaynaklardan üretilir</h2>
            <ul className="m-0 list-none p-0">
              {files.map(({ f, pages }) => (
                <li key={f} className="flex items-start gap-3 border-t border-hair py-3 first:border-t-0">
                  <FilePdf size={18} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[12.5px] font-medium text-ink">{f}</span>
                    <span className="block text-[12.5px] text-ink-3">sayfa {pages.join(', ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
        </aside>
      </div>
    </div>
  )
}

// ─── Oturum ─────────────────────────────────────────────────────────────────
function Session({ q, idx, total, pick, setPick, checked, fb, stage, results, onCheck, onNext, onSource, sourceOpen, reduce, onExit }) {
  const right = checked && pick === q.correct
  const prog = Array.from({ length: total }, (_, i) => (i < results.length ? (results[i].correct ? 'tight' : 'loose') : 'open'))
  const text = excerpt(q.cite)

  return (
    <div className="pt-4 lg:pt-12">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <button type="button" onClick={onExit} className="press -ml-2 rounded-md px-2 py-1 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">← Alıştırmayı bırak</button>
        <MiniThread states={prog} current={idx} gap={22} label={`Soru ${idx + 1} / ${total}`} />
      </div>
      <div className="mt-5"><Stepper stage={stage} /></div>

      <h1 className="display m-0 mt-10 text-[30px] text-ink sm:text-[34px]">{q.stem}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
        <span className="font-mono text-[12px] num">Soru {idx + 1} / {total}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5"><FilePdf size={14} aria-hidden /> {q.source}</span>
      </div>


      <div role="radiogroup" aria-label="Seçenekler" className="mt-7 space-y-2">
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
                {isRight ? <Check size={13} weight="bold" /> : isWrong ? <X size={13} weight="bold" /> : q.tf ? (i ? 'Y' : 'D') : LETTERS[i]}
              </span>
              <span className="min-w-0 flex-1">{o}</span>
            </button>
          )
        })}
      </div>

      {!checked && (
        <div className="mt-6 flex items-center gap-3">
          <Btn disabled={pick === null} onClick={onCheck}>Cevabı kontrol et</Btn>
          <span className="hidden text-[12.5px] text-ink-3 sm:inline">{pick === null ? '1–4 ile seç, Enter ile onayla' : 'Enter'}</span>
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

            {/* Soru ↔ kaynak ilişkisi: kanıt, alıntı olarak burada da görünür */}
            <figure className="m-0 mt-6 max-w-[36rem]">
              <blockquote className="m-0 font-serif text-[17.5px] leading-[1.6] text-ink-2">
                <mark className="evidence" data-strength="full">{text}</mark>
              </blockquote>
              <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-3">
                <CitationPill turnId="quiz" claim={{ id: q.id }} cite={q.cite} active={sourceOpen} onActivate={() => onSource(q)} />
                <span className="font-mono text-[12px]">{docFile(q.cite.doc)} · sayfa {q.cite.page}</span>
              </figcaption>
            </figure>

            {/* Bilgi durumu: yanlış ya da gevşek kalan konu görünür olur */}
            <div className="mt-8 flex items-center gap-3.5 max-w-[36rem]" role="status">
              <MiniThread states={[fb.before, fb.after]} gap={30} label="Konu durumu" />
              <p className="m-0 text-[14px] leading-snug text-ink-2">
                <span className="font-medium text-ink">{fb.topic}</span>
                {' · '}
                {fb.correct
                  ? (fb.after === 'tight' ? <span className="text-siki">ip sıkılaştı</span> : <span className="text-gevesek">biraz sıkılaştı, hâlâ gevşek</span>)
                  : <span className="text-gevesek">eksik nokta · tekrar listesine eklendi</span>}
              </p>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Btn arrow className="group" onClick={onNext}>{idx + 1 >= total ? 'Sonucu gör' : 'Sonraki soru'}</Btn>
              {!sourceOpen && <Btn variant="quiet" onClick={() => onSource(q)}>Kaynak sayfayı aç</Btn>}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Sonuç ────────────────────────────────────────────────────────────────────
function Summary({ results, topics, reduce, onSource, onAgain, onAsk, onThread }) {
  const correct = results.filter((r) => r.correct).length
  const wrongTopics = [...new Set(results.filter((r) => !r.correct).map((r) => r.q.topic))]
  const names = wrongTopics.map((id) => topics.find((t) => t.id === id)?.name)

  return (
    <div className="pt-4 lg:pt-14">
      <div className="mb-8"><Stepper stage="review" /></div>
      <h1 className="display m-0 text-[44px] text-ink sm:text-[56px]"><span className="num">{correct}</span> / <span className="num">{results.length}</span> doğru.</h1>
      <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
        {names.length === 0
          ? 'Her soruyu kaynağıyla birlikte doğru yanıtladın. İpin sıkılaştı.'
          : `${names.join(' ve ')} konusunda ipin hâlâ gevşek. Aşağıdaki sayfalara bir daha bak.`}
      </p>

      <section className="mt-12" aria-label="Sorular">
        <h2 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Sorular ve kaynakları</h2>
        <ul className="m-0 list-none p-0">
          {results.map((r, i) => (
            <motion.li
              key={r.q.id}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.26, delay: reduce ? 0 : 0.04 * i, ease: EASE_OUT } }}
              className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3 border-t border-hair py-3.5 first:border-t-0"
            >
              <span aria-label={r.correct ? 'Doğru' : 'Yanlış'} className={`mt-1 grid size-[18px] place-items-center rounded-full text-white ${r.correct ? 'bg-siki' : 'bg-kopuk'}`}>
                {r.correct ? <Check size={11} weight="bold" /> : <X size={11} weight="bold" />}
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[15.5px] leading-snug text-ink">{r.q.stem}</p>
                <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
                  {topics.find((t) => t.id === r.q.topic)?.name}
                  <CitationPill turnId="quiz" claim={{ id: r.q.id }} cite={r.q.cite} active={false} onActivate={() => onSource(r.q)} />
                </p>
              </div>
            </motion.li>
          ))}
        </ul>
      </section>

      {wrongTopics.length > 0 && (
        <section className="mt-12" aria-label="Tekrar edilecekler">
          <h2 className="m-0 mb-1 text-[12.5px] font-medium text-ink-3">Tekrar edilecekler</h2>
          <ul className="m-0 list-none p-0">
            {wrongTopics.map((id) => {
              const t = topics.find((x) => x.id === id)
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hair py-4 first:border-t-0">
                  <span>
                    <span className="block text-[16px] font-medium text-ink">{t.name}</span>
                    <span className="block text-[13px] text-gevesek">{STATE_TEXT[topicState(t.score)]} · tekrar listesinde</span>
                  </span>
                  <span className="flex gap-2">
                    <Btn variant="soft" size="sm" onClick={() => onAsk(`AVL ağaçlarında ${t.name} nasıl çalışır?`)}>Çalışma alanında açıkla</Btn>
                    <Btn variant="quiet" size="sm" onClick={() => onThread(id)}>İpte gör</Btn>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <div className="mt-12 flex flex-wrap items-center gap-3">
        <Btn arrow className="group" onClick={onAgain}>Yeni alıştırma</Btn>
        <TextLink className="text-[14px]" onClick={() => onThread(null)}>Bilgi İpini aç <ArrowRight size={13} className="inline" /></TextLink>
      </div>
    </div>
  )
}
