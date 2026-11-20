import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { daysUntil, pageLabel, pageMark, pageRanges, readExamDate } from '../lib/coverage'

// Tek kare. memo: tek bir sayfa değişince 300 karenin hepsi yeniden çizilmez.
const Cell = memo(function Cell({ page, tab }) {
  const label = pageLabel(page)
  return (
    <button
      type="button"
      className="coverage-cell"
      data-page={page.page}
      data-asked={page.asked}
      data-practiced={page.practiced}
      data-touched={page.asked || page.practiced}
      tabIndex={tab ? 0 : -1}
      aria-label={label}
      title={label}
    >
      {pageMark(page)}
    </button>
  )
})

function PageGrid({ material, onOpen }) {
  const [focus, setFocus] = useState(1)
  const box = useRef(null)
  const linked = material.kind === 'PDF'
  const pageOf = (el) => Number(el?.closest?.('[data-page]')?.dataset.page)
  const move = (to) => {
    const next = Math.min(material.page_count, Math.max(1, to))
    setFocus(next)
    box.current?.querySelector(`[data-page="${next}"]`)?.focus()
  }
  // Tek tab durağı (roving tabindex): ok tuşları kareler arasında gezer.
  const onKeyDown = (e) => {
    const page = pageOf(e.target)
    if (!page) return
    const cells = box.current.querySelectorAll('.coverage-cell')
    const columns = [...cells].filter((c) => c.offsetTop === cells[0].offsetTop).length || 1
    const keys = { ArrowRight: page + 1, ArrowLeft: page - 1, ArrowDown: page + columns, ArrowUp: page - columns, Home: 1, End: material.page_count }
    if (!(e.key in keys)) return
    e.preventDefault()
    move(keys[e.key])
  }
  const onClick = (e) => {
    const page = pageOf(e.target)
    if (page && linked) onOpen(material, page)
  }
  return (
    <div
      ref={box}
      className="coverage-grid"
      role="group"
      aria-label={`${material.title} sayfa haritası`}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onFocus={(e) => {
        const p = pageOf(e.target)
        if (p) setFocus(p)
      }}
    >
      {material.pages.map((p) => (
        <Cell key={p.page} page={p} tab={p.page === focus} />
      ))}
    </div>
  )
}

function PageLink({ m, page, onOpen }) {
  if (m.kind !== 'PDF') return <span className="coverage-page-num">{page}</span>
  return (
    <button type="button" className="coverage-page-link" onClick={() => onOpen(m, page)} aria-label={`${m.title} sayfa ${page} aç`}>
      {page}
    </button>
  )
}

export default function CoverageMap({ courseId, onOpenPage }) {
  const resource = useResource((signal) => api.coverage(courseId, signal), [courseId])
  const exam = useMemo(readExamDate, [])
  const left = exam ? daysUntil(exam.date) : null
  const open = useCallback((m, page) => onOpenPage?.(m, page), [onOpenPage])
  const data = resource.data
  if (resource.loading && !data)
    return (
      <section className="coverage" aria-busy="true" aria-label="Kapsam">
        <p className="coverage-note">Kapsam yükleniyor…</p>
      </section>
    )
  if (resource.error || !data)
    return (
      <section className="coverage" aria-label="Kapsam">
        <p className="coverage-note" role="alert">Kapsam haritası şu an alınamadı.</p>
      </section>
    )
  const materials = data.materials
  const total = materials.reduce((n, m) => n + m.page_count, 0)
  const touched = materials.reduce((n, m) => n + m.touched_count, 0)
  const showExam = left !== null && left >= 0 && touched > 0
  return (
    <section className="coverage" aria-labelledby="coverage-h">
      <h2 id="coverage-h" className="coverage-title">Kapsam</h2>
      {touched === 0 ? (
        <p className="coverage-note">Henüz kayıtlı bir çalışma yok.</p>
      ) : (
        <>
          <p className="coverage-count" data-testid="coverage-total">
            <span className="coverage-num">{touched}</span> / <span className="coverage-num">{total}</span> sayfaya dokundun
          </p>
          {showExam && (
            <p className="coverage-exam" data-testid="coverage-exam">
              <span className="coverage-num">{left === 0 ? 'Sınav bugün' : `Sınava ${left} gün var`}</span>
              {total - touched > 0 ? `: hiç bakmadığın ${total - touched} sayfa var.` : '.'}
            </p>
          )}
          {materials.map((m) => {
            const ranges = pageRanges(m.untouched_pages)
            return (
              <article className="coverage-material" key={m.material_id} data-material-coverage={m.material_id}>
                <h3 className="coverage-name">{m.title}</h3>
                <p className="coverage-count">
                  <span className="coverage-num">{m.touched_count}</span> / <span className="coverage-num">{m.page_count}</span> sayfa
                </p>
                <PageGrid material={m} onOpen={open} />
                {showExam && m.untouched_pages.length > 0 && (
                  <p className="coverage-untouched" data-testid="coverage-untouched">
                    Hiç bakmadığın sayfalar:{' '}
                    {ranges.map(([a, b], i) => (
                      <span key={a}>
                        {i > 0 && ', '}
                        <PageLink m={m} page={a} onOpen={open} />
                        {b !== a && (
                          <>
                            –<PageLink m={m} page={b} onOpen={open} />
                          </>
                        )}
                      </span>
                    ))}
                  </p>
                )}
              </article>
            )
          })}
          <p className="coverage-legend">
            <span className="coverage-key" data-k="S">S</span> soruldu · <span className="coverage-key" data-k="A">A</span> alıştırmada çıktı · boş kare: dokunulmadı.
            Sayfa açma kaydı tutulmuyor; yalnızca sohbette kaynak gösterilen ve alıştırma sorusunun geldiği sayfalar işaretlenir.
          </p>
        </>
      )}
    </section>
  )
}
