import { useEffect, useState } from 'react'
import { api } from '../../api/endpoints'
import { errorText } from '../../api/messages'
import { useResource } from '../../hooks/useApi'
import { Btn } from '../ui'
import { LoadState } from '../../pages/Courses'

const isReady = (d) => d.status?.state === 'READY'
const COUNTS = [5, 10, 15]
const TYPES = [
  { id: 'multiple_choice', label: 'Çoktan seçmeli' },
  { id: 'true_false', label: 'Doğru / Yanlış' },
  { id: 'both', label: 'Her ikisi' },
]
const LEVELS = [
  { id: 'easy', label: 'Kolay' },
  { id: 'medium', label: 'Orta' },
  { id: 'hard', label: 'Zor' },
]

function Segment({ label, value, onChange, options }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">{label}</legend>
      <div role="radiogroup" aria-label={label} className="inline-flex gap-1 rounded-lg border border-line bg-sheet p-1">
        {options.map((o) => (
          <button
            key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
            className={`press h-9 rounded-md px-3.5 text-[14px] font-medium ${value === o.id ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** Ders → hazır materyaller → ayarlar → "Quiz Oluştur". */
export default function QuizSetup({ courses, initialCourseId, onCreated }) {
  const [courseId, setCourseId] = useState(initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0]?.id ?? '')
  const [picked, setPicked] = useState([])
  const [count, setCount] = useState(10)
  const [type, setType] = useState('both')
  const [level, setLevel] = useState('medium')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const docs = useResource((signal) => (courseId ? api.documents(courseId, signal) : Promise.resolve([])), [courseId])
  const ready = (docs.data ?? []).filter(isReady)
  useEffect(() => { setPicked([]); setError(null) }, [courseId])

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const quiz = await api.createQuiz(courseId, {
        document_ids: picked,
        question_count: count,
        question_types: type === 'both' ? ['multiple_choice', 'true_false'] : [type],
        difficulty: level,
      })
      onCreated(quiz)
    } catch (e) {
      setError(e)
      setBusy(false)
    }
  }

  return (
    <section aria-label="Yeni quiz" className="rounded-xl border border-line bg-sheet p-5 sm:p-6">
      <h2 className="display m-0 text-[24px] text-ink">Yeni quiz</h2>
      <p className="m-0 mt-1 max-w-[38rem] text-[13.5px] leading-relaxed text-ink-3">
        Sorular yalnızca seçtiğin materyallerden, doğrudan metin alıntılarıyla üretilir; bir yapay zekâ modeli kullanılmaz. Her sorunun kaynağı sonuçta gösterilir.
      </p>

      <div className="mt-6 space-y-6">
        <label className="block text-[13px] font-medium text-ink-2">
          Ders
          <select
            value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={busy}
            className="mt-1.5 block h-10 w-full max-w-[24rem] rounded-[10px] border border-line bg-white px-3 text-[14.5px] text-ink hover:border-line-strong"
          >
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ''}</option>)}
          </select>
        </label>

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">Materyaller <span className="font-normal text-ink-3">(yalnızca hazır olanlar)</span></legend>
          <LoadState loading={docs.loading} error={docs.error} onRetry={docs.reload} empty={!docs.loading && !docs.error && ready.length === 0}
            emptyText="Bu derste henüz hazır materyal yok. Dersin sayfasından bir PDF yükle ve hazır olmasını bekle." />
          {ready.length > 0 && (
            <ul className="m-0 list-none divide-y divide-hair rounded-lg border border-line p-0">
              {ready.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-ink/[0.03]">
                    <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} disabled={busy} />
                    <span className="min-w-0 flex-1 truncate text-[14.5px] text-ink">{d.title || d.original_filename}</span>
                    <span className="font-mono text-[12px] text-ink-3">{d.page_count ? `${d.page_count} s.` : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <Segment label="Soru sayısı" value={count} onChange={setCount} options={COUNTS.map((n) => ({ id: n, label: String(n) }))} />
          <Segment label="Soru türü" value={type} onChange={setType} options={TYPES} />
          <Segment label="Zorluk" value={level} onChange={setLevel} options={LEVELS} />
        </div>

        {error && (
          <p role="alert" className="m-0 rounded-lg bg-kopuk-tint px-3 py-2 text-[13.5px] text-kopuk">{errorText(error)}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Btn onClick={create} disabled={busy || picked.length === 0}>{busy ? 'Quiz hazırlanıyor…' : 'Quiz Oluştur'}</Btn>
          {picked.length === 0 && !busy && <span className="text-[13px] text-ink-3">En az bir materyal seç.</span>}
          {busy && <span role="status" className="text-[13px] text-ink-3">Sorular seçtiğin materyallerden çıkarılıyor…</span>}
        </div>
      </div>
    </section>
  )
}
