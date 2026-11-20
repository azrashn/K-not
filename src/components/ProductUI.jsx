import { useEffect, useId, useRef, useState } from 'react'
import { Btn } from './ui'
import { api } from '../api/endpoints'
import { videoErrorText } from '../lib/video'
export function PageTitle({ eyebrow, title, note, tone, children, actions }) {
  return (
    <header className="product-title" data-tone={tone}>
      <div>
        <p className="product-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {note && <span className="title-note" aria-hidden>{note}</span>}
        {children && <p className="product-description">{children}</p>}
      </div>
      <div className="product-actions">{actions}</div>
    </header>
  )
}
export function EmptyState({ title, children, action }) {
  return (
    <section className="product-empty">
      <svg className="empty-doodle" width="84" height="64" viewBox="0 0 84 64" fill="none" aria-hidden>
        <path d="M10 14 L50 10 L54 52 L14 56 Z" fill="var(--color-sheet)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M20 24 L42 22 M21 32 L44 30 M22 40 L36 39" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        <path d="M58 46 L76 14 L82 18 L64 50 L56 53 Z" fill="var(--color-mark)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M76 14 L82 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M4 60 q6 -5 12 0 t12 0" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </section>
  )
}
export function Metric({ label, value, detail }) {
  return (
    <div className="product-metric">
      <p>{label}</p>
      <strong>{value}</strong>
      {detail && <span>{detail}</span>}
    </div>
  )
}
export function Dialog({ title, children, onClose }) {
  const ref = useRef(null),
    id = useId()
  useEffect(() => {
    const d = ref.current
    d.showModal()
    return () => d.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className="product-dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button onClick={onClose} aria-label="Pencereyi kapat">
          ×
        </button>
      </header>
      {children}
    </dialog>
  )
}
export function CourseEditor({ course, onClose, onSaved }) {
  const [name, setName] = useState(course?.name || ''),
    [description, setDescription] = useState(course?.description || ''),
    [category, setCategory] = useState(course?.category || '')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Dialog
      title={course ? 'Dersi düzenle' : 'Yeni ders oluştur'}
      onClose={onClose}
    >
      <form
        className="product-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            const data = { name: name.trim(), description, category }
            const c = course
              ? await api.updateCourse(course.id, data)
              : await api.createCourse(data)
            onSaved(c)
          } catch (err) {
            setError(videoErrorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          Ders adı
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="Örn. Diferansiyel Denklemler"
          />
        </label>
        <label>
          Açıklama <span>isteğe bağlı</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </label>
        <label>
          Akademik alan <span>isteğe bağlı</span>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={80}
            placeholder="Örn. Matematik"
          />
        </label>
        {error && (
          <p role="alert" className="product-error">
            {error}
          </p>
        )}
        <div className="product-actions">
          <Btn type="submit" disabled={busy || !name.trim()}>
            {busy
              ? 'Kaydediliyor…'
              : course
                ? 'Değişiklikleri kaydet'
                : 'Dersi oluştur'}
          </Btn>
          <button type="button" onClick={onClose} className="product-link">
            Vazgeç
          </button>
        </div>
      </form>
    </Dialog>
  )
}
export function CourseRemoval({ course, onClose, onRemoved }) {
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Dialog title="Dersi kalıcı olarak sil" onClose={onClose}>
      <form
        className="product-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            await api.deleteCourse(course.id, name)
            onRemoved()
          } catch (err) {
            setError(videoErrorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <p>
          Bu dersteki kendi materyallerin, arama kayıtların, sohbetlerin, video
          ilerlemen ve alıştırma sonuçların silinir. Başka kullanıcıların
          verileri silinmez. İşlem geri alınamaz.
        </p>
        <label>
          Onaylamak için “{course.name}” yaz
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && (
          <p role="alert" className="product-error">
            {error}
          </p>
        )}
        <div className="product-actions">
          <Btn type="submit" disabled={busy || name !== course.name}>
            {busy ? 'Silme işlemi sürüyor…' : 'Kalıcı olarak sil'}
          </Btn>
          <button type="button" onClick={onClose} className="product-link">
            Vazgeç
          </button>
        </div>
      </form>
    </Dialog>
  )
}
export function MaterialRename({ courseId, material, onClose, onSaved }) {
  const [title, setTitle] = useState(material.title),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  return (
    <Dialog title="Materyali yeniden adlandır" onClose={onClose}>
      <form
        className="product-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          try {
            const saved = await api.knowledgeRename(
              courseId,
              material.id,
              title.trim(),
            )
            onSaved(saved)
          } catch (e) {
            setError(videoErrorText(e))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          Materyal adı
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
          />
        </label>
        <p className="product-note">
          Görünen ad değişir. Özgün dosyanın içeriği korunur.
        </p>
        {error && (
          <p role="alert" className="product-error">
            {error}
          </p>
        )}
        <Btn type="submit" disabled={busy || !title.trim()}>
          {busy ? 'Kaydediliyor…' : 'Adı kaydet'}
        </Btn>
      </form>
    </Dialog>
  )
}
