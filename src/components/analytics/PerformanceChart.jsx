import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import EmptyState, { Panel } from './EmptyState'

/** Gün bazında ortalama başarı; en az iki farklı tarih gerekir. */
export function dailySeries(attempts) {
  const byDay = new Map()
  for (const a of attempts) {
    const day = String(a.submitted_at).slice(0, 10)
    const d = byDay.get(day) ?? { sum: 0, n: 0 }
    d.sum += a.score_pct
    d.n += 1
    byDay.set(day, d)
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({
    day, label: new Date(`${day}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }), pct: Math.round(d.sum / d.n),
  }))
}

export default function PerformanceChart({ attempts = [] }) {
  const data = dailySeries(attempts)
  return (
    <Panel title="Performans gelişimi">
      {data.length < 2 ? (
        <EmptyState>Performans geçmişi için en az iki farklı tarihte quiz tamamlamanız gerekiyor.</EmptyState>
      ) : (
        <>
          <div aria-hidden style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--color-hair)" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-ink-3)' }} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: 'var(--color-ink-3)' }} unit="%" />
                <Tooltip formatter={(v) => [`%${v}`, 'Başarı']} />
                <Line type="monotone" dataKey="pct" stroke="var(--color-accent)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Günlük ortalama quiz başarısı</caption>
            <thead><tr><th>Tarih</th><th>Başarı</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.day}><td>{d.label}</td><td>%{d.pct}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </Panel>
  )
}
