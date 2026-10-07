import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { FilePdf, UploadSimple, ArrowUpRight, ArrowClockwise } from '@phosphor-icons/react'
import { COURSES, TYPE_LABEL, readiness, MATERIAL_STATES } from '../data/academic'
import { useApp } from '../app/store'
import { PageFrame, Btn, TextLink } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import StatusTrack from '../components/StatusTrack'
import { EASE_OUT } from '../lib/motion'

const FILTERS = [
  { id: 'all', label: 'Tümü' },
  { id: 'slayt', label: 'Slaytlar' },
  { id: 'not', label: 'Notlar' },
  { id: 'sinav', label: 'Geçmiş Sınavlar' },
  { id: 'pdf', label: 'Diğer PDF' },
]

const guessType = (name) => {
  const n = name.toLowerCase()
  if (/vize|final|cikmis|çıkmış|sinav|sınav/.test(n)) return 'sinav'
  if (/not/.test(n)) return 'not'
  if (/hafta|slayt|ders/.test(n)) return 'slayt'
  return 'pdf'
}

export default function CourseDetail({ courseId }) {
  const reduce = useReducedMotion()
  const { navigate, materials, dispatch, takeIntent } = useApp()
  const course = COURSES.find((c) => c.id === courseId)
  const list = materials[courseId] || []
  const r = readiness(list)
  const [filter, setFilter] = useState('all')
  const [uploader, setUploader] = useState(false)
  const [drag, setDrag] = useState(false)
  const fileRef = useRef(null)
  const consumed = useRef(false)

  useEffect(() => {
    dispatch({ type: 'VIEW', courseId })
    return () => dispatch({ type: 'VIEW', courseId: null })
  }, [courseId, dispatch])

  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    if (takeIntent()?.upload) setUploader(true)
  }, [takeIntent])

  const counts = useMemo(() => {
    const c = { all: list.length }
    list.forEach((m) => { c[m.type] = (c[m.type] || 0) + 1 })
    return c
  }, [list])
  const shown = filter === 'all' ? list : list.filter((m) => m.type === filter)

  if (!course) return <PageFrame><MobileBar /><p className="pt-14 text-ink-2">Ders bulunamadı.</p></PageFrame>

  const add = (name, pagesGuess) => {
    const type = guessType(name)
    dispatch({
      type: 'MAT_ADD', courseId,
      material: { id: `${name}-${Date.now()}`, name, type, pages: pagesGuess ?? null, guess: pagesGuess || 12 + Math.floor(Math.random() * 28), added: 'Bugün', status: 'uploaded', auto: true },
    })
    setFilter('all')
  }
  const onFiles = (files) => Array.from(files || []).forEach((f) => add(f.name))
  const isVY = course.id === 'veri-yapilari'

  return (
    <PageFrame>
      <MobileBar />
      <div className="pt-4 lg:pt-12">
        <button type="button" onClick={() => navigate('/dersler')} className="press -ml-2 rounded-md px-2 py-1 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">← Dersler</button>
        <h1 className="display m-0 mt-3 text-[40px] text-ink sm:text-[52px]">{course.name}</h1>
        <p className="m-0 mt-2 text-[14px] text-ink-3"><span className="font-mono text-[12.5px]">{course.code}</span> · {course.instructor} · {course.term}</p>

        <p className="m-0 mt-6 flex items-center gap-2.5 text-[15.5px] text-ink" role="status" aria-live="polite">
          <span aria-hidden className={`size-2 rounded-full ${r.tone === 'ready' ? 'bg-siki' : r.tone === 'error' ? 'bg-kopuk' : 'bg-accent breathe'}`} />
          <span className="font-medium">{r.text}</span>
          <span className="text-ink-3"><span className="num">{r.ready}</span> / <span className="num">{r.total}</span> materyal hazır</span>
        </p>
        <p className="m-0 mt-2 max-w-[36rem] text-[14.5px] leading-relaxed text-ink-3">Çalışma alanı, alıştırma ve cevap değerlendirmesi yalnızca bu materyallere dayanır. Hazır olmayan materyal yanıtlarda kullanılmaz.</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Btn arrow className="group" disabled={!isVY} onClick={() => navigate(`/dersler/${course.id}/calisma`)}>Çalışma alanını aç</Btn>
          <Btn variant="soft" disabled={!isVY} onClick={() => navigate('/quiz')}>Alıştırma başlat</Btn>
          <Btn variant="quiet" onClick={() => setUploader((u) => !u)} aria-expanded={uploader}><UploadSimple size={16} /> Materyal ekle</Btn>
        </div>
        {!isVY && <p className="m-0 mt-3 text-[13px] text-ink-3">Çalışma alanı ve quiz bu prototipte yalnızca Veri Yapıları için açık.</p>}
      </div>

      <AnimatePresence initial={false}>
        {uploader && (
          <motion.div
            initial={{ opacity: 0, y: reduce ? 0 : -6 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.24, ease: EASE_OUT } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="mt-6"
          >
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files) }}
              className={`rounded-2xl px-6 py-8 text-center transition-colors duration-200 ${drag ? 'bg-accent-tint' : 'bg-ink/[0.04]'}`}
            >
              <p className="m-0 text-[16px] font-medium text-ink">PDF, slayt, not ya da çıkmış soru bırak</p>
              <p className="m-0 mt-1 text-[13.5px] text-ink-3">Yüklenen her dosya okunur ve hazır olduğunda yanıtlarda kaynak olarak kullanılır.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Btn variant="soft" size="sm" onClick={() => fileRef.current?.click()}>Dosya seç</Btn>
                <Btn variant="quiet" size="sm" onClick={() => add(isVY ? 'Hafta9_Agaclar_Tekrar.pdf' : 'Hafta7_Ek_Slaytlar.pdf')}>Örnek dosya ekle</Btn>
              </div>
              <input ref={fileRef} type="file" multiple accept=".pdf,.ppt,.pptx,.doc,.docx" className="sr-only" aria-label="Dosya seç" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="mt-12" aria-label="Materyaller">
        <div role="tablist" aria-label="Materyal türü" className="mb-2 flex flex-wrap gap-1">
          {FILTERS.filter((f) => f.id === 'all' || counts[f.id]).map((f) => (
            <button
              key={f.id} role="tab" aria-selected={filter === f.id} type="button" onClick={() => setFilter(f.id)}
              className={`press h-8 rounded-lg px-3 text-[13.5px] font-medium ${filter === f.id ? 'bg-ink text-white' : 'text-ink-2 hover:bg-ink/[0.06]'}`}
            >
              {f.label} <span className={`ml-1 font-mono text-[11.5px] ${filter === f.id ? 'text-white/60' : 'text-ink-3'}`}>{counts[f.id] || 0}</span>
            </button>
          ))}
        </div>

        <ul className="m-0 list-none p-0">
          <AnimatePresence initial={false}>
            {shown.map((m) => (
              <motion.li
                key={m.id} layout={!reduce ? 'position' : false}
                initial={{ opacity: 0, y: reduce ? 0 : -8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="border-t border-hair"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-3.5 md:grid-cols-[minmax(0,2.2fr)_5.5rem_4rem_minmax(0,1.5fr)_8.5rem]">
                  <span className="flex min-w-0 items-center gap-3">
                    <FilePdf size={20} className="shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[13px] font-medium text-ink" title={m.name}>{m.name}</span>
                      <span className="block text-[12.5px] text-ink-3 md:hidden">{TYPE_LABEL[m.type]} · {m.pages ? `${m.pages} s.` : 'sayfa sayısı okunuyor'} · {m.added}</span>
                    </span>
                  </span>
                  <span className="hidden text-[13px] text-ink-2 md:block">{TYPE_LABEL[m.type]}</span>
                  <span className="hidden font-mono text-[12px] text-ink-3 num md:block">{m.pages ? `${m.pages} s.` : '—'}</span>
                  <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                    <StatusTrack status={m.status} />
                    {m.status !== 'ready' && (
                      <span className="mt-1 block text-[12.5px] text-ink-3">{m.issue || MATERIAL_STATES[m.status].hint}</span>
                    )}
                  </span>
                  <span className="justify-self-end">
                    {m.status === 'error' && (
                      <Btn variant="soft" size="sm" onClick={() => dispatch({ type: 'MAT_RETRY', courseId, id: m.id })}><ArrowClockwise size={15} /> Yeniden dene</Btn>
                    )}
                    {m.status === 'ready' && m.openable && (
                      <TextLink className="inline-flex items-center gap-1 text-[13.5px]" onClick={() => navigate('/dersler/veri-yapilari/calisma', { open: { cite: { doc: m.openable, page: m.openable === 'slides' ? 18 : 3, seg: '', label: m.openable === 'slides' ? 'Slayt · s.18' : 'Notlar · s.3' }, text: m.name, tag: 'Materyal' } })}>
                        Kaynakta aç <ArrowUpRight size={13} weight="bold" />
                      </TextLink>
                    )}
                  </span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </section>
    </PageFrame>
  )
}
