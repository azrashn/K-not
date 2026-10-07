import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Compass, Exam, Lightbulb, ListMagnifyingGlass, TreeStructure, CaretRight } from '@phosphor-icons/react'
import { EASE_OUT } from '../lib/motion'
import { useApp } from '../app/store'
import { QUIZ_MODES } from '../data/academic'
import { DOCS } from '../data/mock'
import CitationPill from './Citation'
import { analyze } from './KnotStrength'

const ACTIONS = {
  hint: { label: 'İpucu ver', desc: 'Cevabı hemen vermeden, adım adım kendin bulmanı sağlayan ipuçları.', Icon: Compass },
  simple: { label: 'Basitçe açıkla', desc: 'Aynı kaynaklarla daha sade bir anlatım.', Icon: Lightbulb },
  test: { label: 'Bunu test et', desc: 'Bu yanıtın kaynaklarından soru üret; cevabını kanıtla değerlendir.', Icon: Exam },
  gaps: { label: 'Eksik noktaları göster', desc: 'Kaynaklarında olup bu yanıtta yer almayanlar.', Icon: ListMagnifyingGlass },
  nearby: { label: 'Yakın bir konuyu sor', desc: 'Materyallerinde karşılığı olan en yakın konuya geç.', Icon: TreeStructure },
}

