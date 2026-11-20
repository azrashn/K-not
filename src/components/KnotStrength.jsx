import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '../lib/motion'

const STATES = {
  SIKI: { label: 'SIKI', text: 'text-siki', color: 'var(--color-siki)', soft: 'var(--color-siki-tint)' },
  GEVESEK: { label: 'GEVEŞEK', text: 'text-gevesek', color: 'var(--color-gevesek)', soft: 'var(--color-gevesek-tint)' },
  KOPUK: { label: 'KOPUK', text: 'text-kopuk', color: 'var(--color-kopuk)', soft: 'var(--color-kopuk-tint)' },
}

// Gerçek yanıtlarda düzey YALNIZCA sunucunun support_status değerinden gelir; alıntı varlığı
// bir iddiayı yükseltmez. (Örnek ekranlarda support alanı yoksa eski alıntı kuralı kullanılır.)
const SUPPORT_LEVEL = { SUPPORTED: 1, PARTIALLY_SUPPORTED: 0.5, UNSUPPORTED: 0 }
const levelOf = (c) => (c.support
  ? (SUPPORT_LEVEL[c.support] ?? 0)
  : c.gap || !c.cites?.length ? 0 : c.cites.some((x) => x.strength === 'partial') ? 0.5 : 1)

// Düğüm Gücü simgesi: her iddia bir düğüm; aralarındaki ip kanıt gücünü anlatır.
//  SIKI → gergin ip + sıkı düğüm · GEVEŞEK → gevşek sarkan ip + açık ilmek · KOPUK → kopuk, uçları yıpranmış ip
export function KnotGlyph({ state, levels, verified, reduce }) {
  const s = STATES[state]
  const n = Math.max(1, levels.length)
  const step = 46
  const xs = levels.map((_, i) => 9 + i * step)
  const W = n === 1 ? 62 : xs[n - 1] + 12
  const col = verified ? s.color : 'var(--color-ink-3)'
  const d = (delay) => ({ duration: reduce ? 0 : 0.36, delay: reduce ? 0 : delay, ease: EASE_OUT })

  const segs = []
  for (let i = 0; i < n - 1; i++) {
    const a = xs[i] + 5
    const b = xs[i + 1] - 5
    const mid = (a + b) / 2
    const kind = levels[i] === 1 && levels[i + 1] === 1 ? 'tight' : levels[i] === 0 || levels[i + 1] === 0 ? 'broken' : 'loose'
    segs.push({ a, b, mid, kind, i })
  }
  const tail = n === 1 && levels[0] === 0

  return (
    <svg width={W} height="26" viewBox={`0 0 ${W} 26`} fill="none" aria-hidden className="shrink-0 overflow-visible">
      {!verified && <path d={`M${xs[0] + 6} 13H${W - 4}`} stroke={col} strokeWidth="1.4" strokeDasharray="1 4" strokeLinecap="round" className="breathe" />}
      {verified && segs.map(({ a, b, mid, kind, i }) => (
        <g key={i}>
          {kind === 'tight' && (
            <>
              <motion.path d={`M${a} 13H${b}`} stroke={col} strokeWidth="2" strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.circle cx={mid} cy="13" r="4.2" fill="var(--color-paper)" stroke={col} strokeWidth="2" initial={{ scale: reduce ? 1 : 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ transformOrigin: `${mid}px 13px` }} transition={d(0.28)} />
            </>
          )}
          {kind === 'loose' && (
            <>
              <motion.path d={`M${a} 13Q${mid} 25 ${b} 13`} stroke={col} strokeWidth="1.7" strokeLinecap="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.circle cx={mid} cy="19" r="3.6" fill="var(--color-paper)" stroke={col} strokeWidth="1.5" strokeDasharray="4 2.6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={d(0.3)} />
            </>
          )}
          {kind === 'broken' && (
            <>
              <motion.path d={`M${a} 13H${mid - 7}l2.6-4.4 2.6 8.8 2.6-4.4`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
              <motion.path d={`M${mid + 5} 13H${mid + 9}`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeDasharray="1 4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={d(0.25)} />
            </>
          )}
        </g>
      ))}
      {verified && tail && (
        <motion.path d={`M${xs[0] + 6} 13h17l2.6-4.4 2.6 8.8 2.6-4.4`} stroke={col} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }} transition={d(0.05)} />
      )}
      {xs.map((x, i) => {
        const l = verified ? levels[i] : 0
        return (
          <motion.g key={i} initial={{ scale: reduce ? 1 : 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ transformOrigin: `${x}px 13px` }} transition={d(0.04 * i)}>
            <circle cx={x} cy="13" r="5" fill={l === 1 ? col : l === 0.5 ? s.soft : 'var(--color-paper)'} stroke={col} strokeWidth="1.6" strokeDasharray={l === 0 && verified ? '2.4 2.2' : undefined} />
            {l === 0.5 && <path d={`M${x} 8a5 5 0 0 0 0 10z`} fill={col} />}
          </motion.g>
        )
      })}
    </svg>
  )
}

