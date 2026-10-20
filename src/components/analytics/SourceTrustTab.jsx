import { COVERAGE, TRUST_LABEL } from '../../data/academic'
import { TextLink } from '../ui'
import EmptyState, { Panel } from './EmptyState'

export default function SourceTrustTab({ stats, unsupported, navigate }) {
  const total = stats.full + stats.partial + stats.none
  const rows = ['full', 'partial', 'none'].map((id) => ({ id, n: stats[id], label: TRUST_LABEL[id], pct: total ? Math.round((stats[id] / total) * 100) : 0 }))
  return (
    <div className="grid gap-4">
      <Panel title="Yanıtların kaynak durumu" aside={<span className="font-mono text-[12px] text-ink-3">{total} yanıt</span>}>
        {total === 0 ? <EmptyState>Henüz yanıtlanmış soru yok.</EmptyState> : (
          <dl className="m-0 grid gap-3">
            {rows.map((r) => (
              <div key={r.id} data-trust={r.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-[14px] text-ink">{r.label}</dt>
                  <dd className="m-0 font-mono text-[12.5px] text-ink-3"><span className="num font-medium text-ink">{r.n}</span> · %{r.pct}</dd>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-hair" aria-hidden>
                  <div className="h-full rounded-sm bg-accent" style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </dl>
        )}
        <p className="m-0 mt-4 border-t border-hair pt-3 text-[12.5px] leading-relaxed text-ink-3">
          Bu sınıflandırma, yanıttaki iddiaların kaynak sayfalarla eşleşme oranına dayanan bir sezgiseldir; yanıtın doğruluğunu garanti etmez.
        </p>
      </Panel>

      <Panel title="Yeterli kaynak bulunamayan sorular" aside={<TextLink className="text-[12.5px]" onClick={() => navigate('/dersler/veri-yapilari', { upload: true })}>Materyal ekle</TextLink>}>
        {unsupported.length === 0 ? <EmptyState>Her sorunun materyallerinde bir karşılığı vardı.</EmptyState> : (
          <ul className="m-0 list-none p-0">
            {unsupported.map((u, i) => (
              <li key={`${u.question}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-hair py-2.5 first:border-t-0 first:pt-0">
                <span className="text-[14.5px] text-ink">{u.question}</span>
                <span className="text-[12.5px] text-ink-3">{u.when}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-3 text-[13px] text-ink-3">Bu sorulara K-not cevap uydurmadı. İlgili materyal eklersen aynı soru kaynağa bağlanabilir.</p>
      </Panel>

      <Panel title="Hangi materyaller kanıt oldu?">
        <ul className="m-0 list-none p-0">
          {COVERAGE.map((c) => (
            <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 border-t border-hair py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_4.5rem]">
              <span className="truncate font-mono text-[12.5px] text-ink" title={c.name}>{c.name}</span>
              <span className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-sm bg-hair sm:col-span-1 sm:row-start-auto" aria-hidden>
                <span className="block h-full rounded-sm bg-accent" style={{ width: `${(c.used / c.total) * 100}%` }} />
              </span>
              <span className="num text-right font-mono text-[12px] text-ink-3">{c.used} / {c.total} s.</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
