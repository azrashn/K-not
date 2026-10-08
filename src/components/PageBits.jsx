import { List } from '@phosphor-icons/react'
import { useApp } from '../app/store'
import { KnotMark } from './NavRail'

// Masaüstünde ray var; küçük ekranlarda her sayfa aynı menü düğmesini taşır.
export function MobileBar({ title }) {
  const { setMenuOpen } = useApp()
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-4 lg:hidden">
      <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menüyü aç" className="press -ml-1 grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-white">
        <List size={20} />
      </button>
      <KnotMark size={24} />
      {title && <span className="text-[14px] font-semibold text-ink">{title}</span>}
    </div>
  )
}

// Arka ucu henüz olmayan ekranlar (WBS-6/7/8) için açık etiket: gerçek veriyle karışmaz.
export function SampleNotice({ children }) {
  return (
    <p role="note" data-sample-notice className="m-0 mt-4 inline-flex items-center gap-2 rounded-lg bg-gevesek-tint px-3 py-1.5 text-[13px] text-gevesek">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">Örnek veri</span>
      <span>{children || 'Bu ekran henüz gerçek verilere bağlı değil.'}</span>
    </p>
  )
}
