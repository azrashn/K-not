import { useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { Btn } from './ui'

const input = 'mt-1.5 block w-full rounded-[10px] border border-line bg-white px-3 py-2 text-[14.5px] text-ink outline-none transition-colors hover:border-line-strong focus:border-accent'

function validate(v) {
  const e = {}
  if (v.name.trim().length < 2) e.name = 'Ders adı en az 2 karakter olmalı.'
  if (v.name.trim().length > 200) e.name = 'Ders adı en fazla 200 karakter olabilir.'
  if (v.code.trim().length > 32) e.code = 'Ders kodu en fazla 32 karakter olabilir.'
  if (v.term.trim().length > 32) e.term = 'Dönem en fazla 32 karakter olabilir.'
  if (v.description.length > 1000) e.description = 'Açıklama en fazla 1000 karakter olabilir.'
  return e
}

/** Ders oluşturma / düzenleme penceresi. `course` verilirse düzenleme modudur. */
export default function CourseModal({ course, onClose, onSaved }) {
  const editing = Boolean(course)
  const [v, setV] = useState({
    name: course?.name ?? '', code: course?.code ?? '', instructor_name: course?.instructor_name ?? '',
    term: course?.term ?? '', description: course?.description ?? '',
  })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const first = useRef(null)
  useEffect(() => {
    first.current?.focus()
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => {
    e.preventDefault()
    const found = validate(v)
    setErrors(found)
    if (Object.keys(found).length) return
    const body = { name: v.name.trim() }
    for (const k of ['code', 'instructor_name', 'term', 'description']) {
      const t = v[k].trim()
      if (t) body[k] = t
      else if (editing && course[k]) body[k] = null // düzenlemede boşaltılan alan temizlenir
    }
    setBusy(true)
    setFailure(null)
    try {
      const saved = editing ? await api.updateCourse(course.id, body) : await api.createCourse(body)
      onSaved(saved)
    } catch (err) {
      setFailure(errorText(err))
      setBusy(false)
    }
  }

  const field = (k, label, props = {}) => (
    <label className="block text-[13px] font-medium text-ink-2">
      {label}
      {props.area
        ? <textarea rows={3} value={v[k]} onChange={set(k)} className={input} aria-invalid={Boolean(errors[k])} />
        : <input ref={props.first ? first : undefined} value={v[k]} onChange={set(k)} className={input} aria-invalid={Boolean(errors[k])} placeholder={props.placeholder} />}
      {errors[k] && <span role="alert" className="mt-1 block text-[12.5px] font-normal text-kopuk">{errors[k]}</span>}
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="course-modal-title" onSubmit={submit} noValidate
        className="max-h-full w-full max-w-[30rem] space-y-4 overflow-y-auto rounded-xl border border-line bg-sheet p-6">
        <h2 id="course-modal-title" className="display m-0 text-[24px] text-ink">{editing ? 'Dersi düzenle' : 'Yeni ders'}</h2>
        {field('name', 'Ders adı *', { first: true, placeholder: 'Örn. Veri Yapıları' })}
        <div className="grid gap-4 sm:grid-cols-2">
          {field('code', 'Ders kodu (isteğe bağlı)', { placeholder: 'BIL 211' })}
          {field('term', 'Dönem', { placeholder: 'Güz 2026' })}
        </div>
        {field('instructor_name', 'Öğretim üyesi')}
        {field('description', 'Açıklama', { area: true })}
        {failure && <p role="alert" className="m-0 rounded-lg bg-kopuk-tint px-3 py-2 text-[13.5px] text-kopuk">{failure}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="quiet" onClick={onClose} disabled={busy}>Vazgeç</Btn>
          <Btn type="submit" disabled={busy}>{busy ? 'Kaydediliyor…' : editing ? 'Kaydet' : 'Dersi oluştur'}</Btn>
        </div>
      </form>
    </div>
  )
}
