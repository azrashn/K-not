import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { FilePdf, UploadSimple, ArrowUpRight, ArrowClockwise, DownloadSimple, Trash, LockSimple, UsersThree } from '@phosphor-icons/react'
import { MATERIAL_STATES } from '../data/academic'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { useApp } from '../app/store'
import { useCourseDocuments, useResource } from '../hooks/useApi'
import { DOC_TYPES, TYPE_LABEL, guessDocumentType, readiness, toMaterial, validatePdf } from '../lib/materials'
import { PageFrame, Btn, TextLink } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import StatusTrack from '../components/StatusTrack'
import { LoadState } from './Courses'
import { EASE_OUT } from '../lib/motion'

const FILTERS = [{ id: 'all', label: 'Tümü' }, ...DOC_TYPES.map((t) => ({ id: t.ui, label: t.label }))]

/** Belgeyi kimlik doğrulamalı olarak indirir ve yeni sekmede açar (bağlantıya jeton konmaz). */
async function openFile(doc) {
  const blob = await api.file(doc.id)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener'
  a.download = doc.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export default function CourseDetail({ courseId }) {
  const reduce = useReducedMotion()
  const { navigate, takeIntent } = useApp()
  const course = useResource((signal) => api.course(courseId, signal), [courseId])
  const { docs, error: docsError, loading: docsLoading, refresh } = useCourseDocuments(courseId)
  const list = useMemo(() => (docs ?? []).map(toMaterial), [docs])
  const r = readiness(list)
  const [filter, setFilter] = useState('all')
  const [uploader, setUploader] = useState(false)
  const [drag, setDrag] = useState(false)
  const [pending, setPending] = useState([]) // yüklenmekte olan dosyalar
  const [messages, setMessages] = useState([]) // { id, tone, text }
  const [docType, setDocType] = useState('auto')
  const [visibility, setVisibility] = useState('PRIVATE')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busyRow, setBusyRow] = useState(null)
  const fileRef = useRef(null)
  const consumed = useRef(false)
  const instructor = course.data?.my_role === 'INSTRUCTOR'

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
  const say = (tone, text) => setMessages((ms) => [{ id: `${Date.now()}-${Math.random()}`, tone, text }, ...ms].slice(0, 4))

  if (course.loading) return <PageFrame><MobileBar /><div className="pt-14"><LoadState loading /></div></PageFrame>
  if (course.error) {
    return (
      <PageFrame><MobileBar />
        <div className="pt-14">
          {course.error.code === 'NOT_FOUND'
            ? <p className="m-0 text-ink-2">Ders bulunamadı ya da bu derse kayıtlı değilsin.</p>
            : <LoadState error={course.error} onRetry={course.reload} />}
          <TextLink className="mt-4 text-[14px]" onClick={() => navigate('/dersler')}>Derslere dön</TextLink>
        </div>
      </PageFrame>
    )
  }
  const c = course.data

  const uploadOne = async (file) => {
    const problem = validatePdf(file)
    if (problem) return say('error', `${file.name}: ${problem}`)
    const key = `${file.name}-${Date.now()}`
    setPending((p) => [...p, { key, name: file.name }])
    try {
      const dto = await api.upload(courseId, file, {
        documentType: docType === 'auto' ? guessDocumentType(file.name) : docType,
        visibility: instructor ? visibility : 'PRIVATE',
      })
      if (dto.notices?.includes('SAME_AS_COURSE_DOCUMENT')) say('info', `${file.name}: Bu dosya derste zaten paylaşılmış; kendi kopyan da ayrıca hazırlanacak.`)
      setFilter('all')
    } catch (e) {
      say('error', `${file.name}: ${errorText(e)}`)
    } finally {
      setPending((p) => p.filter((x) => x.key !== key))
      refresh()
    }
  }
  const onFiles = (files) => Array.from(files || []).forEach(uploadOne)

  const retry = async (m) => {
    setBusyRow(m.id)
    try { await api.retry(m.id) } catch (e) { say('error', `${m.name}: ${errorText(e)}`) } finally { setBusyRow(null); refresh() }
  }
  const remove = async (m) => {
    setBusyRow(m.id)
    try { await api.remove(m.id) } catch (e) { say('error', `${m.name}: ${errorText(e)}`) } finally { setBusyRow(null); setConfirmDelete(null); refresh() }
  }
  const download = async (m) => {
    try { await openFile(m) } catch (e) { say('error', `${m.name}: ${errorText(e)}`) }
  }

  return (
    <PageFrame>
      <MobileBar />
      <div className="pt-4 lg:pt-12">
        <button type="button" onClick={() => navigate('/dersler')} className="press -ml-2 rounded-md px-2 py-1 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">← Dersler</button>
        <h1 className="display m-0 mt-3 text-[40px] text-ink sm:text-[52px]">{c.name}</h1>
        <p className="m-0 mt-2 text-[14px] text-ink-3"><span className="font-mono text-[12.5px]">{c.code}</span>{c.instructor_name ? ` · ${c.instructor_name}` : ''} · {c.term}</p>

        <p className="m-0 mt-6 flex items-center gap-2.5 text-[15.5px] text-ink" role="status" aria-live="polite">
          <span aria-hidden className={`size-2 rounded-full ${r.tone === 'ready' ? 'bg-siki' : r.tone === 'error' ? 'bg-kopuk' : 'bg-accent breathe'}`} />
          <span className="font-medium">{r.text}</span>
          <span className="text-ink-3"><span className="num">{r.ready}</span> / <span className="num">{r.total}</span> materyal hazır</span>
        </p>
        <p className="m-0 mt-2 max-w-[36rem] text-[14.5px] leading-relaxed text-ink-3">Çalışma alanı yalnızca bu materyallere dayanır. Hazır olmayan materyal yanıtlarda kullanılmaz.</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Btn arrow className="group" disabled={r.ready === 0} onClick={() => navigate(`/dersler/${c.id}/calisma`)}>Çalışma alanını aç</Btn>
          <Btn variant="soft" disabled title="Alıştırma üretimi henüz bağlı değil (WBS-6)">Alıştırma başlat</Btn>
          <Btn variant="quiet" onClick={() => setUploader((u) => !u)} aria-expanded={uploader}><UploadSimple size={16} /> Materyal ekle</Btn>
        </div>
        {r.ready === 0 && <p className="m-0 mt-3 text-[13px] text-ink-3">Çalışma alanı, en az bir materyal hazır olduğunda açılır.</p>}
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
              data-dropzone
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files) }}
              className={`rounded-2xl px-6 py-8 text-center transition-colors duration-200 ${drag ? 'bg-accent-tint' : 'bg-ink/[0.04]'}`}
            >
              <p className="m-0 text-[16px] font-medium text-ink">PDF bırak ya da seç</p>
              <p className="m-0 mt-1 text-[13.5px] text-ink-3">Yalnızca metin içeren PDF (en fazla 30 MB). Taranmış sayfalar okunamaz.</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <select aria-label="Yüklenecek dosyanın türü" value={docType} onChange={(e) => setDocType(e.target.value)} className="h-9 rounded-[10px] bg-white px-2.5 text-[13.5px] text-ink shadow-[0_0_0_1px_rgba(22,24,30,0.1)]">
                  <option value="auto">Tür: dosya adından</option>
                  {DOC_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                {instructor && (
                  <select aria-label="Görünürlük" value={visibility} onChange={(e) => setVisibility(e.target.value)} className="h-9 rounded-[10px] bg-white px-2.5 text-[13.5px] text-ink shadow-[0_0_0_1px_rgba(22,24,30,0.1)]">
                    <option value="PRIVATE">Yalnızca ben</option>
                    <option value="COURSE">Tüm ders</option>
                  </select>
                )}
                <Btn variant="soft" size="sm" onClick={() => fileRef.current?.click()}>Dosya seç</Btn>
              </div>
              <input ref={fileRef} type="file" multiple accept=".pdf,application/pdf" className="sr-only" aria-label="Dosya seç" onChange={(e) => { onFiles(e.target.files); e.target.value = '' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {messages.length > 0 && (
        <ul className="m-0 mt-4 list-none space-y-1.5 p-0" aria-live="polite">
          {messages.map((m) => (
            <li key={m.id} role={m.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-[13.5px] ${m.tone === 'error' ? 'bg-kopuk-tint text-kopuk' : 'bg-accent-tint text-accent-deep'}`}>{m.text}</li>
          ))}
        </ul>
      )}

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

        {docsLoading && <LoadState loading />}
        {docsError && !docs && <LoadState error={docsError} onRetry={refresh} />}
        {!docsLoading && docs && list.length === 0 && pending.length === 0 && (
          <p className="m-0 border-t border-hair py-6 text-[14.5px] text-ink-2">Bu derste henüz materyal yok. “Materyal ekle” ile bir PDF yükle.</p>
        )}

        <ul className="m-0 list-none p-0">
          {pending.map((p) => (
            <li key={p.key} className="border-t border-hair py-3.5" data-pending>
              <span className="flex items-center gap-3">
                <FilePdf size={20} className="shrink-0 text-ink-3" aria-hidden />
                <span className="truncate font-mono text-[13px] font-medium text-ink">{p.name}</span>
                <span className="text-[12.5px] text-ink-3" role="status">Yükleniyor…</span>
              </span>
            </li>
          ))}
          <AnimatePresence initial={false}>
            {shown.map((m) => (
              <motion.li
                key={m.id} layout={!reduce ? 'position' : false}
                initial={{ opacity: 0, y: reduce ? 0 : -8 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
                className="border-t border-hair"
                data-material={m.id} data-state={m.status}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-3.5 md:grid-cols-[minmax(0,2.2fr)_5.5rem_4rem_minmax(0,1.5fr)_auto]">
                  <span className="flex min-w-0 items-center gap-3">
                    <FilePdf size={20} className="shrink-0 text-ink-3" aria-hidden />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="block truncate font-mono text-[13px] font-medium text-ink" title={m.name}>{m.name}</span>
                        {m.visibility === 'COURSE'
                          ? <UsersThree size={13} className="shrink-0 text-ink-3" aria-label="Tüm derse açık" />
                          : <LockSimple size={13} className="shrink-0 text-ink-3" aria-label="Yalnızca sana açık" />}
                      </span>
                      <span className="block text-[12.5px] text-ink-3 md:hidden">{TYPE_LABEL[m.type]} · {m.pages ? `${m.pages} s.` : 'sayfa sayısı okunuyor'} · {m.added}</span>
                    </span>
                  </span>
                  <span className="hidden text-[13px] text-ink-2 md:block">{TYPE_LABEL[m.type]}</span>
                  <span className="hidden font-mono text-[12px] text-ink-3 num md:block">{m.pages ? `${m.pages} s.` : '—'}</span>
                  <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto">
                    <StatusTrack status={m.status} />
                    {m.status !== 'ready' && (
                      <span className="mt-1 block text-[12.5px] text-ink-3" data-issue>{m.issue || MATERIAL_STATES[m.status]?.hint}</span>
                    )}
                  </span>
                  <span className="flex items-center justify-self-end gap-1">
                    {m.status === 'error' && m.retryable && (
                      <Btn variant="soft" size="sm" disabled={busyRow === m.id} onClick={() => retry(m)}><ArrowClockwise size={15} /> Yeniden dene</Btn>
                    )}
                    {m.status === 'ready' && (
                      <TextLink className="mr-2 inline-flex items-center gap-1 text-[13.5px]" onClick={() => navigate(`/dersler/${c.id}/calisma`, { openDoc: { id: m.id, page: 1 } })}>
                        Kaynakta aç <ArrowUpRight size={13} weight="bold" />
                      </TextLink>
                    )}
                    <button type="button" onClick={() => download(m)} aria-label={`${m.name} indir`} title="PDF’i aç" className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink"><DownloadSimple size={16} /></button>
                    {m.canDelete && (confirmDelete === m.id ? (
                      <span className="inline-flex items-center gap-1">
                        <Btn variant="soft" size="sm" className="text-kopuk" disabled={busyRow === m.id} onClick={() => remove(m)}>Sil</Btn>
                        <Btn variant="quiet" size="sm" onClick={() => setConfirmDelete(null)}>Vazgeç</Btn>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(m.id)} aria-label={`${m.name} sil`} title="Sil" className="press grid size-8 place-items-center rounded-md text-ink-3 hover:bg-kopuk-tint hover:text-kopuk"><Trash size={16} /></button>
                    ))}
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
