import { ArrowUpRight } from '@phosphor-icons/react'

// Citation Pill: çerçevesiz, ton yüzeyli; hâlâ tıklanabilir olduğu ok işaretiyle anlaşılır.
export default function CitationPill({ turnId, claim, cite, active, onActivate }) {
  const partial = cite.strength === 'partial'
  const tone = active
    ? 'bg-accent text-white'
    : partial
      ? 'bg-gevesek-tint text-gevesek hover:bg-[#f6e4b5]'
      : 'bg-accent/[0.08] text-accent hover:bg-accent/[0.15]'
  return (
    <button
      type="button"
      data-pill={`${turnId}:${claim.id}`}
      aria-pressed={active}
      aria-label={`Kaynak: ${cite.label}. Kanıtı göster${partial ? ' (kısmi destek)' : ''}`}
      onClick={(e) => { e.stopPropagation(); onActivate() }}
      className={`press group/pill inline-flex h-[22px] translate-y-[-1px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 align-middle font-mono text-[11px] font-medium ${tone}`}
    >
      {partial && (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden className="shrink-0">
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 1a4 4 0 0 0 0 8z" fill="currentColor" />
        </svg>
      )}
      {cite.label}
      <ArrowUpRight size={10} weight="bold" aria-hidden className="opacity-55 transition-transform duration-150 group-hover/pill:-translate-y-px group-hover/pill:translate-x-px" />
    </button>
  )
}
