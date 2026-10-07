import { House, BookOpen, Exam, ChartLineUp } from '@phosphor-icons/react'

export const NAV = [
  { id: 'home', label: 'Ana Sayfa', Icon: House },
  { id: 'courses', label: 'Dersler', Icon: BookOpen },
  { id: 'quiz', label: 'Quiz', Icon: Exam },
  { id: 'analytics', label: 'Analitik', Icon: ChartLineUp },
]

export function KnotMark({ size = 32 }) {
  // K harfi: gövde + iki kol, kolların buluştuğu yerde düğüm.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#16181e" />
      <path d="M11 8v16M11 16.5L21.5 8M11 16.5L21.5 24" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="11" cy="16.5" r="3" fill="#16181e" stroke="#9db0f2" strokeWidth="1.6" />
    </svg>
  )
}

export function NavButton({ item, current, onSelect, vertical = true }) {
  const { Icon } = item
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={current ? 'page' : undefined}
      className={`press group flex ${vertical ? 'w-14 flex-col items-center gap-1 py-2' : 'w-full flex-row items-center gap-3 px-3 py-2.5'} rounded-xl ${
        current ? 'bg-ink text-white' : 'text-ink-3 hover:bg-white hover:text-ink'
      }`}
    >
      <Icon size={vertical ? 22 : 20} weight={current ? 'fill' : 'regular'} aria-hidden />
      <span className={vertical ? 'text-[10.5px] font-medium leading-none' : 'text-[14px] font-medium'}>{item.label}</span>
    </button>
  )
}

export default function NavRail({ current, onSelect }) {
  return (
    <nav aria-label="Ana gezinme" className="flex w-[72px] shrink-0 flex-col items-center border-r border-line bg-paper py-4">
      <div className="mb-5"><KnotMark /></div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {NAV.map((item) => (
          <li key={item.id}><NavButton item={item} current={current === item.id} onSelect={onSelect} /></li>
        ))}
      </ul>
      <div className="mt-auto grid size-9 place-items-center rounded-full border border-line-strong bg-white font-mono text-[12px] font-semibold text-ink" title="Öğrenci" aria-label="Profil">
        A
      </div>
    </nav>
  )
}
