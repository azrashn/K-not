import { useEffect, useId, useRef, useState } from 'react'
import { Btn } from './ui'
import { api } from '../api/endpoints'
import { videoErrorText } from '../lib/video'
export function PageTitle({ eyebrow, title, children, actions }) {
  return (
    <header className="product-title">
      <div>
        <p className="product-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children && <p className="product-description">{children}</p>}
      </div>
      <div className="product-actions">{actions}</div>
    </header>
  )
}
export function EmptyState({ title, children, action }) {
  return (
    <section className="product-empty">
      <span className="empty-mark" aria-hidden>
        +
      </span>
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
