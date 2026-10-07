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
    <div className="shrink-0 bg-paper px-5 pb-4 pt-2 sm:px-8">
      <div className="mx-auto w-full max-w-[42rem]">
        <div className="scroll-quiet mb-2.5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => onAsk(s)}
              className="press h-8 shrink-0 rounded-lg bg-ink/[0.05] px-3 text-[13px] text-ink-2 hover:bg-ink/[0.09] hover:text-ink disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl bg-white py-1.5 pl-4 pr-1.5 shadow-[0_1px_2px_rgba(22,24,30,0.06),0_0_0_1px_rgba(22,24,30,0.07)] transition-shadow duration-150 focus-within:shadow-[0_0_0_2px_var(--color-accent),0_6px_20px_-10px_rgba(36,64,166,0.4)]">
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
            className="press grid size-9 place-items-center rounded-xl bg-ink text-white hover:bg-accent disabled:bg-ink/10 disabled:text-ink-3"
          >
            <ArrowUp size={18} weight="bold" />
          </button>
        </form>
      </div>
    </div>
  )
}
