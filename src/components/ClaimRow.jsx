import CitationPill from './Citation'

// Claim Row: büyük balon yok; satır = iddia + kanıt etiketi.
export default function ClaimRow({ turnId, claim, active, onActivate, last }) {
  const gap = !!claim.gap
  const partial = claim.cites.some((c) => c.strength === 'partial')
  const node = active
    ? 'bg-accent border-accent shadow-[0_0_0_4px_var(--color-accent-tint)]'
    : gap
      ? 'border-dashed border-kopuk bg-transparent'
      : partial
        ? 'border-gevesek bg-gevesek-tint'
        : 'border-ink-3 bg-ink-3'

  return (
    <div
      role="group"
      data-claim={claim.id}
      data-active={active || undefined}
      onClick={() => onActivate(claim)}
      className={`grid cursor-pointer grid-cols-[18px_1fr] gap-x-3 px-4 py-3.5 transition-colors duration-200 ease-out sm:px-5 ${last ? '' : 'border-b border-line'} ${
        active ? 'bg-accent-tint/70' : 'hover:bg-white/60'
      }`}
    >
      <span aria-hidden className="mt-[0.68rem] grid place-items-center">
        <span className={`block size-[9px] rounded-full border transition-[background-color,box-shadow,border-color] duration-200 ease-out ${node}`} />
      </span>
      <div className="min-w-0">
        <p className={`m-0 text-[16.5px] leading-[1.6] text-pretty ${gap ? 'text-ink-2' : 'text-ink'}`} style={{ letterSpacing: '-0.011em' }}>
          {claim.text}
          {!gap && claim.cites.map((c) => (
            <span key={c.label + c.seg} className="ml-2 whitespace-nowrap">
              <CitationPill turnId={turnId} claim={claim} cite={c} active={active} onActivate={() => onActivate(claim, c)} />
            </span>
          ))}
        </p>
        {gap && (
          <>
            <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-ink-3">{claim.detail}</p>
            <span className="mt-2.5 inline-flex h-[22px] items-center rounded-md border border-dashed border-kopuk-line px-1.5 font-mono text-[11.5px] font-medium text-kopuk">
              Kaynak yok
            </span>
          </>
        )}
      </div>
    </div>
  )
}
