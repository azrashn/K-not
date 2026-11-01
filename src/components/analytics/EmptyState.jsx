export default function EmptyState({ children, title }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-5 py-8 text-center">
      {title && <p className="m-0 text-[14.5px] font-medium text-ink">{title}</p>}
      <p className="m-0 mx-auto mt-1 max-w-[30rem] text-[13.5px] leading-relaxed text-ink-3">{children}</p>
    </div>
  )
}

// Her bölüm aynı çerçeveyi kullanır: 1px kenarlık, başlık, isteğe bağlı sağ alan.
export function Panel({ title, aside, children, className = '' }) {
  return (
    <section aria-label={title} className={`rounded-xl border border-line bg-sheet p-5 transition-colors hover:border-line-strong ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-[15px] font-semibold text-ink" style={{ letterSpacing: '-0.01em' }}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
