import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Exam, Lightbulb, ListMagnifyingGlass, Check, X, ArrowsClockwise, CalendarCheck, TreeStructure } from '@phosphor-icons/react'
import { LOOP_STAGES } from '../data/mock'
import { EASE_OUT } from '../lib/motion'
import CitationPill from './Citation'

const ACTIONS = {
  test: { label: 'Bunu test et', Icon: Exam },
  simple: { label: 'Basitçe açıkla', Icon: Lightbulb },
  gaps: { label: 'Eksik noktaları göster', Icon: ListMagnifyingGlass },
  nearby: { label: 'Yakın bir konuyu sor', Icon: TreeStructure },
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
            {i > 0 && <span aria-hidden className={`h-px w-3 transition-colors duration-300 sm:w-4 ${done || now ? 'bg-accent' : 'bg-line-strong'}`} />}
            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors duration-200 ${now ? 'text-ink' : done ? 'text-accent' : 'text-ink-3'}`}>
              <span aria-hidden className={`size-[7px] rounded-full border transition-colors duration-200 ${now ? 'border-accent bg-accent' : done ? 'border-accent bg-accent-tint' : 'border-line-strong bg-transparent'}`} />
              <span className={i === idx ? '' : 'max-sm:hidden'}>{s.label}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function NextSteps({ turnId, scenario, onActivate, activeId }) {
  const reduce = useReducedMotion()
  const [mode, setMode] = useState(null) // test | simple | gaps
  const [pick, setPick] = useState(null)
  const [checked, setChecked] = useState(false)
  const [added, setAdded] = useState(false)

  const stage = mode !== 'test' ? 'ask' : added ? 'review' : checked ? 'feedback' : pick ? 'answer' : 'practice'

  const choose = (id) => {
    if (id === 'nearby') return scenario.onNearby?.()
    setMode((m) => (m === id ? null : id))
    setPick(null); setChecked(false); setAdded(false)
  }

  // Panel içindeki kanıt etiketleri de ana akışla aynı Citation → Source davranışını taşır.
  const pseudo = (item) => ({ id: item.id, text: item.text, cites: item.cites || [item.cite] })

  return (
    <div className="mt-6">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <h3 className="m-0 text-[13.5px] font-semibold text-ink">Sonraki adım</h3>
        {scenario.actions[0] !== 'nearby' && <LoopStepper stage={stage} />}
      </div>

      <div className="flex flex-wrap gap-2">
        {scenario.actions.map((id) => {
          const { label, Icon } = ACTIONS[id]
          const on = mode === id
          return (
            <button
              key={id}
              type="button"
              aria-pressed={id === 'nearby' ? undefined : on}
              onClick={() => choose(id)}
              className={`press inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13.5px] font-medium ${
                on ? 'border-accent bg-accent-tint text-accent' : 'border-line-strong bg-white text-ink hover:border-ink-3'
              }`}
            >
              <Icon size={16} aria-hidden /> {label}
            </button>
          )
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {mode && (
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="mt-3 rounded-xl border border-line-strong bg-white"
          >
            {mode === 'simple' && (
              <Rows title="Basit anlatım" note="Aynı kaynaklara dayanır; yeni bilgi eklenmedi." items={scenario.simple} turnId={turnId} onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
            )}
            {mode === 'gaps' && (
              <Rows title="Kaynaklarında olup yanıtta yer almayanlar" items={scenario.gaps} turnId={turnId} onActivate={onActivate} activeId={activeId} pseudo={pseudo} />
            )}
            {mode === 'test' && (
              <Practice
                p={scenario.practice} pick={pick} setPick={setPick} checked={checked}
                onCheck={() => setChecked(true)} added={added} onAdd={() => setAdded(true)}
                turnId={turnId} onActivate={onActivate} activeId={activeId} pseudo={pseudo}
                onReset={() => { setPick(null); setChecked(false); setAdded(false) }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Rows({ title, note, items, turnId, onActivate, activeId, pseudo }) {
  return (
    <div className="p-4 sm:p-5">
      <h4 className="m-0 mb-1 text-[14px] font-semibold text-ink">{title}</h4>
      {note && <p className="m-0 mb-1 text-[12.5px] text-ink-3">{note}</p>}
      <ul className="m-0 list-none p-0">
        {items.map((it, i) => {
          const claim = pseudo(it)
          return (
            <li key={it.id} className={`py-3 ${i ? 'border-t border-line' : ''}`}>
              <p className="m-0 text-[15px] leading-[1.6] text-ink">
                {it.text}
                {it.cites?.map((c) => (
                  <span key={c.seg} className="ml-2 whitespace-nowrap">
                    <CitationPill turnId={turnId} claim={claim} cite={c} active={activeId === claim.id} onActivate={() => onActivate(claim, c)} />
                  </span>
                ))}
                {it.missing && (
                  <span className="ml-2 inline-flex h-[22px] items-center whitespace-nowrap rounded-md border border-dashed border-kopuk-line px-1.5 align-middle font-mono text-[11.5px] font-medium text-kopuk">
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

function Practice({ p, pick, setPick, checked, onCheck, added, onAdd, turnId, onActivate, activeId, pseudo, onReset }) {
  const right = pick === p.correct
  const picked = p.options.find((o) => o.id === pick)
  const claim = pseudo({ id: `${turnId}-practice`, text: p.explanation, cite: p.cite })

  return (
    <div className="p-4 sm:p-5">
      <h4 className="m-0 text-[15px] font-semibold leading-snug text-ink">{p.prompt}</h4>
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
              className={`press flex h-11 items-center justify-between rounded-lg border px-3 text-left font-mono text-[14px] font-medium disabled:cursor-default ${
                isRight ? 'border-siki bg-siki-tint text-siki'
                  : isWrong ? 'border-kopuk bg-kopuk-tint text-kopuk'
                    : sel ? 'border-accent bg-accent-tint text-accent'
                      : checked ? 'border-line bg-paper text-ink-3'
                        : 'border-line-strong bg-white text-ink hover:border-ink-3'
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
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            disabled={!pick}
            onClick={onCheck}
            className="press h-9 rounded-lg bg-accent px-4 text-[13.5px] font-semibold text-white hover:bg-accent-deep disabled:bg-line-strong disabled:text-ink-3"
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
            className="mt-4 border-t border-line pt-4"
            aria-live="polite"
          >
            <p className={`m-0 text-[14.5px] font-semibold ${right ? 'text-siki' : 'text-kopuk'}`}>
              {right ? 'Doğru.' : 'Tam değil.'}{' '}
              <span className="font-normal text-ink">{right ? '' : picked?.hint}</span>
            </p>
            <p className="m-0 mt-1.5 text-[15px] leading-[1.6] text-ink">
              {p.explanation}
              <span className="ml-2 whitespace-nowrap">
                <CitationPill turnId={turnId} claim={claim} cite={p.cite} active={activeId === claim.id} onActivate={() => onActivate(claim, p.cite)} />
              </span>
            </p>
            <div className="mt-3.5">
              {!added ? (
                <button type="button" onClick={onAdd} className="press inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-white px-3 text-[13.5px] font-medium text-ink hover:border-ink-3">
                  <ArrowsClockwise size={16} aria-hidden /> Tekrar listesine ekle
                </button>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE_OUT } }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-siki-line bg-siki-tint px-3 py-2.5"
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