export default function NextSteps({ turnId, scenario, onActivate, activeId }) {
  const reduce = useReducedMotion()
  const [mode, setMode] = useState(null)

  const recommended = { SIKI: 'test', GEVESEK: 'gaps', KOPUK: 'nearby' }[analyze(scenario.claims).state]
  const choose = (id) => {
    if (id === 'nearby') return scenario.onNearby?.()
    setMode((m) => (m === id ? null : id))
  }
  const pseudo = (item, tag) => ({ id: item.id, text: item.text, cites: item.cites || [item.cite], tag })

  return (
    <section className="mt-12" aria-label="Sonraki adım">
      <h3 className="m-0 mb-1.5 text-[12.5px] font-medium tracking-normal text-ink-3">Sonraki adım</h3>
      <ul className="m-0 list-none p-0">
        {scenario.actions.map((id) => {
          const { label, desc, Icon } = ACTIONS[id]
          const on = mode === id
          const rec = id === recommended
          return (
            <li key={id}>
              <button
                type="button"
                aria-expanded={id === 'nearby' ? undefined : on}
                onClick={() => choose(id)}
                className="press group -mx-3 flex w-[calc(100%+1.5rem)] items-center gap-3.5 rounded-xl px-3 py-2.5 text-left hover:bg-ink/[0.035]"
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors duration-200 ${rec || on ? 'bg-accent-tint text-accent' : 'bg-ink/[0.05] text-ink-2'}`}>
                  <Icon size={18} weight={on ? 'fill' : 'regular'} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`text-[15px] font-medium ${rec ? 'text-accent' : 'text-ink'}`}>{label}</span>
                    {rec && <span className="font-mono text-[10.5px] font-medium uppercase tracking-wider text-accent">Önerilen</span>}
                  </span>
                  <span className="block text-[13px] leading-snug text-ink-3">{desc}</span>
                </span>
                <CaretRight size={14} aria-hidden className={`shrink-0 text-ink-3 transition-transform duration-200 ease-out ${on ? 'rotate-90' : 'group-hover:translate-x-0.5'}`} />
              </button>

              <AnimatePresence initial={false}>
                {on && (
                  <motion.div
                    key={id}
                    initial={{ opacity: 0, y: reduce ? 0 : -4 }}
                    animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    className="mb-3 mt-1 rounded-2xl bg-surface shadow-[0_1px_2px_rgba(22,24,30,0.04),0_0_0_1px_rgba(22,24,30,0.035)]"
                  >
                    {id === 'hint' && <Hints scenario={scenario} turnId={turnId} onActivate={onActivate} activeId={activeId} pseudo={pseudo} reduce={reduce} />}
                    {id === 'simple' && (
                      <Rows title="Basit anlatım" note="Aynı kaynaklara dayanır; yeni bilgi eklenmedi." items={scenario.simple} turnId={turnId} tag="Basit anlatım" onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
                    )}
                    {id === 'gaps' && (
                      <Rows title="Kaynaklarında olup yanıtta yer almayanlar" items={scenario.gaps} turnId={turnId} tag="Eksik nokta" onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
                    )}
                    {id === 'test' && <TestModes scenario={scenario} />}
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// İpucu ver: Sokratik akış. Cevap verilmez; her adımda biraz daha yönlendirilir, son adım kaynağa götürür.
function Hints({ scenario, turnId, onActivate, activeId, pseudo, reduce }) {
  const hints = scenario.hints || []
  const [step, setStep] = useState(1)
  const done = step >= hints.length
  const first = scenario.claims[0]

  return (
    <div className="p-5">
      <h4 className="m-0 text-[14px] font-semibold text-ink">Cevaba kendin ulaş</h4>
      <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">Cevabı hemen vermiyorum. Önce düşün; hazır olunca bir sonraki ipucuna geç.</p>

      <ol className="m-0 mt-4 list-none p-0">
        {hints.slice(0, step).map((h, i) => {
          const claim = pseudo({ id: `${turnId}-hint-${i}`, text: h.text, cite: h.cite }, 'İpucu')
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
              className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 py-2.5"
            >
              <span aria-hidden className="mt-0.5 grid size-6 place-items-center rounded-full bg-accent-tint font-mono text-[11px] font-semibold text-accent">{i + 1}</span>
              <p className="m-0 text-[15.5px] leading-[1.6] text-ink">
                {h.text}
                {h.cite && (
                  <span className="ml-2 whitespace-nowrap">
                    <CitationPill turnId={turnId} claim={claim} cite={h.cite} active={activeId === claim.id} onActivate={() => onActivate(claim, h.cite)} />
                  </span>
                )}
              </p>
            </motion.li>
          )
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!done ? (
          <button type="button" onClick={() => setStep((n) => n + 1)} className="press h-9 rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-white hover:bg-accent-deep">
            Bir sonraki ipucu <span className="ml-1 font-mono text-[12px] text-white/70">{step}/{hints.length}</span>
          </button>
        ) : (
          <button type="button" onClick={() => onActivate(first, first.cites?.[0])} className="press h-9 rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-white hover:bg-accent-deep">
            Cevabın kanıtını göster
          </button>
        )}
        {step > 1 && <button type="button" onClick={() => setStep(1)} className="press h-9 rounded-lg px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/[0.05]">Baştan</button>}
      </div>
    </div>
  )
}

function Rows({ title, note, items, turnId, tag, onActivate, activeId, pseudo }) {
  return (
    <div className="p-5">
      <h4 className="m-0 text-[14px] font-semibold text-ink">{title}</h4>
      {note && <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{note}</p>}
      <ul className="m-0 mt-2 list-none p-0">
        {items.map((it, i) => {
          const claim = pseudo(it, tag)
          return (
            <li key={it.id} className={`py-3 ${i ? 'border-t border-hair' : ''}`}>
              <p className="m-0 text-[15.5px] leading-[1.62] text-ink">
                {it.text}
                {it.cites?.map((c) => (
                  <span key={c.seg} className="ml-2 whitespace-nowrap">
                    <CitationPill turnId={turnId} claim={claim} cite={c} active={activeId === claim.id} onActivate={() => onActivate(claim, c)} />
                  </span>
                ))}
                {it.missing && (
                  <span className="ml-2 inline-flex h-[22px] items-center whitespace-nowrap rounded-[5px] bg-kopuk-tint px-1.5 align-middle font-mono text-[11px] font-medium text-kopuk">
                    Materyallerde yok
                  </span>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Bunu test et: yanıtın konusundan pratiğe geçer. Soru tipi seçilir, Quiz bağlamıyla açılır.
function TestModes({ scenario }) {
  const { navigate, topics } = useApp()
  const topic = topics.find((t) => t.id === scenario.quiz?.topic)
  const files = new Set(scenario.claims.flatMap((c) => c.cites.map((x) => DOCS[x.doc]?.filename))).size
  return (
    <div className="p-5">
      <h4 className="m-0 text-[14px] font-semibold text-ink">Nasıl test edelim?</h4>
      <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">
        Veri Yapıları · {topic?.name} · {files} materyal kullanılıyor. Sorular bu kaynaklardan üretilir.
      </p>
      <ul className="m-0 mt-3 list-none p-0">
        {QUIZ_MODES.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => navigate('/quiz', { topic: scenario.quiz.topic, mode: m.id, auto: true, from: 'workspace' })}
              className="press group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-ink/[0.04]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-ink">{m.label}</span>
                <span className="block text-[12.5px] text-ink-3">{m.hint}</span>
              </span>
              <CaretRight size={14} aria-hidden className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
