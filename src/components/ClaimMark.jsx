// İddia numarası: çalışma alanındaki satır ile kaynak şeridini aynı işaretle eşler.
export default function ClaimMark({ n, active = true, tone = 'accent', size = 22 }) {
  const on = tone === 'kopuk' ? 'bg-kopuk text-white' : 'bg-accent text-white'
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold transition-[background-color,color,transform] duration-200 ease-out ${
        active ? `${on} scale-100` : tone === 'kopuk' ? 'bg-transparent text-kopuk' : 'bg-transparent text-ink-3'
      }`}
    >
      {n}
    </span>
  )
}
