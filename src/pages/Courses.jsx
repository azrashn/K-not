import { CaretRight } from '@phosphor-icons/react'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { useApp } from '../app/store'
import { useResource } from '../hooks/useApi'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { EASE_OUT } from '../lib/motion'
import { useState } from 'react'
import {
  CourseEditor,
  CourseRemoval,
  EmptyState,
  PageTitle,
} from '../components/ProductUI'

const ROLE = { STUDENT: 'Öğrenci', INSTRUCTOR: 'Öğretim üyesi' }

/** Ders kartındaki hazırlık özeti, sunucunun belge sayılarından. */
export function courseReadiness(d) {
  if (!d || d.total === 0) return { tone: 'busy', text: 'Henüz materyal yok' }
  if (d.processing > 0)
    return { tone: 'busy', text: `${d.processing} materyal hazırlanıyor` }
  if (d.failed > 0)
    return { tone: 'error', text: `${d.failed} materyalde sorun var` }
  return { tone: 'ready', text: 'Tüm materyaller hazır' }
}
const TONE = { ready: 'bg-siki', busy: 'bg-accent', error: 'bg-kopuk' }

export function LoadState({ loading, error, onRetry, empty, emptyText }) {
  if (loading) {
    return (
      <p
        className="m-0 flex items-center gap-3 py-8 text-[14.5px] text-ink-3"
        role="status"
      >
        <span className="flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="breathe size-1.5 rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
        Yükleniyor…
      </p>
    )
  }
  if (error) {
    return (
      <div role="alert" className="py-8">
        <p className="m-0 text-[15px] text-kopuk">{errorText(error)}</p>
        {onRetry && error.code !== 'NOT_FOUND' && (
          <Btn variant="soft" size="sm" className="mt-3" onClick={onRetry}>
            Tekrar dene
          </Btn>
        )}
      </div>
    )
  }
  if (empty)
    return <p className="m-0 py-8 text-[15px] text-ink-2">{emptyText}</p>
  return null
}

export default function Courses() {
  const { navigate } = useApp()
  const [archived, setArchived] = useState(false),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState('recent'),
    [editing, setEditing] = useState(null),
    [removing, setRemoving] = useState(null),
    [notice, setNotice] = useState('')
  const {
    data: courses,
    error,
    loading,
    reload,
  } = useResource((signal) => api.courses(signal, archived), [archived])
  const shown = [...(courses || [])]
    .filter((c) =>
      `${c.name} ${c.category || ''}`
        .toLocaleLowerCase('tr')
        .includes(search.toLocaleLowerCase('tr')),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'tr')
        : new Date(b.last_studied_at || 0) - new Date(a.last_studied_at || 0),
    )

  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Öğrenme alanların"
        title="Derslerin"
        actions={<Btn onClick={() => setEditing({})}>+ Yeni ders oluştur</Btn>}
      >
        Materyallerini bir araya getir. Her derste aynı çalışma bağlamından
        devam et.
      </PageTitle>
      <div className="product-toolbar">
        <input
          aria-label="Derslerde ara"
          placeholder="Ders adı veya alan ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Dersleri sırala"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="recent">Son çalışılan</option>
          <option value="name">Ada göre</option>
        </select>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Arşivdekileri göster
        </label>
      </div>
      {notice && (
        <p role="status" className="product-note">
          {notice}
        </p>
      )}

      <LoadState
        loading={loading}
        error={error}
        onRetry={reload}
        empty={courses?.length === 0}
        emptyText="Henüz bir dersin yok. İlk dersini oluşturup materyal ekleyebilirsin."
      />

      {shown.length > 0 && (
        <ul className="course-grid">
          {shown.map((c) => {
            const r = courseReadiness(c.documents)
            return (
              <li key={c.id} className="course-card">
                <button
                  type="button"
                  disabled={c.lifecycle === 'DELETING'}
                  onClick={() => navigate(`/dersler/${c.id}/ogrenme`)}
                  className="course-card-main"
                >
                  <span className="min-w-0">
                    <span className="course-glyph" aria-hidden>
                      ▤
                    </span>
                    <span className="block text-xl font-semibold tracking-tight text-ink">
                      {c.name}
                    </span>
                    <span className="mt-1 block text-[13.5px] text-ink-3">
                      {c.category || c.term}
                      {c.archived ? ' · Arşivde' : ''}
                    </span>
                  </span>

                  <span className="min-w-0 space-y-2 text-[14px]">
                    <span className="flex items-center gap-2 text-ink">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${TONE[r.tone]}`}
                      />
                      <span className="font-medium">
                        {c.lifecycle === 'DELETING'
                          ? 'Silme işlemi bekliyor'
                          : (c.material_count ?? c.documents.total) > 0
                            ? 'Materyallerle çalışmaya hazır'
                            : r.text}
                      </span>
                    </span>
                    <span className="block text-ink-3">
                      <span className="num">
                        {c.material_count ?? c.documents.total}
                      </span>{' '}
                      materyal ·{' '}
                      {c.last_studied_at
                        ? new Date(c.last_studied_at).toLocaleDateString(
                            'tr-TR',
                          )
                        : 'Henüz çalışma kaydı yok'}
                    </span>
                  </span>

                  <span className="flex items-center justify-between gap-6 md:justify-end">
                    <span className="text-[13px] text-ink-2">
                      {c.term}
                      {c.my_role ? ` · ${ROLE[c.my_role]}` : ''}
                    </span>
                    <CaretRight
                      size={16}
                      className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-1"
                      aria-hidden
                    />
                  </span>
                </button>
                {c.deletion_error && (
                  <p className="product-error mx-4 mb-3">{c.deletion_error}</p>
                )}
                <div className="course-card-actions">
                  {c.can_manage && (
                    <>
                      <button onClick={() => setEditing(c)}>Düzenle</button>
                      <button onClick={() => setRemoving(c)}>
                        {c.lifecycle === 'DELETING' ? 'Silmeyi sürdür' : 'Sil'}
                      </button>
                    </>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await api.archiveCourse(c.id, !c.archived)
                        setNotice(
                          c.archived
                            ? 'Ders arşivden çıkarıldı.'
                            : 'Ders yalnız senin listende arşivlendi. Materyallere dokunulmadı.',
                        )
                        reload()
                      } catch {
                        setNotice('İşlem tamamlanamadı.')
                      }
                    }}
                  >
                    {c.archived ? 'Arşivden çıkar' : 'Arşivle'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!loading && courses?.length > 0 && !shown.length && (
        <EmptyState title="Eşleşen ders yok">
          Aramanı değiştirebilir veya arşivdeki dersleri gösterebilirsin.
        </EmptyState>
      )}
      {editing && (
        <CourseEditor
          course={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(c) => {
            setEditing(null)
            reload()
            if (!editing.id) navigate(`/dersler/${c.id}/ogrenme`)
          }}
        />
      )}
      {removing && (
        <CourseRemoval
          course={removing}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null)
            reload()
            setNotice('Ders ve kendi öğrenme verilerin silindi.')
          }}
        />
      )}
    </PageFrame>
  )
}
