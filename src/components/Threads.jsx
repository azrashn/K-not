import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { topicState, STATE_TEXT } from '../data/academic'
import { EASE_OUT } from '../lib/motion'

const COLOR = {
  tight: 'var(--color-siki)',
  loose: 'var(--color-gevesek)',
  weak: 'var(--color-gevesek)',
  open: 'var(--color-line-strong)',
}

// Küçük ip: ders satırı, quiz ilerlemesi ve ana sayfa için. Süs değil; durum taşır.
export function MiniThread({ states, current = -1, gap = 15, label }) {
  const n = states.length
  const W = (n - 1) * gap + 12
  return (
    <svg width={W} height="14" viewBox={`0 0 ${W} 14`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      {states.slice(0, -1).map((st, i) => {
        const nx = states[i + 1]
        const x1 = 6 + i * gap + 3.5
        const x2 = 6 + (i + 1) * gap - 3.5
        const open = st === 'open' || nx === 'open'
        const tight = st === 'tight' && nx === 'tight'
        return (
          <path
            key={i}
            d={tight || open ? `M${x1} 7H${x2}` : `M${x1} 7Q${(x1 + x2) / 2} 11.5 ${x2} 7`}
            stroke={open ? COLOR.open : tight ? COLOR.tight : COLOR.loose}
            strokeWidth={tight ? 1.8 : 1.4}
            strokeLinecap="round"
            strokeDasharray={open ? '1 3' : undefined}
            fill="none"
          />
        )
      })}
      {states.map((st, i) => (
        <g key={i}>
          {i === current && <circle cx={6 + i * gap} cy="7" r="6" fill="none" stroke="var(--color-accent)" strokeWidth="1.2" />}
          <circle
            cx={6 + i * gap} cy="7" r="3.4"
            fill={st === 'tight' ? COLOR.tight : st === 'loose' ? 'var(--color-gevesek-tint)' : 'var(--color-paper)'}
            stroke={st === 'open' ? COLOR.open : COLOR[st]} strokeWidth="1.4"
            strokeDasharray={st === 'open' ? '2 1.6' : undefined}
          />
        </g>
      ))}
    </svg>
  )
}

// Bilgi İpi: konular ders sırasıyla tek bir sürekli ip. Sıkı bölümler gergin, zayıflar sarkık.
export function KnowledgeThread({ topics, selectedId, onSelect }) {
  const reduce = useReducedMotion()
  const host = useRef(null)
  const [w, setW] = useState(960)
  const MIN = 98
  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const col = Math.max(MIN, w / topics.length)
  const total = col * topics.length
  const overflowing = total > w + 1
  const cx = (i) => col * (i + 0.5)
  const Y = 26
  const tr = { duration: reduce ? 0 : 0.5, ease: EASE_OUT }
  const selIdx = topics.findIndex((t) => t.id === selectedId)

  // Seçili düğüm görünür kalsın (dar ekranda yatay kaydırma)
  useEffect(() => {
    const el = host.current
    const i = topics.findIndex((t) => t.id === selectedId)
    if (!el || i < 0) return
    const left = cx(i) - el.clientWidth / 2
    el.scrollTo({ left: Math.max(0, left), behavior: 'auto' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={host}
      className="scroll-quiet -mx-5 overflow-x-auto px-5 sm:-mx-10 sm:px-10"
      style={overflowing ? { maskImage: 'linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)' } : undefined}
    >
      <div className="relative" style={{ width: total, minWidth: '100%' }}>
        <svg width={total} height="64" viewBox={`0 0 ${total} 64`} className="pointer-events-none absolute left-0 top-0 overflow-visible" aria-hidden>
          {topics.slice(0, -1).map((t, i) => {
            const nx = topics[i + 1]
            const a = topicState(t.score)
            const b = topicState(nx.score)
            const x1 = cx(i) + 12
            const x2 = cx(i + 1) - 12
            const mid = (x1 + x2) / 2
            const open = a === 'open' || b === 'open'
            const tight = a === 'tight' && b === 'tight'
            const slack = open || tight ? 0 : Math.min(30, 7 + (0.72 - Math.min(t.score, nx.score)) * 42)
            const d = `M${x1} ${Y} Q${mid} ${Y + slack} ${x2} ${Y}`
            return (
              <g key={t.id}>
                <motion.path
                  d={d} fill="none" strokeLinecap="round"
                  animate={{ d, stroke: open ? COLOR.open : tight ? COLOR.tight : COLOR.loose, strokeWidth: tight ? 2.6 : 1.8 }}
                  initial={false} transition={tr}
                  strokeDasharray={open ? '1 6' : undefined}
                />
                {tight && <circle cx={mid} cy={Y} r="3.6" fill="var(--color-paper)" stroke={COLOR.tight} strokeWidth="2" />}
              </g>
            )
          })}
          {selIdx >= 0 && <motion.circle cy={Y} r="14" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" initial={false} animate={{ cx: cx(selIdx) }} transition={tr} />}
          {topics.map((t, i) => {
            const st = topicState(t.score)
            return (
              <g key={t.id}>
                <circle cx={cx(i)} cy={Y} r="8"
                  fill={st === 'tight' ? COLOR.tight : st === 'loose' ? 'var(--color-gevesek-tint)' : 'var(--color-paper)'}
                  stroke={COLOR[st]} strokeWidth="2" strokeDasharray={st === 'open' ? '3 2.6' : undefined}
                  style={{ transition: 'fill 400ms var(--ease-out), stroke 400ms var(--ease-out)' }}
                />
                {st === 'loose' && <path d={`M${cx(i)} ${Y - 8}a8 8 0 0 0 0 16z`} fill={COLOR.loose} />}
              </g>
            )
          })}
        </svg>
        <ol className="m-0 flex list-none p-0" style={{ width: total }}>
          {topics.map((t) => {
            const st = topicState(t.score)
            const sel = t.id === selectedId
            return (
              <li key={t.id} style={{ width: col }}>
                <button
                  type="button"
                  onClick={() => onSelect(t.id)}
                  aria-pressed={sel}
                  aria-label={`${t.name}: ${STATE_TEXT[st]}`}
                  className="press group block w-full rounded-xl px-2 pb-3 pt-[56px] text-center hover:bg-ink/[0.03]"
                >
                  <span className={`block text-[13.5px] leading-tight transition-colors duration-200 ${sel ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}>{t.name}</span>
                  <span className={`mt-1 block text-[12px] ${st === 'tight' ? 'text-siki' : st === 'open' ? 'text-ink-3' : 'text-gevesek'}`}>{STATE_TEXT[st]}</span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
