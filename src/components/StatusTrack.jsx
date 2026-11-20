import { MATERIAL_STATES, STATE_ORDER } from '../data/academic'

// Materyal durumu: insan dilinde etiket + dört adımlık sessiz ilerleme izi.
export default function StatusTrack({ status }) {
  const s = MATERIAL_STATES[status]
  const idx = STATE_ORDER.indexOf(status)
  const error = status === 'error'
  const busy = !error && status !== 'ready'
  // Hazır olan materyal sessiz kalır; ilerleme izi yalnızca hazırlanan ya da sorunlu olanda görünür.
  if (status === 'ready') {
    return (
      <span className="inline-flex items-center gap-2" data-status={status}>
        <span aria-hidden className="size-1.5 rounded-full bg-siki" />
        <span className="text-[13px] font-medium text-ink-2">{s.label}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2.5" data-status={status}>
      <span aria-hidden className="flex items-center gap-[3px]">
        {STATE_ORDER.map((k, i) => (
          <span
            key={k}
            className={`h-[3px] w-3.5 rounded-full transition-colors duration-500 ${
              error ? (i === 0 ? 'bg-kopuk' : 'bg-ink/10') : i <= idx ? (status === 'ready' ? 'bg-siki' : 'bg-accent') : 'bg-ink/10'
            } ${busy && i === idx ? 'breathe' : ''}`}
          />
        ))}
      </span>
      <span className={`text-[13px] font-medium ${error ? 'text-kopuk' : status === 'ready' ? 'text-siki' : 'text-ink-2'}`}>{s.label}</span>
    </span>
  )
}
