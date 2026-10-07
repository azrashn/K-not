import { ArrowRight } from '@phosphor-icons/react'

const base = 'press inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium disabled:cursor-not-allowed'
const sizes = { md: 'h-10 px-4 text-[14px]', sm: 'h-9 px-3 text-[13.5px]' }
const variants = {
  primary: 'bg-accent text-white hover:bg-accent-deep disabled:bg-ink/10 disabled:text-ink-3',
  soft: 'bg-ink/[0.06] text-ink hover:bg-ink/[0.1] disabled:opacity-50',
  quiet: 'text-ink-2 hover:bg-ink/[0.05] hover:text-ink',
}

export function Btn({ variant = 'primary', size = 'md', arrow, className = '', children, ...rest }) {
  return (
    <button type="button" className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {children}
      {arrow && <ArrowRight size={15} weight="bold" aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5" />}
    </button>
  )
}

export function TextLink({ className = '', children, ...rest }) {
  return (
    <button type="button" className={`press font-medium text-accent underline decoration-accent/30 underline-offset-[5px] hover:text-accent-deep hover:decoration-accent ${className}`} {...rest}>
      {children}
    </button>
  )
}

// Sayfa iskeleti: kaydırma kabı + okunur genişlik
export function PageFrame({ children, max = 'max-w-[68rem]' }) {
  return (
    <div className="scroll-quiet h-full overflow-y-auto" data-scroll>
      <div className={`mx-auto w-full ${max} px-5 pb-24 sm:px-10`}>{children}</div>
    </div>
  )
}

export const Section = ({ title, aside, children, className = '' }) => (
  <section className={className}>
    <div className="mb-2 flex items-baseline justify-between gap-4">
      <h2 className="m-0 text-[12.5px] font-medium text-ink-3">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
)
