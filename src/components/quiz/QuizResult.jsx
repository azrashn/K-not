import { Check, X } from '@phosphor-icons/react'
import { Btn } from '../ui'
import { LETTERS } from './QuizTaking'

export default function QuizResult({ result, courseId, onOpenSource, onAgain, onBack }) {
  return (
    <div>
      <div className="rounded-xl border border-line bg-sheet p-6">
        <p className="m-0 text-[13px] font-medium text-ink-3">Sonucun</p>
        <p className="display num m-0 mt-1 text-[52px] leading-none text-ink" data-score>%{Math.round(result.score_pct)}</p>
        <p className="m-0 mt-2 text-[14.5px] text-ink-2">
          {result.total_count} sorunun <span className="num font-medium text-ink">{result.correct_count}</span>’ini doğru yanıtladın.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn onClick={onAgain}>Yeniden çöz</Btn>
          <Btn variant="soft" onClick={onBack}>Quizlere dön</Btn>
        </div>
      </div>

      <ol className="m-0 mt-6 list-none space-y-4 p-0">
        {result.results.map((r) => (
          <li key={r.question_id} data-result={r.question_id} className="rounded-xl border border-line bg-sheet p-5">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              {r.is_correct
                ? <span className="inline-flex items-center gap-1 text-siki"><Check size={14} weight="bold" aria-hidden /> Doğru</span>
                : <span className="inline-flex items-center gap-1 text-kopuk"><X size={14} weight="bold" aria-hidden /> {r.selected_index == null ? 'Boş bırakıldı' : 'Yanlış'}</span>}
              <span className="font-mono text-[12px] font-normal text-ink-3">{r.ordinal}. soru{r.topic ? ` · ${r.topic}` : ''}</span>
            </div>
            <p className="m-0 mt-2 text-[16px] font-medium leading-snug text-ink">{r.prompt}</p>
            <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
              {r.options.map((opt, i) => {
                const correct = i === r.correct_index
                const mine = i === r.selected_index
                return (
                  <li key={i} className={`flex gap-3 rounded-lg border px-3 py-2 text-[14px] ${correct ? 'border-siki-line bg-siki-tint text-ink' : mine ? 'border-kopuk-line bg-kopuk-tint text-ink' : 'border-line text-ink-2'}`}>
                    <span className="font-mono text-[12.5px] text-ink-3">{LETTERS[i]}</span>
                    <span className="min-w-0 flex-1">{opt}</span>
                    {correct && <span className="text-[12px] font-medium text-siki">Doğru cevap</span>}
                    {mine && !correct && <span className="text-[12px] font-medium text-kopuk">Senin cevabın</span>}
                  </li>
                )
              })}
            </ul>
            {r.explanation && <p className="m-0 mt-3 text-[14px] leading-relaxed text-ink-2">{r.explanation}</p>}
            <div className="mt-3 border-t border-hair pt-3">
              <p className="m-0 text-[12.5px] font-medium text-ink-3">Kaynak</p>
              {r.source.quote
                ? <blockquote className="m-0 mt-1 font-serif text-[15.5px] leading-[1.55] text-ink-2">“{r.source.quote}”</blockquote>
                : <p className="m-0 mt-1 text-[13.5px] text-ink-3">Kaynak belge silindi; alıntı artık gösterilemiyor.</p>}
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 text-[12.5px] text-ink-3">
                <span className="font-mono text-[12px]">{r.source.label || r.source.document_title}</span>
                {r.source.quote && r.source.document_id && (
                  <button type="button" onClick={() => onOpenSource(courseId, r.source)} className="press font-medium text-accent underline decoration-accent/30 underline-offset-4 hover:text-accent-deep">Kaynakta aç</button>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
