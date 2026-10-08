import { motion, useReducedMotion } from 'framer-motion'
import { CaretRight } from '@phosphor-icons/react'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { useApp } from '../app/store'
import { useResource } from '../hooks/useApi'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { EASE_OUT } from '../lib/motion'

const ROLE = { STUDENT: 'Öğrenci', INSTRUCTOR: 'Öğretim üyesi' }

/** Ders kartındaki hazırlık özeti, sunucunun belge sayılarından. */
export function courseReadiness(d) {
  if (!d || d.total === 0) return { tone: 'busy', text: 'Henüz materyal yok' }
  if (d.processing > 0) return { tone: 'busy', text: `${d.processing} materyal hazırlanıyor` }
  if (d.failed > 0) return { tone: 'error', text: `${d.failed} materyalde sorun var` }
  return { tone: 'ready', text: 'Tüm materyaller hazır' }
}
const TONE = { ready: 'bg-siki', busy: 'bg-accent', error: 'bg-kopuk' }

export function LoadState({ loading, error, onRetry, empty, emptyText }) {
  if (loading) {
    return (
      <p className="m-0 flex items-center gap-3 py-8 text-[14.5px] text-ink-3" role="status">
        <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="breathe size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 160}ms` }} />)}</span>
        Yükleniyor…
      </p>
    )
  }
  if (error) {
    return (
      <div role="alert" className="py-8">
        <p className="m-0 text-[15px] text-kopuk">{errorText(error)}</p>
        {onRetry && error.code !== 'NOT_FOUND' && <Btn variant="soft" size="sm" className="mt-3" onClick={onRetry}>Tekrar dene</Btn>}
      </div>
    )
  }
  if (empty) return <p className="m-0 py-8 text-[15px] text-ink-2">{emptyText}</p>
  return null
}

export default function Courses() {
  const reduce = useReducedMotion()
  const { navigate } = useApp()
  const { data: courses, error, loading, reload } = useResource((signal) => api.courses(signal), [])

  return (
    <PageFrame>
      <MobileBar />
      <header className="pb-8 pt-4 lg:pt-14">
        <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Derslerin</h1>
        <p className="m-0 mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-2">
          Her ders, yüklediğin materyallerle çalışılır. Yanıtlar yalnızca hazır olan kaynaklardan gelir.
        </p>
      </header>

      <LoadState loading={loading} error={error} onRetry={reload} empty={courses?.length === 0}
        emptyText="Henüz bir derse kayıtlı değilsin. Ders kayıtları yönetici tarafından yapılır." />

      {courses?.length > 0 && (
        <ul className="m-0 list-none p-0">
          {courses.map((c, i) => {
            const r = courseReadiness(c.documents)
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
                      <span className="font-mono text-[12px]">{c.code}</span>{c.instructor_name ? ` · ${c.instructor_name}` : ''}
                    </span>
                  </span>

                  <span className="min-w-0 space-y-2 text-[14px]">
                    <span className="flex items-center gap-2 text-ink">
                      <span aria-hidden className={`size-2 rounded-full ${TONE[r.tone]}`} />
                      <span className="font-medium">{r.text}</span>
                    </span>
                    <span className="block text-ink-3"><span className="num">{c.documents.ready}</span> / <span className="num">{c.documents.total}</span> materyal hazır</span>
                  </span>

                  <span className="flex items-center justify-between gap-6 md:justify-end">
                    <span className="text-[13px] text-ink-2">{c.term}{c.my_role ? ` · ${ROLE[c.my_role]}` : ''}</span>
                    <CaretRight size={16} className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-1" aria-hidden />
                  </span>
                </button>
              </motion.li>
            )
          })}
        </ul>
      )}
    </PageFrame>
  )
}
