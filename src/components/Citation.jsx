// Citation Pill: iddiayı kanıta bağlayan tek tıklamalık etiket.
export default function CitationPill({ turnId, claim, cite, active, onActivate }) {
  const partial = cite.strength === 'partial'
  const tone = active
    ? 'bg-accent border-accent text-white'
    : partial
      ? 'border-dashed border-gevesek-line bg-gevesek-tint text-gevesek hover:border-gevesek'
      : 'border-accent-line bg-accent-tint text-accent hover:border-accent'
  return (
    <button
      type="button"
      data-pill={`${turnId}:${claim.id}`}
      aria-pressed={active}
      aria-label={`Kaynak: ${cite.label}. Kanıtı göster${partial ? ' (kısmi destek)' : ''}`}
      onClick={(e) => { e.stopPropagation(); onActivate() }}
      className={`press inline-flex h-[22px] translate-y-[-1px] items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 align-middle font-mono text-[11.5px] font-medium ${tone}`}
    >
      <span
        aria-hidden
        className={`size-[6px] rounded-full ${active ? 'bg-white' : partial ? 'bg-gevesek' : 'bg-accent'} ${partial && !active ? 'opacity-70' : ''}`}
      />
      {cite.label}
    </button>
  )
}
