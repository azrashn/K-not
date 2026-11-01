import { api } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { useApp } from '../app/store'
import { PageFrame, Btn } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import { PageTitle, Metric, EmptyState } from '../components/ProductUI'
import { LoadState } from './Courses'
const watched = (intervals) =>
  (Array.isArray(intervals) ? intervals : []).reduce(
    (n, i) => n + Math.max(0, i.end_ms - i.start_ms),
    0,
  )
export default function LearningAnalytics() {
  const { navigate } = useApp(),
    resource = useResource((signal) => api.learningOverview(signal), []),
    data = resource.data
  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Gözlenen çalışmalar"
        title="Öğrenme Analizi"
        actions={<Btn onClick={() => navigate('/quiz')}>Yeni alıştırma</Btn>}
      >
        Kayıtlı etkinliklerin ve cevapların. Bir materyali açmak ya da videoyu
        izlemek, konuyu öğrendiğini kanıtlamaz.
      </PageTitle>
      <LoadState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
      />
      {data && (
        <>
          <section className="metric-strip">
            <Metric
              label="Çalışma kaydı olan ders"
              value={data.activities.length}
            />
            <Metric label="Yanıtlanan alıştırma" value={data.attempts.length} />
            <Metric
              label="Cevap anahtarıyla eşleşen"
              value={data.correct_count}
              detail={`${data.graded_count} otomatik değerlendirilen yanıt içinde`}
            />
            <Metric
              label="Gözlenen video süresi"
              value={`${Math.round(data.video_progress.reduce((n, v) => n + watched(v.intervals), 0) / 60000)} dk`}
              detail="Aralık birleşimi; öğrenme puanı değil"
            />
          </section>
          <div className="dashboard-grid">
            <section>
              <div className="section-heading">
                <h2>Alıştırma geçmişi</h2>
                <span>Gerçek yanıtlar</span>
              </div>
              {!data.attempts.length ? (
                <EmptyState title="Henüz alıştırma sonucu yok">
                  Kaynaklarınla bir alıştırma çöz. Sonuç ve tekrar bağlantısı
                  burada görünür.
                </EmptyState>
              ) : (
                <div className="activity-list">
                  {data.attempts.map((a) => (
                    <article key={a.id}>
                      <span
                        className={`source-badge ${a.score === 0 ? 'needs-review' : ''}`}
                      >
                        {a.score === 1
                          ? 'Eşleşti'
                          : a.score === 0
                            ? 'Tekrar incele'
                            : 'Değerlendirme bekliyor'}
                      </span>
                      <h3>{a.topic}</h3>
                      <p>{new Date(a.created_at).toLocaleString('tr-TR')}</p>
                      <button
                        className="product-link"
                        onClick={() =>
                          navigate(`/dersler/${a.course_id}/quiz`, {
                            quizId: a.quiz_id,
                          })
                        }
                      >
                        Alıştırmayı aç →
                      </button>
                      {a.source && (
                        <button
                          className="product-link ml-4"
                          onClick={() =>
                            navigate(`/dersler/${a.course_id}/ogrenme`, {
                              openSource: a.source,
                            })
                          }
                        >
                          Kaynağa dön →
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
            <aside>
              <div className="section-heading">
                <h2>Çalışmaya dön</h2>
              </div>
              {data.activities.map((a) => (
                <button
                  key={a.courseId}
                  className="resume-row"
                  onClick={() =>
                    navigate(`/dersler/${a.courseId}/ogrenme`, { resume: a })
                  }
                >
                  <strong>{a.course.name}</strong>
                  <span>{a.topic || 'Materyalleri incele'}</span>
                  <small>
                    {new Date(a.updatedAt).toLocaleString('tr-TR')} →
                  </small>
                </button>
              ))}
              <p className="product-note mt-5">
                Konu hâkimiyetini tahmin etmek için yeterli bağımsız
                değerlendirme verisi bulunmuyor. Açık uçlu yanıtlar otomatik
                doğru/yanlış puanına katılmaz.
              </p>
              <div className="section-heading mt-6">
                <h2>Video etkinliği</h2>
              </div>
              {data.video_progress.map((v) => (
                <button
                  key={v.video_id}
                  className="resume-row"
                  onClick={() =>
                    navigate(`/dersler/${v.course_id}/ogrenme`, {
                      resume: { materialId: 'video_' + v.video_id },
                    })
                  }
                >
                  <strong>{v.title}</strong>
                  <span>
                    {Math.round(watched(v.intervals) / 1000)} saniye izleme
                    gözlemi
                  </span>
                </button>
              ))}
            </aside>
          </div>
        </>
      )}
    </PageFrame>
  )
}
