import { useEffect, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { useApp } from '../app/store'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { PageTitle, EmptyState } from '../components/ProductUI'
import { videoErrorText } from '../lib/video'
const labels = {
  MULTIPLE_CHOICE: 'Çoktan seçmeli',
  TRUE_FALSE: 'Kaynak doğrulama · doğru / yanlış',
  CLOZE: 'Boşluk doldurma',
  SHORT_ANSWER: 'Kısa yanıt',
  OPEN: 'Açık uçlu yansıtma',
}
export default function CourseQuiz({ courseId }) {
  const { navigate, takeIntent } = useApp(),
    courses = useResource((signal) => api.courses(signal), [])
  const [course, setCourse] = useState(courseId || ''),
    [topic, setTopic] = useState(''),
    [kind, setKind] = useState('MULTIPLE_CHOICE'),
    [material, setMaterial] = useState('')
  const [materials, setMaterials] = useState([]),
    [history, setHistory] = useState([]),
    [quiz, setQuiz] = useState(null),
    [answer, setAnswer] = useState(''),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const intent = takeIntent?.()
    if (intent?.topic) setTopic(intent.topic.slice(0, 200))
    if (intent?.quizId && courseId)
      api
        .quiz(courseId, intent.quizId)
        .then(setQuiz)
        .catch((e) => setError(videoErrorText(e)))
  }, [takeIntent, courseId])
  useEffect(() => {
    if (!course) return
    const abort = new AbortController()
    Promise.all([
      api.knowledgeMaterials(course, abort.signal),
      api.quizzes(course, abort.signal),
    ])
      .then(([m, h]) => {
        setMaterials(m.materials)
        setHistory(h)
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(videoErrorText(e))
      })
    return () => abort.abort()
  }, [course])
  async function start(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    setAnswer('')
    try {
      const q = await api.createQuiz(course, {
        topic: topic.trim(),
        kind,
        ...(material ? { material_id: material } : {}),
      })
      setQuiz(q)
      setHistory(await api.quizzes(course))
    } catch (err) {
      setError(videoErrorText(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Kaynakla çalış, geri bildirim al"
        title="Alıştırmalar"
        actions={
          <button
            className="product-link"
            onClick={() => navigate('/analitik')}
          >
            Sonuçlarım →
          </button>
        }
      >
        Sorular ders kaynaklarına bağlanır. Geri bildirimden ilgili sayfa, slayt
        veya video bölümüne dönebilirsin.
      </PageTitle>
      <div className="quiz-layout">
        <aside>
          <form className="product-panel product-form" onSubmit={start}>
            <h2>Çalışma kapsamı</h2>
            <label>
              Ders
              <select
                aria-label="Ders"
                value={course}
                onChange={(e) => {
                  setCourse(e.target.value)
                  setQuiz(null)
                  setResult(null)
                  setMaterial('')
                }}
              >
                <option value="">Ders seç</option>
                {courses.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Konu
              <input
                aria-label="Konu"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                placeholder="Kaynaklarında geçen bir konu yaz"
              />
            </label>
            <label>
              Kaynak kapsamı
              <select
                aria-label="Kaynak kapsamı"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              >
                <option value="">Dersin tüm hazır kaynakları</option>
                {materials
                  .filter((m) => m.status === 'READY')
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.kind} · {m.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Soru türü
              <select
                aria-label="Soru türü"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="product-note">
              Çoktan seçmeli model soruları deneyseldir. Doğrulanamazsa açıkça
              etiketlenen, kaynak sözcüklerine dayalı bir hatırlama sorusu
              hazırlanır. Kaynak doğrulama ve boşluk doldurma, metne dayalı
              hatırlama pratiğidir. Açık uçlu yanıtlar kaydedilir; otomatik
              başarı puanı verilmez.
            </p>
            <Btn type="submit" disabled={busy || !course || !topic.trim()}>
              {busy ? 'Kaynaklı soru hazırlanıyor…' : 'Alıştırma hazırla'}
            </Btn>
          </form>
          <div className="section-heading mt-6">
            <h2>Önceki alıştırmalar</h2>
          </div>
          {history.map((q) => (
            <button
              key={q.id}
              className="resume-row"
              onClick={async () => {
                try {
                  setQuiz(await api.quiz(course, q.id))
                  setResult(null)
                  setAnswer('')
                } catch (e) {
                  setError(videoErrorText(e))
                }
              }}
            >
              <strong>{q.topic}</strong>
              <small>
                {labels[q.kind]} ·{' '}
                {q.attempts?.[0]?.outcome === 'CORRECT'
                  ? 'Eşleşen yanıt'
                  : q.attempts?.length
                    ? 'Yanıtlandı'
                    : 'Yanıt bekliyor'}
              </small>
            </button>
          ))}
        </aside>
        <section>
          {error && (
            <p role="alert" className="product-error">
              {error}
            </p>
          )}
          {!quiz ? (
            <EmptyState title="Öğrendiklerini dene">
              Bir ders, konu ve soru türü seç. Gerçek kaynak bulunduğunda
              alıştırman burada açılır.
            </EmptyState>
          ) : (
            <article className="quiz-question product-panel">
              <span className="source-badge">{labels[quiz.kind]}</span>
              <h2>{quiz.question}</h2>
              {quiz.note && <p className="product-note mb-5">{quiz.note}</p>}
              <form
                className="product-form"
                onSubmit={async (e) => {
                  e.preventDefault()
                  setBusy(true)
                  try {
                    setResult(await api.answerQuiz(course, quiz.id, answer))
                    setHistory(await api.quizzes(course))
                  } catch (err) {
                    setError(videoErrorText(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {quiz.options?.length ? (
                  <fieldset>
                    <legend className="sr-only">Yanıt seçenekleri</legend>
                    {quiz.options.map((option, i) => (
                      <label
                        key={i}
                        className={`quiz-option ${answer === String(i) ? 'selected' : ''}`}
                      >
                        <input
                          type="radio"
                          name="quiz-answer"
                          value={i}
                          checked={answer === String(i)}
                          onChange={() => setAnswer(String(i))}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <label>
                    Yanıtın
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      maxLength={2000}
                      rows={5}
                    />
                  </label>
                )}
                <Btn type="submit" disabled={busy || !answer.trim()}>
                  {busy ? 'Yanıt kaydediliyor…' : 'Yanıtı değerlendir'}
                </Btn>
              </form>
              {result && (
                <section
                  className="quiz-feedback"
                  aria-label="Alıştırma geri bildirimi"
                >
                  <span className="source-badge">
                    {result.score === 1
                      ? 'Cevap anahtarıyla eşleşti'
                      : result.score === 0
                        ? 'Kaynağı tekrar incele'
                        : 'Yanıtın kaydedildi'}
                  </span>
                  <p>{result.message}</p>
                  {result.expected && (
                    <p>
                      <strong>Kaynakla eşleştirilen yanıt:</strong>{' '}
                      {result.expected}
                    </p>
                  )}
                  <blockquote>{result.quote}</blockquote>
                  <div className="product-actions">
                    <Btn
                      onClick={() =>
                        navigate(`/dersler/${course}/ogrenme`, {
                          openSource: result.source,
                        })
                      }
                    >
                      İlgili kaynağı aç →
                    </Btn>
                    <button
                      className="product-link"
                      onClick={() => {
                        setResult(null)
                        setAnswer('')
                      }}
                    >
                      Tekrar dene
                    </button>
                    <button
                      className="product-link"
                      onClick={() => navigate('/analitik')}
                    >
                      Çalışmalarımı incele
                    </button>
                  </div>
                </section>
              )}
            </article>
          )}
        </section>
      </div>
    </PageFrame>
  )
}
