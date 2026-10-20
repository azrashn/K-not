import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/endpoints'
import { errorText } from '../../api/messages'
import { Btn } from '../ui'

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const SAVE_DELAY = 600

/** Soruları cevaplama ekranı. Cevap anahtarı yoktur; doğruluk yalnızca sunucuda hesaplanır. */
export default function QuizTaking({ quiz, attempt, onSubmitted, onExit }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries((attempt.answers ?? []).filter((a) => a.selected_index != null).map((a) => [a.question_id, a.selected_index])))
  const [save, setSave] = useState('idle') // idle | saving | saved | error
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  const latest = useRef(answers)
  latest.current = answers

  const payload = (map) => Object.entries(map).map(([question_id, selected_index]) => ({ question_id, selected_index }))
  const persist = async () => {
    setSave('saving')
    try { await api.saveAnswers(attempt.id, payload(latest.current)); setSave('saved') } catch { setSave('error') }
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const choose = (qid, idx) => {
    setAnswers((a) => ({ ...a, [qid]: idx }))
    clearTimeout(timer.current)
    timer.current = setTimeout(persist, SAVE_DELAY)
  }

  const total = quiz.questions.length
  const answered = useMemo(() => quiz.questions.filter((q) => answers[q.id] != null).length, [quiz, answers])
  const unanswered = total - answered

  const submit = async () => {
    clearTimeout(timer.current)
    setSubmitting(true)
    setError(null)
    try {
      onSubmitted(await api.submitAttempt(attempt.id, payload(latest.current)))
    } catch (e) {
      setError(e)
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 border-b border-line bg-paper/95 px-1 py-3">
        <div className="flex items-center justify-between gap-4 text-[13px] text-ink-3">
          <span><span className="num font-medium text-ink">{answered}</span> / {total} soru yanıtlandı</span>
          <span role="status" aria-live="polite">
            {save === 'saving' && 'Kaydediliyor…'}{save === 'saved' && 'Kaydedildi'}{save === 'error' && 'Kaydedilemedi; teslimde yeniden denenecek'}
          </span>
        </div>
        <div role="progressbar" aria-label="Quiz ilerlemesi" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered} className="mt-2 h-1.5 overflow-hidden rounded-sm bg-hair">
          <div className="h-full rounded-sm bg-accent transition-[width] duration-200" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </div>
      </div>

      <ol className="m-0 mt-6 list-none space-y-5 p-0">
        {quiz.questions.map((q) => (
          <li key={q.id} data-question={q.id} className="rounded-xl border border-line bg-sheet p-5 transition-colors hover:border-line-strong">
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-3 w-full p-0">
                <span className="font-mono text-[12px] text-ink-3">{q.ordinal}. soru · {q.type === 'true_false' ? 'Doğru / Yanlış' : 'Çoktan seçmeli'}</span>
                <span className="mt-1 block text-[16.5px] font-medium leading-snug text-ink">{q.prompt}</span>
              </legend>
              <div role="radiogroup" aria-label={`${q.ordinal}. soru seçenekleri`} className="space-y-2">
                {q.options.map((opt, i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-[14.5px] transition-colors ${answers[q.id] === i ? 'border-accent bg-accent-tint text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:bg-ink/[0.03]'}`}>
                    <input type="radio" name={`q-${q.id}`} className="mt-1 accent-[var(--color-accent)]" checked={answers[q.id] === i} onChange={() => choose(q.id, i)} disabled={submitting} />
                    <span className="font-mono text-[12.5px] text-ink-3">{LETTERS[i]}</span>
                    <span className="min-w-0 flex-1">{opt}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="m-0 mt-4 rounded-lg bg-kopuk-tint px-3 py-2 text-[13.5px] text-kopuk">{errorText(error)}</p>}

      <div className="mt-6 rounded-xl border border-line bg-sheet p-4">
        {!confirm ? (
          <div className="flex flex-wrap items-center gap-3">
            <Btn onClick={() => setConfirm(true)} disabled={submitting}>Quizi bitir</Btn>
            <Btn variant="quiet" onClick={onExit} disabled={submitting}>Sonra devam et</Btn>
          </div>
        ) : (
          <div role="alertdialog" aria-label="Teslim onayı">
            <p className="m-0 text-[14.5px] text-ink">
              {unanswered > 0 ? `${unanswered} soru boş kaldı. Yine de teslim etmek istiyor musun?` : 'Tüm sorular yanıtlandı. Teslim etmek istiyor musun?'}
            </p>
            <div className="mt-3 flex gap-2">
              <Btn onClick={submit} disabled={submitting}>{submitting ? 'Değerlendiriliyor…' : 'Teslim et'}</Btn>
              <Btn variant="quiet" onClick={() => setConfirm(false)} disabled={submitting}>Vazgeç</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
