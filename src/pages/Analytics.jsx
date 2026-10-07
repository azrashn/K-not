import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { COVERAGE, STATE_TEXT, UNITS, topicState } from '../data/academic'
import { useApp } from '../app/store'
import { excerpt, docFile } from '../lib/docs'
import { PageFrame, Btn, TextLink } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { UnitThread } from '../components/Threads'
import CitationPill from '../components/Citation'
import { EASE_OUT } from '../lib/motion'

const SENTENCE = {
  tight: (t) => `Burada ipin gergin. ${t.answered} sorunun ${t.correct}’ini doğru yanıtladın.`,
  loose: (t) => `İpin burada gevşek. ${t.answered} sorunun ${t.correct}’ini doğru yanıtladın; bir iki nokta oturmamış.`,
  weak: (t) => `İpin burada zayıf. ${t.answered} sorunun yalnızca ${t.correct}’ini doğru yanıtladın.`,
  open: () => 'Bu konuyu henüz çalışmadın. Materyali hazır; bir soruyla başlayabilirsin.',
}

const TABS = [
  { id: 'learn', label: 'Öğrenmem' },
  { id: 'trust', label: 'Kaynak güveni' },
]

export default function Analytics() {
  const reduce = useReducedMotion()
  const { topics, takeIntent } = useApp()
  const [tab, setTab] = useState('learn')
  const [sel, setSel] = useState(null)
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    if (i?.topic) setSel(i.topic)
    if (i?.tab) setTab(i.tab)
  }, [takeIntent])

  return (
    <PageFrame>
      <MobileBar />
      <header className="pb-8 pt-4 lg:pt-14">
        <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Analitik</h1>
        <div role="tablist" aria-label="Analitik bölümleri" className="mt-6 inline-flex gap-1 rounded-xl bg-ink/[0.05] p-1">
          {TABS.map((t) => (
            <button
              key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
              className={`press h-9 rounded-lg px-4 text-[14px] font-medium ${tab === t.id ? 'bg-white text-ink shadow-[0_1px_2px_rgba(22,24,30,0.12)]' : 'text-ink-3 hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab} role="tabpanel"
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          {tab === 'learn' ? <Learning sel={sel} setSel={setSel} /> : <SourceTrust />}
        </motion.div>
      </AnimatePresence>
    </PageFrame>
  )
}

// ─── A. ÖĞRENMEM: ne anlıyorum? ─────────────────────────────────────────────────
function Learning({ sel, setSel }) {
  const reduce = useReducedMotion()
  const { topics, review, navigate, dispatch } = useApp()
  const studied = topics.filter((t) => t.score > 0)
  const weakest = useMemo(() => [...studied].sort((a, b) => a.score - b.score)[0], [studied])
  const selected = topics.find((t) => t.id === (sel || weakest?.id)) || topics[0]
  const st = topicState(selected.score)
  const inQueue = review.some((r) => r.topicId === selected.id)

  const counts = { tight: 0, loose: 0, open: 0 }
  topics.forEach((t) => { const s = topicState(t.score); counts[s === 'weak' ? 'loose' : s]++ })
  const queue = [...new Map([...review.map((r) => topics.find((t) => t.id === r.topicId)).filter(Boolean), ...studied.filter((t) => ['loose', 'weak'].includes(topicState(t.score))).sort((a, b) => a.score - b.score)].map((t) => [t.id, t])).values()].slice(0, 4)

  return (
    <>
      <div className="grid items-end gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <h2 className="display m-0 text-[32px] text-ink sm:text-[38px]">Ne anlıyorum?</h2>
          <p className="m-0 mt-2 max-w-[38rem] text-[18px] leading-snug text-ink-2" style={{ letterSpacing: '-0.012em' }}>
            <span className="font-medium text-siki">{counts.tight} konuda</span> ipin gergin,{' '}
            <span className="font-medium text-gevesek">{counts.loose} konuda</span> gevşek.
            {counts.open > 0 && <> {counts.open} konu henüz bağlanmadı.</>}
          </p>
        </div>
        {weakest && topicState(weakest.score) !== 'tight' && (
          <Btn arrow className="group" onClick={() => navigate('/quiz', { topic: weakest.id })}>{weakest.name} için 3 soru</Btn>
        )}
      </div>

      <ul className="m-0 mt-10 list-none p-0" aria-label="Üniteler">
        {UNITS.map((u) => {
          const list = u.topics.map((id) => topics.find((t) => t.id === id))
          const worst = [...list].filter((t) => t.score > 0).sort((a, b) => a.score - b.score)[0]
          const allOpen = list.every((t) => t.score <= 0)
          const bad = worst && topicState(worst.score) !== 'tight'
          return (
            <li key={u.id} className="grid items-center gap-x-8 gap-y-2 border-t border-hair py-4 first:border-t-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="display m-0 text-[22px] text-ink">{u.name}</p>
                <p className={`m-0 text-[13px] ${allOpen ? 'text-ink-3' : bad ? 'text-gevesek' : 'text-siki'}`}>
                  {allOpen ? 'Henüz çalışılmadı' : list.length === 1 ? STATE_TEXT[topicState(worst.score)] : bad ? `En zayıf: ${worst.name}` : 'Tüm konular sıkı'}
                </p>
              </div>
              <div className="scroll-quiet -mx-1 overflow-x-auto px-1">
                <UnitThread unit={u} topics={topics} selectedId={selected.id} onSelect={setSel} />
              </div>
            </li>
          )
        })}
      </ul>

      <AnimatePresence mode="wait" initial={false}>
        <motion.section
          key={selected.id}
          aria-label={`${selected.name} ayrıntısı`}
          initial={{ opacity: 0, y: reduce ? 0 : 8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          className="mt-12 grid gap-x-16 gap-y-10 border-t border-hair pt-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
        >
          <div>
            <h3 className="display m-0 text-[30px] text-ink sm:text-[36px]">{selected.name}</h3>
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
              <Btn arrow className="group" onClick={() => navigate('/quiz', { topic: selected.id })}>{st === 'open' ? 'İlk sorularla başla' : 'Bu konudan alıştırma'}</Btn>
              <Btn variant="soft" onClick={() => navigate('/dersler/veri-yapilari/calisma', { question: `AVL ağaçlarında ${selected.name} nasıl çalışır?` })}>Çalışma alanında sor</Btn>
              {st !== 'tight' && st !== 'open' && (
                <Btn variant="quiet" disabled={inQueue} onClick={() => dispatch({ type: 'REVIEW_ADD', topicId: selected.id, from: 'analytics' })}>
                  {inQueue ? 'Tekrar listesinde' : 'Tekrar listesine ekle'}
                </Btn>
              )}
            </div>
          </div>

          <div>
            <h3 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Önce bunları tekrar et</h3>
            {queue.length === 0 ? (
              <p className="m-0 py-3 text-[15px] text-ink-2">Tekrar bekleyen konu yok. İpin gergin.</p>
            ) : (
              <ol className="m-0 list-none p-0">
                {queue.map((t, i) => (
                  <li key={t.id} className={i ? 'border-t border-hair' : ''}>
                    <button type="button" onClick={() => setSel(t.id)} className="press -mx-3 flex w-[calc(100%+1.5rem)] items-baseline gap-4 rounded-xl px-3 py-3 text-left hover:bg-ink/[0.035]">
                      <span className="w-4 shrink-0 font-mono text-[12px] text-ink-3">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">{t.name}</span>
                        <span className="block text-[12.5px] text-ink-3">{STATE_TEXT[topicState(t.score)]}{t.cite && <> · <span className="font-mono">{t.cite.label}</span></>}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </motion.section>
      </AnimatePresence>
    </>
  )
}

// ─── B. KAYNAK GÜVENİ: öğrenmem materyallerimle ne kadar destekleniyor? ──────────
function SourceTrust() {
  const reduce = useReducedMotion()
  const { stats, unsupported, navigate } = useApp()
  const total = stats.full + stats.partial + stats.none
  const rows = [
    { id: 'full', n: stats.full, label: 'Kaynakla desteklenen', note: 'Her iddia bir sayfaya bağlıydı.', color: 'bg-siki', text: 'text-siki' },
    { id: 'partial', n: stats.partial, label: 'Kısmen desteklenen', note: 'Bir kısmı için kanıt yetersizdi.', color: 'bg-gevesek', text: 'text-gevesek' },
    { id: 'none', n: stats.none, label: 'Desteksiz kalan', note: 'Materyallerinde kanıt bulunamadı.', color: 'bg-kopuk', text: 'text-kopuk' },
  ]
  return (
    <>
      <h2 className="display m-0 text-[32px] text-ink sm:text-[38px]">Materyallerim beni ne kadar destekliyor?</h2>
      <p className="m-0 mt-2 max-w-[40rem] text-[18px] leading-snug text-ink-2" style={{ letterSpacing: '-0.012em' }}>
        Son sorularında <span className="num font-medium text-ink">{total}</span> yanıtın <span className="num font-medium text-siki">{stats.full}</span>’i tamamen kaynaklıydı.
        {stats.none > 0 && <> <span className="num font-medium text-kopuk">{stats.none}</span> soru için materyallerinde kanıt yoktu.</>}
      </p>

      <div className="mt-10" role="img" aria-label={`${stats.full} kaynaklı, ${stats.partial} kısmi, ${stats.none} desteksiz yanıt`}>
        <div className="flex h-2 gap-[3px] overflow-hidden rounded-full">
          {rows.map((r) => (
            <motion.span
              key={r.id} className={`block h-full rounded-full ${r.color}`}
              initial={false} animate={{ flexGrow: Math.max(r.n, 0.4) }} transition={{ duration: reduce ? 0 : 0.5, ease: EASE_OUT }}
              style={{ flexBasis: 0 }}
            />
          ))}
        </div>
      </div>
      <dl className="m-0 mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.id} data-trust={r.id}>
            <dd className={`display m-0 text-[44px] leading-none ${r.text}`}><span className="num">{r.n}</span></dd>
            <dt className="mt-2 text-[15px] font-medium text-ink">{r.label}</dt>
            <dd className="m-0 mt-0.5 text-[13.5px] text-ink-3">{r.note}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 mt-5 text-[12.5px] text-ink-3">Prototip verisi: sayılar örnek geçmişle başlar, bu oturumda sorduklarınla güncellenir.</p>

      <section className="mt-16" aria-label="Kanıt bulunamayan sorular">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="m-0 text-[12.5px] font-medium text-ink-3">Kanıt bulunamayan sorular</h3>
          <TextLink className="text-[12.5px]" onClick={() => navigate('/dersler/veri-yapilari', { upload: true })}>Materyal ekle</TextLink>
        </div>
        <ul className="m-0 mt-1 list-none p-0">
          {unsupported.length === 0 && <li className="py-3 text-[15px] text-ink-2">Her sorunun materyallerinde bir karşılığı vardı.</li>}
          {unsupported.map((u, i) => (
            <li key={`${u.question}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-hair py-3 first:border-t-0">
              <span className="text-[15.5px] text-ink">{u.question}</span>
              <span className="text-[13px] text-ink-3">{u.when} · materyallerinde yok</span>
            </li>
          ))}
        </ul>
        <p className="m-0 mt-2 max-w-[36rem] text-[13.5px] leading-relaxed text-ink-3">Bu sorulara K-not cevap uydurmadı. İlgili bir materyal eklersen aynı soru kaynağa bağlanabilir.</p>
      </section>

      <section className="mt-16 max-w-[44rem]" aria-label="Kaynak kapsamı">
        <h3 className="m-0 text-[12.5px] font-medium text-ink-3">Hangi materyaller kanıt oldu?</h3>
        <p className="m-0 mt-1.5 text-[14.5px] leading-relaxed text-ink-2">Bir sayfa, bir yanıtta ya da değerlendirmede kaynak olarak göründüğünde kullanılmış sayılır.</p>
        <ul className="m-0 mt-4 list-none p-0">
          {COVERAGE.map((c) => (
            <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t border-hair py-3 first:border-t-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.5rem]">
              <span className="truncate font-mono text-[12.5px] text-ink" title={c.name}>{c.name}</span>
              <span className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-ink/[0.07] sm:col-span-1 sm:row-start-auto" aria-hidden>
                <motion.span className="block h-full origin-left rounded-full bg-accent" style={{ width: `${(c.used / c.total) * 100}%` }} initial={{ scaleX: reduce ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease: EASE_OUT }} />
              </span>
              <span className="text-right font-mono text-[12px] text-ink-3 num">{c.used} / {c.total} s.</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
