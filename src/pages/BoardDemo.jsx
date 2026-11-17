import { useState } from 'react'
import { PageFrame } from '../components/ui'
import StepBoard from '../components/board/StepBoard'
import { BOARD_SAMPLE } from '../data/board-sample'
import { plainMath } from '../lib/board/content'
import { videoTime } from '../lib/video'

// Yalnızca geliştirmede açılan, giriş istemeyen deneme sayfası (#/tahta-deneme). API çağrısı yapmaz.
export default function BoardDemo() {
  const [run, setRun] = useState(0)
  const [last, setLast] = useState('')

  function onSource(item, step) {
    const where = Number.isFinite(item.ms) ? `videoda ${videoTime(item.ms / 1000)} anına`
      : item.page != null ? `belgenin ${item.page}. sayfasına`
        : item.slide != null ? `${item.slide}. slayta` : 'kaynağa'
    setLast(`${step + 1}. adımın kaynağı: ${where} gidilirdi.`)
  }

  return (
    <PageFrame max="max-w-[76rem]">
      <header className="border-b border-hair py-7">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">Geliştirme · tahta deneme</span>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em]">{BOARD_SAMPLE.question}</h1>
        <p className="mt-2 max-w-[48rem] text-sm text-ink-2">{plainMath(BOARD_SAMPLE.summary)}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className="board-control press" onClick={() => { setRun((n) => n + 1); setLast('') }}>Örneği yeniden yükle</button>
          <span className="text-xs text-ink-3">Örnek veri: src/data/board-sample.js · alıntılar yer tutucudur.</span>
        </div>
      </header>
      <section aria-label="Tahta" className="py-6">
        <StepBoard key={run} steps={BOARD_SAMPLE.steps} evidence={BOARD_SAMPLE.evidence} onSource={onSource} lang={BOARD_SAMPLE.language} />
        <p role="status" className="mt-4 min-h-5 font-mono text-xs text-ink-2">{last}</p>
      </section>
    </PageFrame>
  )
}