// Kanıt desteğinin özeti: durum, sayılar ve gerekçeler iddialardan türetilir. Güven yüzdesi yoktur.
export function analyze(claims, stateOverride) {
  const total = claims.length
  const lv = claims.map(levelOf)
  const full = lv.filter((x) => x === 1).length
  const partial = lv.filter((x) => x === 0.5).length
  const none = lv.filter((x) => x === 0).length
  const supported = full + partial
  const sources = new Set(claims.flatMap((c) => c.cites.map((x) => `${x.doc}:${x.page}`))).size
  const state = stateOverride || (supported === 0 ? 'KOPUK' : none === 0 && partial === 0 ? 'SIKI' : 'GEVESEK')
  const first = `${supported}/${total} iddia destekleniyor`
  let second
  if (state === 'SIKI') second = `${sources} kaynak kullanıldı`
  else if (state === 'KOPUK') second = 'Yeterli kanıt bulunamadı. Tahmin yürütülmedi.'
  else second = [partial && `${partial} iddia yalnızca kısmen`, none && `${none} iddia için yeterli kanıt yok`].filter(Boolean).join(' · ')
  return { state, first, second, levels: lv, sources, total, supported }
}

const RULES = [
  ['SIKI', 'Tüm iddialar derslerindeki bir kaynağa bağlı.'],
  ['GEVEŞEK', 'Yanıtın yalnızca bir kısmı için yeterli kanıt var.'],
  ['KOPUK', 'Materyallerinde destekleyen kanıt bulunamadı.'],
]

// Düğüm Gücü: sade bir imza. Durum, tek cümlelik gerekçe ve istenirse iddia bazında neden.
export default function KnotStrength({ claims, verified, onActivate, state: stateOverride, heuristic }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const k = analyze(claims, stateOverride)
  const s = STATES[k.state]
  const key = verified ? k.state : 'PENDING'

  return (
    <div className="mt-5" data-knot={verified ? k.state : 'pending'}>
      <div className="flex items-center gap-4" role="status" aria-live="polite">
        <KnotGlyph key={key} state={k.state} levels={k.levels} verified={verified} reduce={reduce} />
        <div className="min-w-0">
          <p className="m-0 flex items-baseline gap-2.5">
            <span className="text-[12.5px] font-medium text-ink-3">Düğüm Gücü</span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={key}
                initial={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)' }}
                animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.2, ease: EASE_OUT } }}
                exit={{ opacity: 0, filter: reduce ? 'blur(0px)' : 'blur(3px)', transition: { duration: 0.1 } }}
                className={`font-mono text-[12.5px] font-semibold tracking-[0.04em] ${verified ? s.text : 'text-ink-3'}`}
              >
                {verified ? s.label : 'KONTROL EDİLİYOR'}
              </motion.span>
            </AnimatePresence>
          </p>
          {verified ? (
            <>
              <p className="m-0 mt-0.5 text-[14px] text-ink">{k.first}</p>
              <p className="m-0 text-[13.5px] text-ink-2">{k.second}</p>
            </>
          ) : (
            <p className="m-0 mt-0.5 text-[14px] text-ink-3">Her iddia kaynağıyla eşleştiriliyor…</p>
          )}
        </div>
        {verified && (
          <button
            type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className="press ml-auto self-start rounded-md px-2 py-1 text-[12.5px] font-medium text-ink-3 hover:bg-ink/[0.05] hover:text-ink"
          >
            {open ? 'Gizle' : 'Nedenini gör'}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && verified && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : -4 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="mt-3"
          >
            <ul className="m-0 list-none p-0">
              {claims.map((c, i) => {
                const l = k.levels[i]
                const mark = l === 1 ? ['✓', 'text-siki'] : l === 0.5 ? ['◐', 'text-gevesek'] : ['—', 'text-kopuk']
                const lab = c.cites?.[0]?.label ?? 'kaynak'
                const note = l === 1 ? lab : l === 0.5 ? `${lab} · kısmi` : 'kanıt yok'
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => onActivate?.(c, c.cites?.[0])} className="press -mx-2 grid w-[calc(100%+1rem)] grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink/[0.04]">
                      <span aria-hidden className={`font-mono text-[13px] font-semibold ${mark[1]}`}>{mark[0]}</span>
                      <span className="truncate text-[13.5px] text-ink-2">{c.text}</span>
                      <span className={`font-mono text-[11.5px] ${l === 0 ? 'text-kopuk' : 'text-ink-3'}`}>{note}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <dl className="m-0 mt-3 grid gap-x-3 gap-y-1 text-[12.5px] text-ink-3 [grid-template-columns:auto_1fr]">
              {RULES.map(([name, text]) => (
                <div key={name} className="contents">
                  <dt className={`font-mono font-semibold ${STATES[name === 'GEVEŞEK' ? 'GEVESEK' : name].text}`}>{name}</dt>
                  <dd className="m-0">{text}</dd>
                </div>
              ))}
            </dl>
            {heuristic && (
              <p className="m-0 mt-3 text-[12.5px] leading-relaxed text-ink-3" data-heuristic-note>
                Destek düzeyi, iddiaların kaynak metniyle sözcük düzeyinde karşılaştırılmasıyla belirlenir; anlamsal olarak doğrulanmış değildir.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
