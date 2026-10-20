import { useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { errorText } from '../api/messages'
import { useApp } from '../app/store'
import { useResource } from '../hooks/useApi'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import QuizSetup from '../components/quiz/QuizSetup'
import QuizTaking from '../components/quiz/QuizTaking'
import QuizResult from '../components/quiz/QuizResult'
import { LoadState } from './Courses'

const DIFFICULTY = { easy: 'Kolay', medium: 'Orta', hard: 'Zor' }
const when = (iso) => (iso ? new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : '')

function QuizList({ quizzes, courses, onOpen, onResult }) {
  const courseName = (id) => courses.find((c) => c.id === id)?.name ?? ''
  return (
    <section aria-label="Önceki quizler" className="mt-10">
      <h2 className="m-0 mb-2 text-[12.5px] font-medium text-ink-3">Önceki quizlerin</h2>
      {quizzes.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-line-strong px-5 py-6 text-[14px] text-ink-3">Henüz quiz oluşturmadın. Yukarıdan bir ders ve materyal seçerek ilk quizini oluştur.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-hair rounded-xl border border-line bg-sheet p-0">
          {quizzes.map((q) => {
            const done = q.latest_attempt?.status === 'SUBMITTED'
            const open = q.latest_attempt?.status === 'IN_PROGRESS'
            return (
              <li key={q.id} data-quiz={q.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 transition-colors hover:bg-ink/[0.02]">
                <div className="min-w-0">
                  <p className="m-0 truncate text-[15px] font-medium text-ink">{q.title}</p>
                  <p className="m-0 text-[12.5px] text-ink-3">
                    {courseName(q.course_id)} · {q.question_count} soru · {DIFFICULTY[q.difficulty] ?? q.difficulty} · {when(q.created_at)}
                    {done && <> · <span className="font-medium text-ink">%{Math.round(q.latest_attempt.score_pct)}</span></>}
                    {open && ' · devam ediyor'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {done && <Btn size="sm" variant="soft" onClick={() => onResult(q)}>Sonucu gör</Btn>}
                  <Btn size="sm" variant={done ? 'quiet' : 'primary'} onClick={() => onOpen(q)}>{open ? 'Devam et' : done ? 'Tekrar çöz' : 'Başla'}</Btn>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function Quiz() {
  const { navigate, takeIntent } = useApp()
  const courses = useResource((signal) => api.courses(signal), [])
  const quizzes = useResource((signal) => api.quizzes(null, signal), [])
  const [view, setView] = useState({ name: 'home' }) // home | loading | taking | result
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState(null)
  const [initialCourse, setInitialCourse] = useState(null)
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    if (i?.courseId) setInitialCourse(i.courseId)
  }, [takeIntent])

  const home = () => { setView({ name: 'home' }); quizzes.reload() }
  const fail = (e) => { setError(e); setView({ name: 'home' }) }

  const begin = async (quiz, { fresh = false } = {}) => {
    setError(null)
    setView({ name: 'loading' })
    try {
      const attemptId = !fresh && quiz.latest_attempt?.status === 'IN_PROGRESS' ? quiz.latest_attempt.id : null
      if (attemptId) {
        const a = await api.attempt(attemptId)
        setView({ name: 'taking', quiz: a.quiz, attempt: a })
      } else {
        const full = quiz.questions ? quiz : await api.quiz(quiz.id)
        const attempt = await api.startAttempt(full.id)
        setView({ name: 'taking', quiz: full, attempt })
      }
    } catch (e) { fail(e) }
  }
  const showResult = async (quiz) => {
    setError(null)
    setView({ name: 'loading' })
    try {
      const result = await api.attempt(quiz.latest_attempt.id)
      setView({ name: 'result', result, courseId: quiz.course_id, quiz })
    } catch (e) { fail(e) }
  }
  const created = (quiz) => {
    setWarnings(quiz.warnings ?? [])
    quizzes.reload()
    begin(quiz, { fresh: true })
  }
  const openSource = (courseId, s) => navigate(`/dersler/${courseId}/calisma`, { openDoc: { id: s.document_id, page: s.page_start ?? 1 } })

  const list = courses.data ?? []
  return (
    <PageFrame>
      <MobileBar />
      <header className="pb-6 pt-4 lg:pt-14">
        <h1 className="display m-0 text-[40px] text-ink sm:text-[52px]">Quiz</h1>
        <p className="m-0 mt-3 max-w-[36rem] text-[16.5px] leading-relaxed text-ink-2">
          Kendi materyallerinden quiz oluştur, çöz ve kaynağıyla birlikte değerlendir.
        </p>
      </header>

      {error && <p role="alert" className="m-0 mb-4 rounded-lg bg-kopuk-tint px-3 py-2 text-[13.5px] text-kopuk">{errorText(error)}</p>}

      {view.name === 'loading' && <LoadState loading />}

      {view.name === 'home' && (
        <>
          <LoadState loading={courses.loading} error={courses.error} onRetry={courses.reload} empty={!courses.loading && !courses.error && list.length === 0}
            emptyText="Quiz oluşturmak için önce bir ders ekle ve en az bir PDF materyalini yükle." />
          {list.length > 0 && <QuizSetup courses={list} initialCourseId={initialCourse} onCreated={created} />}
          {list.length === 0 && !courses.loading && !courses.error && <Btn onClick={() => navigate('/dersler')}>Derslere git</Btn>}
          {!quizzes.loading && !quizzes.error && <QuizList quizzes={quizzes.data ?? []} courses={list} onOpen={begin} onResult={showResult} />}
          {quizzes.error && <LoadState error={quizzes.error} onRetry={quizzes.reload} />}
        </>
      )}

      {view.name === 'taking' && (
        <>
          <h2 className="display m-0 text-[26px] text-ink">{view.quiz.title}</h2>
          {warnings.map((w) => <p key={w} role="status" className="m-0 mt-3 rounded-lg bg-gevesek-tint px-3 py-2 text-[13.5px] text-gevesek">{w}</p>)}
          {view.quiz.question_count < view.quiz.requested_count && (
            <p role="status" className="m-0 mt-3 rounded-lg bg-gevesek-tint px-3 py-2 text-[13.5px] text-gevesek">
              {view.quiz.requested_count} soru istedin, seçtiğin materyallerden yalnızca {view.quiz.question_count} güvenilir soru çıkarılabildi.
            </p>
          )}
          <p className="m-0 mt-3 text-[12.5px] text-ink-3">Sorular, seçilen materyallerden metin alıntılarıyla çıkarıldı (yapay zekâ modeli kullanılmadı).</p>
          <QuizTaking
            quiz={view.quiz} attempt={view.attempt}
            onSubmitted={(result) => { setWarnings([]); setView({ name: 'result', result, courseId: view.quiz.course_id, quiz: view.quiz }) }}
            onExit={() => { setWarnings([]); home() }}
          />
        </>
      )}

      {view.name === 'result' && (
        <QuizResult
          result={view.result} courseId={view.courseId} onOpenSource={openSource}
          onAgain={() => begin(view.quiz, { fresh: true })} onBack={home}
        />
      )}
    </PageFrame>
  )
}
