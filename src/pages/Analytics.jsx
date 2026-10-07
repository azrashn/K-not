import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { COVERAGE, STATE_TEXT, topicState } from '../data/academic'
import { useApp } from '../app/store'
import { excerpt, docFile } from '../lib/docs'
import { PageFrame, Btn, Section } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { KnowledgeThread } from '../components/Threads'
import CitationPill from '../components/Citation'
import { EASE_OUT } from '../lib/motion'

const SENTENCE = {
  tight: (t) => `${t.name} sağlam. ${t.answered} sorunun ${t.correct}’ini doğru yanıtladın.`,
  loose: (t) => `İpin burada gevşek. ${t.answered} sorunun ${t.correct}’ini doğru yanıtladın; bir iki nokta oturmamış.`,
  weak: (t) => `İpin burada zayıf. ${t.answered} sorunun yalnızca ${t.correct}’ini doğru yanıtladın.`,
  open: () => 'Bu konuyu henüz çalışmadın. Slaytlar hazır; bir soruyla başlayabilirsin.',
}

export default function Analytics() {
  const reduce = useReducedMotion()
  const { topics, review, navigate, dispatch, takeIntent } = useApp()
  const studied = topics.filter((t) => t.score > 0)
  const weakest = useMemo(() => [...studied].sort((a, b) => a.score - b.score)[0], [studied])

  const [sel, setSel] = useState(null)
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    setSel(i?.topic || null)
  }, [takeIntent])
  const selected = topics.find((t) => t.id === (sel || weakest?.id)) || topics[0]
  const st = topicState(selected.score)

  const counts = { tight: 0, loose: 0, open: 0 }
  topics.forEach((t) => { const s = topicState(t.score); counts[s === 'weak' ? 'loose' : s]++ })
  const reviewTopics = review.map((r) => topics.find((t) => t.id === r.topicId)).filter(Boolean)
  const queue = [...new Map([...reviewTopics, ...studied.filter((t) => ['loose', 'weak'].includes(topicState(t.score))).sort((a, b) => a.score - b.score)].map((t) => [t.id, t])).values()].slice(0, 4)
  const inQueue = review.some((r) => r.topicId === selected.id)

  return (
    <PageFrame>
      <MobileBar />
      <header className="grid items-end gap-x-12 gap-y-6 pb-10 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:pt-14">
        <div>
          <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Bilgi İpin</h1>
          <p className="m-0 mt-3 max-w-[38rem] text-[19px] leading-snug text-ink-2" style={{ letterSpacing: '-0.012em' }}>
            <span className="text-siki font-medium">{counts.tight} konuda</span> ipin gergin,{' '}
            <span className="text-gevesek font-medium">{counts.loose} konuda</span> gevşek.
            {counts.open > 0 && <> {counts.open} konu henüz bağlanmadı.</>}
          </p>
        </div>
        {weakest && topicState(weakest.score) !== 'tight' && (
          <div className="lg:text-right">
            <p className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Önerilen sonraki adım</p>
            <Btn arrow className="group" onClick={() => navigate('/quiz', { topic: weakest.id })}>{weakest.name} için 3 soru</Btn>
          </div>
        )}
      </header>

      <KnowledgeThread topics={topics} selectedId={selected.id} onSelect={setSel} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={selected.id}
          aria-label={`${selected.name} ayrıntısı`}
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        >
          <div>
            <h2 className="display m-0 text-[32px] text-ink sm:text-[38px]">{selected.name}</h2>
            <p className={`m-0 mt-2 text-[13.5px] font-medium ${st === 'tight' ? 'text-siki' : st === 'open' ? 'text-ink-3' : 'text-gevesek'}`}>{STATE_TEXT[st]} <span className="font-normal text-ink-3">· {selected.week}</span></p>
            <p className="m-0 mt-3 max-w-[32rem] text-[16.5px] leading-relaxed text-ink-2">{SENTENCE[st](selected)}</p>

            {selected.cite && (
              <figure className="m-0 mt-7 max-w-[34rem]">
                <p className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Bu konunun kaynağı</p>
                <blockquote className="m-0 font-serif text-[17px] leading-[1.6] text-ink-2">
                  <mark className="evidence" key={selected.id} data-strength="full">{excerpt(selected.cite)}</mark>
                </blockquote>
                <figcaption className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px] text-ink-3">
                  <CitationPill
                    turnId="analytics" claim={{ id: selected.id }} cite={selected.cite} active={false}
                    onActivate={() => navigate('/dersler/veri-yapilari/calisma', { open: { cite: selected.cite, text: excerpt(selected.cite), tag: selected.name } })}
                  />
                  <span className="font-mono text-[12px]">{docFile(selected.cite.doc)}</span>
                </figcaption>
              </figure>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-2.5">
              <Btn arrow className="group" onClick={() => navigate('/quiz', { topic: selected.id })}>{st === 'open' ? 'İlk sorularla başla' : 'Bu konudan quiz'}</Btn>
              <Btn variant="soft" onClick={() => navigate('/dersler/veri-yapilari/calisma', { question: `AVL ağaçlarında ${selected.name} nasıl çalışır?` })}>Çalışma alanında sor</Btn>
              {st !== 'tight' && st !== 'open' && (
                <Btn variant="quiet" disabled={inQueue} onClick={() => dispatch({ type: 'REVIEW_ADD', topicId: selected.id, from: 'analytics' })}>
                  {inQueue ? 'Tekrar listesinde' : 'Tekrar listesine ekle'}
                </Btn>
              )}
            </div>
          </div>

          <Section title="Önce bunları tekrar et">
            {queue.length === 0 ? (
              <p className="m-0 py-3 text-[15px] text-ink-2">Tekrar bekleyen konu yok. İpin gergin.</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {queue.map((t, i) => {
                  const s = topicState(t.score)
                  return (
                    <li key={t.id} className={i ? 'border-t border-hair' : ''}>
                      <button type="button" onClick={() => setSel(t.id)} className="press -mx-3 flex w-[calc(100%+1.5rem)] items-baseline gap-4 rounded-xl px-3 py-3 text-left hover:bg-ink/[0.035]">
                        <span className="w-4 shrink-0 font-mono text-[12px] text-ink-3">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium text-ink">{t.name}</span>
                          <span className="block text-[12.5px] text-ink-3">{STATE_TEXT[s]}{t.cite && <> · <span className="font-mono">{t.cite.label}</span></>}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </Section>
        </motion.section>
      </AnimatePresence>

      <section className="mt-20 max-w-[44rem]" aria-label="Kaynak kapsamı">
        <h2 className="m-0 text-[12.5px] font-medium text-ink-3">Kaynakla desteklenen ilerleme</h2>
        <p className="m-0 mt-1.5 text-[14.5px] leading-relaxed text-ink-2">Bir sayfa, bir yanıtta ya da quiz sorusunda kaynak olarak göründüğünde çalışılmış sayılır.</p>
        <ul className="m-0 mt-4 list-none p-0">
          {COVERAGE.map((c) => (
            <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t border-hair py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.5rem]">
              <span className="truncate font-mono text-[12.5px] text-ink" title={c.name}>{c.name}</span>
              <span className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07] sm:col-span-1 sm:row-start-auto" aria-hidden>
                <motion.span
                  className="block h-full origin-left rounded-full bg-accent"
                  style={{ width: `${(c.used / c.total) * 100}%` }}
                  initial={{ scaleX: reduce ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }}
                />
              </span>
              <span className="text-right font-mono text-[12px] text-ink-3 num">{c.used} / {c.total} s.</span>
            </li>
          ))}
        </ul>
      </section>
    </PageFrame>
  )
}
