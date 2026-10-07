import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Exam, Lightbulb, ListMagnifyingGlass, Check, X, ArrowsClockwise, CalendarCheck, TreeStructure, CaretRight } from '@phosphor-icons/react'
import { LOOP_STAGES } from '../data/mock'
import { EASE_OUT } from '../lib/motion'
import { useApp } from '../app/store'
import CitationPill from './Citation'

const ACTIONS = {
  test: { label: 'Bunu test et', desc: 'Bu cevaptan bir soru üret, yanıtını kaynağıyla kontrol et.', Icon: Exam, tag: 'Alıştırma' },
  simple: { label: 'Basitçe açıkla', desc: 'Aynı kaynaklarla daha sade bir anlatım.', Icon: Lightbulb, tag: 'Basit anlatım' },
  gaps: { label: 'Eksik noktaları göster', desc: 'Kaynaklarında olup bu yanıtta yer almayanlar.', Icon: ListMagnifyingGlass, tag: 'Eksik nokta' },
  nearby: { label: 'Yakın bir konuyu sor', desc: 'Materyallerinde karşılığı olan en yakın konuya geç.', Icon: TreeStructure, tag: '' },
}

function LoopStepper({ stage }) {
  const idx = LOOP_STAGES.findIndex((s) => s.id === stage)
  return (
    <ol aria-label="Öğrenme döngüsü" className="m-0 flex list-none items-center gap-1 p-0 text-[12px]">
      {LOOP_STAGES.map((s, i) => {
        const done = i < idx
        const now = i === idx
        return (
          <li key={s.id} className="flex items-center gap-1" aria-current={now ? 'step' : undefined}>
            {i > 0 && <span aria-hidden className={`h-px w-2.5 transition-colors duration-300 sm:w-4 ${done || now ? 'bg-accent' : 'bg-line-strong'}`} />}
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

export default function NextSteps({ turnId, scenario, onActivate, activeId }) {
  const reduce = useReducedMotion()
  const { dispatch } = useApp()
  const [mode, setMode] = useState(null)
  const [pick, setPick] = useState(null)
  const [checked, setChecked] = useState(false)
  const [added, setAdded] = useState(false)

  const stage = mode !== 'test' ? 'ask' : added ? 'review' : checked ? 'feedback' : pick ? 'answer' : 'practice'
  const recommended = scenario.knot.state === 'SIKI' ? 'test' : scenario.knot.state === 'GEVESEK' ? 'gaps' : 'nearby'

  const choose = (id) => {
    if (id === 'nearby') return scenario.onNearby?.()
    setMode((m) => (m === id ? null : id))
    setPick(null); setChecked(false); setAdded(false)
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
                    {id === 'simple' && (
                      <Rows title="Basit anlatım" note="Aynı kaynaklara dayanır; yeni bilgi eklenmedi." items={scenario.simple} turnId={turnId} tag="Basit anlatım" onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
                    )}
                    {id === 'gaps' && (
                      <Rows title="Kaynaklarında olup yanıtta yer almayanlar" items={scenario.gaps} turnId={turnId} tag="Eksik nokta" onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
                    )}
                    {id === 'test' && (
                      <Practice
                        p={scenario.practice} pick={pick} setPick={setPick} checked={checked} stage={stage}
                        onCheck={() => {
                          setChecked(true)
                          if (scenario.practice.topic) dispatch({ type: 'ANSWER', topicId: scenario.practice.topic, correct: pick === scenario.practice.correct })
                        }}
                        added={added}
                        onAdd={() => {
                          setAdded(true)
                          if (scenario.practice.topic) dispatch({ type: 'REVIEW_ADD', topicId: scenario.practice.topic, from: 'workspace' })
                        }}
                        turnId={turnId} onActivate={onActivate} activeId={activeId} pseudo={pseudo}
                        onReset={() => { setPick(null); setChecked(false); setAdded(false) }}
                      />
                    )}
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

function Practice({ p, pick, setPick, checked, stage, onCheck, added, onAdd, turnId, onActivate, activeId, pseudo, onReset }) {
  const right = pick === p.correct
  const picked = p.options.find((o) => o.id === pick)
  const claim = pseudo({ id: `${turnId}-practice`, text: p.explanation, cite: p.cite }, 'Alıştırma')

  return (
    <div className="p-5">
      <LoopStepper stage={stage} />
      <h4 className="m-0 mt-4 text-[16px] font-semibold leading-snug text-ink" style={{ letterSpacing: '-0.015em' }}>{p.prompt}</h4>
      <div role="radiogroup" aria-label="Seçenekler" className="mt-3 grid gap-2 sm:grid-cols-2">
        {p.options.map((o) => {
          const sel = pick === o.id
          const isRight = checked && o.id === p.correct
          const isWrong = checked && sel && o.id !== p.correct
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={sel}
              disabled={checked}
              onClick={() => setPick(o.id)}
              className={`press flex h-11 items-center justify-between rounded-[10px] px-3.5 text-left font-mono text-[14px] font-medium disabled:cursor-default ${
                isRight ? 'bg-siki-tint text-siki'
                  : isWrong ? 'bg-kopuk-tint text-kopuk'
                    : sel ? 'bg-accent-tint text-accent'
                      : checked ? 'bg-ink/[0.03] text-ink-3'
                        : 'bg-ink/[0.045] text-ink hover:bg-ink/[0.08]'
              }`}
            >
              {o.id}
              {isRight && <Check size={16} weight="bold" aria-hidden />}
              {isWrong && <X size={16} weight="bold" aria-hidden />}
            </button>
          )
        })}
      </div>

      {!checked && (
        <div className="mt-3.5 flex items-center gap-3">
          <button
            type="button"
            disabled={!pick}
            onClick={onCheck}
            className="press h-9 rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-white hover:bg-accent-deep disabled:bg-ink/10 disabled:text-ink-3"
          >
            Cevabı kontrol et
          </button>
          {!pick && <span className="text-[12.5px] text-ink-3">Bir seçenek işaretle.</span>}
        </div>
      )}

      <AnimatePresence initial={false}>
        {checked && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
            className="mt-5 border-t border-hair pt-4"
            aria-live="polite"
          >
            <p className={`m-0 text-[15px] font-semibold ${right ? 'text-siki' : 'text-kopuk'}`}>
              {right ? 'Doğru.' : 'Tam değil.'}{' '}
              <span className="font-normal text-ink">{right ? '' : picked?.hint}</span>
            </p>
            <p className="m-0 mt-1.5 text-[15.5px] leading-[1.62] text-ink">
              {p.explanation}
              <span className="ml-2 whitespace-nowrap">
                <CitationPill turnId={turnId} claim={claim} cite={p.cite} active={activeId === claim.id} onActivate={() => onActivate(claim, p.cite)} />
              </span>
            </p>
            <div className="mt-4">
              {!added ? (
                <button type="button" onClick={onAdd} className="press inline-flex h-9 items-center gap-2 rounded-lg bg-ink/[0.05] px-3 text-[13.5px] font-medium text-ink hover:bg-ink/[0.09]">
                  <ArrowsClockwise size={16} aria-hidden /> Tekrar listesine ekle
                </button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] bg-siki-tint px-3.5 py-2.5"
                >
                  <span className="inline-flex items-center gap-2 text-[13.5px] font-medium text-siki">
                    <CalendarCheck size={17} aria-hidden /> Tekrar kartı oluşturuldu
                  </span>
                  <span className="text-[13px] text-ink-2">
                    <span className="font-mono text-[12.5px]">{p.review}</span> · 2 gün sonra hatırlatılacak
                  </span>
                  <button type="button" onClick={onReset} className="press ml-auto text-[13px] font-medium text-accent underline underline-offset-4 hover:text-accent-deep">
                    Yeniden dene
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
