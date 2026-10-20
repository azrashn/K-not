import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { LEARN_LABEL, topicState } from '../../data/academic'
import EmptyState, { Panel } from './EmptyState'

const ROW = 34

export default function TopicPerformance({ topics, focusId }) {
  const data = topics.filter((t) => t.score > 0).sort((a, b) => b.score - a.score)
    .map((t) => ({ id: t.id, name: t.name, pct: Math.round(t.score * 100), state: topicState(t.score) }))
  const unrated = topics.filter((t) => t.score <= 0)
  return (
    <Panel title="Konu bazlı performans">
      {data.length === 0 ? <EmptyState>Henüz değerlendirilen konu yok.</EmptyState> : (
        <>
          <div aria-hidden style={{ height: data.length * ROW + 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis type="category" dataKey="name" width={150} axisLine={false} tickLine={false} tick={{ fontSize: 13, fill: 'var(--color-ink-2)' }} />
                <Bar dataKey="pct" radius={2} isAnimationActive={false} background={{ fill: 'var(--color-hair)', radius: 2 }}
                  label={{ position: 'right', fontSize: 12, fontFamily: 'var(--font-mono)', fill: 'var(--color-ink-3)', formatter: (v) => `%${v}` }}>
                  {data.map((d) => <Cell key={d.id} fill={d.id === focusId ? 'var(--color-accent-deep)' : 'var(--color-accent)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Konu bazlı başarı</caption>
            <thead><tr><th>Konu</th><th>Başarı</th><th>Durum</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.id}><td>{d.name}</td><td>%{d.pct}</td><td>{LEARN_LABEL[d.state]}</td></tr>)}</tbody>
          </table>
          {unrated.length > 0 && (
            <p className="m-0 mt-3 border-t border-hair pt-3 text-[13px] text-ink-3">
              {LEARN_LABEL.open}: {unrated.map((t) => t.name).join(', ')}
            </p>
          )}
        </>
      )}
    </Panel>
  )
}
