import { House, BookOpen, Exam, ChartLineUp, SignOut } from '@phosphor-icons/react'
import { useAuth } from '../app/auth'

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
        current ? 'bg-ink text-white' : 'text-ink-3 hover:bg-white/70 hover:text-ink'
      }`}
    >
      <Icon size={vertical ? 22 : 20} weight={current ? 'fill' : 'regular'} aria-hidden />
      <span className={vertical ? 'text-[10.5px] font-medium leading-none' : 'text-[14px] font-medium'}>{item.label}</span>
    </button>
  )
}

export default function NavRail({ current, onSelect }) {
  return (
    <nav aria-label="Ana gezinme" className="flex w-[72px] shrink-0 flex-col items-center bg-rail py-4">
      <button type="button" onClick={() => onSelect('home')} aria-label="K-not ana sayfa" className="press mb-5 rounded-lg"><KnotMark /></button>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {NAV.map((item) => (
          <li key={item.id}><NavButton item={item} current={current === item.id} onSelect={onSelect} /></li>
        ))}
      </ul>
      <UserBadge />
    </nav>
  )
}

export const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toLocaleUpperCase('tr')).join('')

// Profil + çıkış. Oturum istemci tarafında sonlanır (JWT durumsuz; sunucuda iptal yok).
export function UserBadge({ vertical = true }) {
  const { user, logout } = useAuth()
  if (!user) return null
  return (
    <div className={`mt-auto flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-2`}>
      <div className="grid size-9 place-items-center rounded-full bg-ink/[0.06] font-mono text-[12px] font-semibold text-ink" title={user.display_name} aria-label={`Profil: ${user.display_name}`}>
        {initials(user.display_name)}
      </div>
      <button type="button" onClick={logout} aria-label="Çıkış yap" title="Çıkış yap" className="press grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-white/70 hover:text-ink">
        <SignOut size={18} aria-hidden />
      </button>
    </div>
  )
}
