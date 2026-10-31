import { useEffect, useState } from 'react'
import { api } from '../api/endpoints'
import { videoErrorText } from '../lib/video'
export default function DocumentCanvas({
  courseId,
  material,
  source,
  segments,
  onSource,
}) {
  const [page, setPage] = useState(
      () => source?.location.page || source?.location.slide || 1,
    ),
    [zoom, setZoom] = useState(100),
    [url, setUrl] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const count =
      material.page_count ||
      Math.max(
        1,
        ...segments.map((s) => s.location.page || s.location.slide || 1),
      ),
    label = material.kind === 'PPTX' ? 'Slayt' : 'Sayfa'
  useEffect(() => {
    const n = source?.location.page || source?.location.slide
    if (n) setPage(n)
  }, [source?.location.page, source?.location.slide, material.id])
  useEffect(() => {
    const abort = new AbortController()
    let objectUrl
    setLoading(true)
    setError('')
    setUrl(null)
    api
      .knowledgeVisual(courseId, material.id, page, abort.signal)
      .then((blob) => {
        if (!abort.signal.aborted) {
          objectUrl = URL.createObjectURL(blob)
          setUrl({ page, value: objectUrl })
        }
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(videoErrorText(e))
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false)
      })
    return () => {
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [courseId, material.id, page])
  function go(n) {
    const next = Math.min(count, Math.max(1, n))
    setPage(next)
    const s = segments.find(
      (s) => (s.location.page || s.location.slide) === next,
    )
    onSource(s || null)
  }
  return (
    <section className="document-view" aria-label="Özgün materyal görünümü">
      <div className="document-toolbar">
        <div>
          <button
            aria-label={`Önceki ${label.toLocaleLowerCase('tr')}`}
            onClick={() => go(page - 1)}
            disabled={page <= 1}
          >
            ←
          </button>
          <label>
            {label}
            <input
              aria-label={`${label} numarası`}
              type="number"
              min="1"
              max={count}
              value={page}
              onChange={(e) => go(Number(e.target.value) || 1)}
            />
            <span>/ {count}</span>
          </label>
          <button
            aria-label={`Sonraki ${label.toLocaleLowerCase('tr')}`}
            onClick={() => go(page + 1)}
            disabled={page >= count}
          >
            →
          </button>
        </div>
        <div>
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 25))}
            aria-label="Uzaklaştır"
          >
            −
          </button>
          <span className="font-mono text-xs">%{zoom}</span>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 25))}
            aria-label="Yakınlaştır"
          >
            +
          </button>
          <button onClick={() => setZoom(100)}>Sığdır</button>
        </div>
      </div>
      <div className="document-canvas">
        {loading && (
          <div role="status" className="render-skeleton">
            {label} görüntüsü hazırlanıyor…
          </div>
        )}
        {error && (
          <p role="alert" className="product-error">
            Görüntü açılamadı: {error} Özgün dosyayı indirerek de
            inceleyebilirsin.
          </p>
        )}
        {url?.page === page && (
          <img
            src={url.value}
            alt={`${material.title} · ${label} ${page}`}
            style={{ width: `${zoom}%` }}
          />
        )}
      </div>
      <p className="viewer-note">
        Özgün{' '}
        {material.kind === 'PPTX' ? 'slayt düzeninden' : 'PDF sayfasından'}{' '}
        oluşturulan görüntü. Yapay zekâ şimdilik çıkarılmış metni kullanır.
      </p>
    </section>
  )
}
