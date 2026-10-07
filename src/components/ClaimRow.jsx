import CitationPill from './Citation'
import ClaimMark from './ClaimMark'

// Claim Row: kutu yok. Aktif satır tek bir yüzeyle ayrışır, numara dolar.
export default function ClaimRow({ turnId, claim, active, onActivate }) {
  const gap = !!claim.gap
  return (
    <div
      role="group"
      aria-label={`İddia ${claim.n}`}
      data-claim={claim.id}
      data-active={active || undefined}
      onClick={() => onActivate(claim)}
      className={`-mx-3 grid cursor-pointer grid-cols-[22px_1fr] gap-x-3 rounded-xl px-3 py-3 transition-colors duration-200 ease-out ${
        active ? (gap ? 'bg-kopuk-tint' : 'bg-accent-tint') : 'hover:bg-ink/[0.03]'
      }`}
    >
      <span className="pt-[3px]">
        <ClaimMark n={gap && !claim.unsupported ? '–' : claim.n} active={active} tone={gap ? 'kopuk' : 'accent'} />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[17px] leading-[1.62] text-ink text-pretty" style={{ letterSpacing: '-0.012em' }}>
          {claim.text}
          {!gap && claim.cites.map((c) => (
            <span key={c.label + c.seg} className="ml-2 whitespace-nowrap">
              <CitationPill turnId={turnId} claim={claim} cite={c} active={active} onActivate={() => onActivate(claim, c)} />
            </span>
          ))}
        </p>
        {gap && (
          <>
            <p className="m-0 mt-1.5 max-w-[34rem] text-[14.5px] leading-relaxed text-ink-2">{claim.detail}</p>
            {claim.unsupported && (
              <span className="mt-2 inline-flex h-[22px] items-center rounded-[5px] bg-kopuk-tint px-1.5 font-mono text-[11px] font-medium text-kopuk">Kanıt yok</span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
