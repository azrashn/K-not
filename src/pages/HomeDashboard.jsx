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
