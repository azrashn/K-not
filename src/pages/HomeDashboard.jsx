import { useState } from 'react'
import { api } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { useApp } from '../app/store'
import { useAuth } from '../app/auth'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import {
  PageTitle,
  Metric,
  EmptyState,
  CourseEditor,
} from '../components/ProductUI'
import { LoadState } from './Courses'

// Sınav pulu: tarih ve ad öğrencinin girdiği değerdir; tahmin yok. Bu tarayıcıda saklanır.
const EXAM_KEY = 'knot-exam'
function readExam() {
  try { return JSON.parse(localStorage.getItem(EXAM_KEY) || 'null') } catch { return null }
}
function ExamStamp() {
  const [exam, setExam] = useState(readExam)
  const [edit, setEdit] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  function save(e) {
    e.preventDefault()
    if (!title.trim() || !date) return
    const next = { title: title.trim().slice(0, 40), date }
    try { localStorage.setItem(EXAM_KEY, JSON.stringify(next)) } catch { /* depolama kapalı */ }
    setExam(next)
    setEdit(false)
  }
  function clear() {
    try { localStorage.removeItem(EXAM_KEY) } catch { /* depolama kapalı */ }
    setExam(null)
    setTitle(''); setDate('')
  }
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const left = exam ? Math.round((start(new Date(exam.date + 'T00:00:00')) - start(new Date())) / 86400000) : null
  if (edit || !exam)
    return (
      <section className="exam-slot" aria-label="Sınav tarihi">
        {!edit ? (
          <button type="button" className="exam-add" onClick={() => { setTitle(''); setDate(''); setEdit(true) }}>+ Sınav tarihi ekle</button>
        ) : (
          <form className="exam-form" onSubmit={save}>
            <input value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} placeholder="Ders · sınav adı" aria-label="Sınav adı" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Sınav tarihi" />
            <Btn type="submit" disabled={!title.trim() || !date}>Kaydet</Btn>
            <button type="button" className="product-link" onClick={() => setEdit(false)}>Vazgeç</button>
          </form>
        )}
      </section>
    )
  const text = left > 1 ? `${left} gün` : left === 1 ? 'Yarın' : left === 0 ? 'Bugün' : 'Geçti'
  return (
    <section className="exam-slot" aria-label="Sınav geri sayımı">
      <div className="exam-stamp" data-past={left < 0}>
        <i className="t" /><i className="b" /><i className="l" /><i className="r" />
        <div className="exam-in">
          <div className="exam-post">{exam.title.toLocaleUpperCase('tr-TR')}</div>
          <div className="exam-big">{text}</div>
          <div className="exam-sm">{new Date(exam.date + 'T00:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })} · senin girdiğin tarih</div>
        </div>
      </div>
      <div className="exam-actions">
        <button type="button" className="product-link" onClick={() => { setTitle(exam.title); setDate(exam.date); setEdit(true) }}>Düzenle</button>
        <button type="button" className="product-link" onClick={clear}>Kaldır</button>
      </div>
    </section>
  )
}

// Bu hafta: kayıtlı etkinliği olan günler (alıştırma, çalışma kaydı, video izleme). Öğrenme ölçüsü değildir.
const DAY = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
function WeekStrip({ data }) {
  const seen = new Set()
  const add = (v) => { if (v) seen.add(dayKey(new Date(v))) }
  data?.attempts?.forEach((a) => add(a.created_at))
  data?.activities?.forEach((a) => add(a.updatedAt))
  data?.video_progress?.forEach((v) => add(v.updated_at))
  const today = new Date()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d })
  const count = days.filter((d) => seen.has(dayKey(d))).length
  return (
    <section className="week-strip" aria-label="Bu hafta">
      <div className="section-heading"><h2>Bu hafta</h2><span>{count} gün kayıtlı etkinlik</span></div>
      <ol>
        {days.map((d, i) => {
          const on = seen.has(dayKey(d))
          return (
            <li key={i} data-on={on} data-today={dayKey(d) === dayKey(today)}>
              <span className="week-day">{DAY[i]}</span>
              <span className="week-stamp" aria-label={on ? 'Kayıtlı etkinlik var' : 'Kayıt yok'}>{on ? '✓' : d.getDate()}</span>
            </li>
          )
        })}
      </ol>
      <p className="product-note">Gün işareti, o gün kaydedilmiş bir etkinlik olduğunu gösterir; öğrenme puanı değildir.</p>
    </section>
  )
}
export default function HomeDashboard() {
  const { navigate } = useApp(),
    { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const courses = useResource((signal) => api.courses(signal), []),
    learning = useResource((signal) => api.learningOverview(signal), [])
  const data = learning.data,
    latest = data?.activities?.[0]
  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Çalışma masan"
        title={`Merhaba${user?.display_name ? ', ' + user.display_name.split(' ')[0] : ''}.`}
        note="bugün neredeydik?"
        tone="coral"
        actions={<Btn onClick={() => setCreating(true)}>+ Ders oluştur</Btn>}
      >
        Bir konudan başlayıp kendi kaynaklarınla ilerle. Kaldığın yer burada.
      </PageTitle>
      <LoadState
        loading={courses.loading || learning.loading}
        error={courses.error || learning.error}
        onRetry={() => {
          courses.reload()
          learning.reload()
        }}
      />
      <section className="metric-strip" aria-label="Gerçek çalışma özeti">
        <Metric
          label="Derslerin"
          value={courses.data?.length ?? '—'}
          detail="Arşiv dışındaki öğrenme alanların"
        />
        <Metric
          label="Kaynakların"
          value={
            courses.data?.reduce(
              (n, c) => n + (c.material_count ?? c.documents.total),
              0,
            ) ?? '—'
          }
          detail="PDF, sunum, metin ve video"
        />
        <Metric
          label="Yanıtlanan alıştırma"
          value={data?.attempts.length ?? '—'}
          detail="Kaydedilmiş cevaplardan"
        />
        <Metric
          label="Değerlendirilen yanıt"
          value={data?.graded_count ?? '—'}
          detail="İzleme, öğrenme puanı değildir"
        />
      </section>
      <ExamStamp />
      <WeekStrip data={data} />
      <div className="dashboard-grid">
        <section className="dashboard-primary">
          <div className="section-heading">
            <h2>Kaldığın yerden</h2>
            <span>Son çalışma</span>
          </div>
          {latest ? (
            <article className="continue-panel">
              <p className="product-eyebrow">{latest.course.name}</p>
              <h3>
                {latest.topic || 'Ders materyallerinle çalışmaya devam et'}
              </h3>
              <p>
                {new Date(latest.updatedAt).toLocaleString('tr-TR')} · Kayıtlı
                çalışma etkinliği
              </p>
              <Btn
                onClick={() =>
                  navigate(`/dersler/${latest.courseId}/ogrenme`, {
                    resume: latest,
                  })
                }
              >
                Çalışmaya devam et →
              </Btn>
            </article>
          ) : (
            <EmptyState title="İlk çalışma adımın">
              Ders oluştur, materyalini ekle ve bir soru sor. Son çalıştığın
              yere buradan dönebileceksin.
            </EmptyState>
          )}
          <div className="section-heading mt-8">
            <h2>Derslerin</h2>
            <button
              onClick={() => navigate('/dersler')}
              className="product-link"
            >
              Tümünü gör →
            </button>
          </div>
          <div className="compact-course-list">
            {courses.data?.slice(0, 5).map((c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/dersler/${c.id}/ogrenme`)}
              >
                <span className="course-glyph" aria-hidden>
                  ▤
                </span>
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    {c.material_count ?? c.documents.total} materyal ·{' '}
                    {c.category || c.term}
                  </small>
                </span>
                <span aria-hidden>↗</span>
              </button>
            ))}
          </div>
        </section>
        <aside className="dashboard-secondary">
          <div className="section-heading">
            <h2>Bir sonraki adım</h2>
          </div>
          {data?.recommendation ? (
            <article className="recommendation">
              <span className="source-badge">Tekrar önerisi</span>
              <h3>{data.recommendation.topic}</h3>
              <p>
                Kaydedilmiş bir alıştırma yanıtın kaynak incelemesi
                gerektiriyor. Bu bir konu hâkimiyeti tahmini değildir.
              </p>
              <button
                className="product-link"
                onClick={() =>
                  navigate(
                    `/dersler/${data.recommendation.course_id}/ogrenme`,
                    { openSource: data.recommendation.source },
                  )
                }
              >
                İlgili kaynağı incele →
              </button>
            </article>
          ) : (
            <p className="product-note">
              Öneri oluşturmak için henüz yeterli değerlendirme verisi yok.
              Çalıştıktan sonra kaynaklı bir alıştırma çözebilirsin.
            </p>
          )}
          <div className="quick-actions">
            <button onClick={() => navigate('/dersler')}>
              Materyallerini yönet <span>↗</span>
            </button>
            <button onClick={() => navigate('/quiz')}>
              Alıştırma başlat <span>↗</span>
            </button>
            <button onClick={() => navigate('/analitik')}>
              Çalışmalarını incele <span>↗</span>
            </button>
          </div>
        </aside>
      </div>
      {creating && (
        <CourseEditor
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false)
            navigate(`/dersler/${c.id}/ogrenme`)
          }}
        />
      )}
    </PageFrame>
  )
}
