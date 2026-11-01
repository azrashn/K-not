const Card = ({ label, value, note }) => (
  <div className="rounded-xl border border-line bg-sheet p-4 transition-colors hover:border-line-strong" data-metric={label}>
    <p className="m-0 text-[12.5px] font-medium text-ink-3">{label}</p>
    <p className="display num m-0 mt-2 text-[34px] leading-none text-ink">{value ?? '—'}</p>
    <p className="m-0 mt-2 text-[12.5px] leading-snug text-ink-3">{note}</p>
  </div>
)

// Yalnızca gerçekten bilinen sayılar gösterilir; kaydedilmeyenler "—" ve açıklama taşır.
export default function SummaryCards({ topics }) {
  const studied = topics.filter((t) => t.score > 0).length
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card label="Çalışılan konular" value={studied} note={`${topics.length} konudan`} />
      <Card label="Tamamlanan quizler" note="Henüz quiz tamamlanmadı" />
      <Card label="Ortalama başarı" note="Henüz değerlendirme verisi yok" />
      <Card label="Çalışma süresi" note="Çalışma süresi henüz kaydedilmiyor" />
    </div>
  )
}
