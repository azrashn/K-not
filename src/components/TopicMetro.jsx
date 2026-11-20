import { Check, X } from '@phosphor-icons/react'

// Konu haritası (metro): yalnızca gerçek alıştırma verisinden çizilir.
// Hat = materyal, durak = alıştırma yapılan konu (ilk çalışma sırasıyla).
// Durak durumu son denemenin sonucudur; öncül/ardıl ilişkisi ya da hâkimiyet puanı uydurulmaz.
const STATE = {
  ok: { label: 'Eşleşti', Icon: Check },
  review: { label: 'Tekrar incele', Icon: X },
  pending: { label: 'Değerlendirme bekliyor', Icon: null },
}
const stateOf = (score) => (score === 1 ? 'ok' : score === 0 ? 'review' : 'pending')

export function buildLines(attempts, courseNames = {}) {
  const lines = new Map()
  const ordered = [...attempts].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  for (const a of ordered) {
    const title = a.source?.title || courseNames[a.course_id] || 'Kaynak'
    const key = `${a.course_id}::${title}`
    if (!lines.has(key)) lines.set(key, { key, title, courseId: a.course_id, stops: new Map() })
    const line = lines.get(key)
    const topic = (a.topic || 'Konu').trim()
    const stop = line.stops.get(topic) || { topic, tries: 0 }
    line.stops.set(topic, { ...stop, tries: stop.tries + 1, last: a })
  }
  return [...lines.values()].map((l) => ({ ...l, stops: [...l.stops.values()] }))
}

export default function TopicMetro({ attempts, courseNames, onOpen }) {
  const lines = buildLines(attempts, courseNames)
  if (!lines.length) return null
  return (
    <section aria-label="Konu haritası" className="metro">
      <div className="section-heading">
        <h2>Konu haritası</h2>
        <span>Çalıştığın konular · gerçek denemelerden</span>
      </div>
      <div className="metro-card">
        {lines.map((line, i) => (
          <div key={line.key} className="metro-line" style={{ '--line': `var(--metro-${(i % 4) + 1})` }}>
            <div className="metro-line-name"><span className="metro-badge">{i + 1}</span>{line.title}</div>
            <ol className="metro-track">
              {line.stops.map((s) => {
                const st = STATE[stateOf(s.last.score)]
                const Icon = st.Icon
                return (
                  <li key={s.topic}>
                    <button type="button" className="metro-stop" data-state={stateOf(s.last.score)} onClick={() => onOpen(s.last)} title={`${s.topic} · ${st.label}`}>
                      <span className="metro-dot" aria-hidden>{Icon && <Icon size={11} weight="bold" />}</span>
                      <span className="metro-topic">{s.topic}</span>
                      <span className="metro-state">{st.label}{s.tries > 1 ? ` · ${s.tries} deneme` : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
        <p className="product-note">Durak, o konudaki son denemenin sonucunu gösterir; hâkimiyet tahmini değildir.</p>
      </div>
    </section>
  )
}
