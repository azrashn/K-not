import { motion, useReducedMotion } from 'framer-motion'
import { CaretRight } from '@phosphor-icons/react'
import { COURSES, readiness, topicState } from '../data/academic'
import { useApp } from '../app/store'
import { PageFrame } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { MiniThread } from '../components/Threads'
import { EASE_OUT } from '../lib/motion'

// Diğer derslerin ip örnekleri (yalnızca bağlam; Veri Yapıları canlı veriden gelir)
const SAMPLE_THREADS = {
  algoritmalar: ['tight', 'tight', 'loose', 'weak', 'open', 'open'],
  veritabani: ['tight', 'tight', 'tight', 'loose', 'open', 'open'],
  yazilim: ['tight', 'loose', 'open', 'open', 'open', 'open'],
}

const TONE = { ready: 'bg-siki', busy: 'bg-accent', error: 'bg-kopuk' }

export default function Courses() {
  const reduce = useReducedMotion()
  const { navigate, materials, topics } = useApp()

  return (
    <PageFrame>
      <MobileBar />
      <header className="pb-8 pt-4 lg:pt-14">
        <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Derslerin</h1>
        <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
          Her ders, yüklediğin materyallerle çalışılır. Yanıtlar yalnızca hazır olan kaynaklardan gelir.
        </p>
      </header>

      <ul className="m-0 list-none p-0">
        {COURSES.map((c, i) => {
          const list = materials[c.id]
          const r = readiness(list)
          const states = c.id === 'veri-yapilari' ? topics.map((t) => topicState(t.score)) : SAMPLE_THREADS[c.id]
          return (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.3, delay: reduce ? 0 : 0.05 * i, ease: EASE_OUT } }}
              className="border-t border-hair first:border-t-0"
            >
              <button
                type="button"
                onClick={() => navigate(`/dersler/${c.id}`)}
                className="press group -mx-4 grid w-[calc(100%+2rem)] grid-cols-1 items-center gap-x-8 gap-y-4 rounded-2xl px-4 py-7 text-left hover:bg-ink/[0.03] md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_11.5rem]"
              >
                <span className="min-w-0">
                  <span className="display block text-[28px] text-ink">{c.name}</span>
                  <span className="mt-1 block text-[13.5px] text-ink-3">
                    <span className="font-mono text-[12px]">{c.code}</span> · {c.instructor}
                  </span>
                  <span className="mt-3 flex items-center gap-3">
                    <MiniThread states={states} gap={16} label={`${c.name} bilgi ipi`} />
                    <span className="text-[12.5px] text-ink-3">{c.id === 'veri-yapilari' ? 'Bilgi İpi' : 'Örnek ip'}</span>
                  </span>
                </span>

                <span className="min-w-0 space-y-2 text-[14px]">
                  <span className="flex items-center gap-2 text-ink">
                    <span aria-hidden className={`size-2 rounded-full ${TONE[r.tone]}`} />
                    <span className="font-medium">{r.text}</span>
                  </span>
                  <span className="block text-ink-3"><span className="num">{r.ready}</span> / <span className="num">{r.total}</span> materyal hazır</span>
                  <span className="block text-ink-3">Son çalışma: {c.lastStudied} · {c.lastTopic}</span>
                </span>

                <span className="flex items-center justify-between gap-6 md:justify-end">
                  <span className="text-[13px] text-ink-2">{c.upcoming}</span>
                  <CaretRight size={16} className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
                </span>
              </button>
            </motion.li>
          )
        })}
      </ul>
    </PageFrame>
  )
}
