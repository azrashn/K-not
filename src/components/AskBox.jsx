import { useState } from 'react'
import { ArrowUp } from '@phosphor-icons/react'
import { SUGGESTIONS } from '../data/mock'

export default function AskBox({ onAsk, busy }) {
  const [value, setValue] = useState('')
  const submit = (e) => {
    e.preventDefault()
    const q = value.trim()
    if (!q || busy) return
    onAsk(q)
    setValue('')
  }
  return (
    <div className="shrink-0 border-t border-line bg-paper px-4 pb-4 pt-3 sm:px-6">
      <div className="mx-auto w-full max-w-[44rem]">
        <div className="mb-2.5 flex gap-2 overflow-x-auto pb-0.5 scroll-quiet [scrollbar-width:none]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onAsk(s)}
              className="press h-8 shrink-0 rounded-lg border border-line-strong bg-white px-3 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-line-strong bg-white py-1.5 pl-4 pr-1.5 transition-colors duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--color-accent-tint)]">
          <label htmlFor="ask" className="sr-only">Materyallerine bir soru sor</label>
          <input
            id="ask"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            placeholder="Materyallerine bir soru sor"
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={!value.trim() || busy}
            aria-label="Soruyu gönder"
            className="press grid size-9 place-items-center rounded-lg bg-ink text-white hover:bg-accent disabled:bg-line-strong disabled:text-ink-3"
          >
            <ArrowUp size={18} weight="bold" />
          </button>
        </form>
      </div>
    </div>
  )
}
