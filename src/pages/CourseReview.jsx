import { api } from '../api/endpoints'
import { useApp } from '../app/store'
import { useResource } from '../hooks/useApi'
import { PageFrame } from '../components/ui'
import { MobileBar } from '../components/PageBits'
import WrongNotebook from '../components/WrongNotebook'

/** Tekrar defteri: bir dersin yanlış yapılan soruları, kaynağıyla birlikte. Yalnızca kayıtlı denemelerden türetilir. */
export default function CourseReview({ courseId }) {
  const { navigate } = useApp()
  const course = useResource((signal) => api.course(courseId, signal), [courseId])
  return (
    <PageFrame>
      <MobileBar />
      <div className="pt-4 lg:pt-12">
        <button type="button" onClick={() => navigate('/dersler')} className="press -ml-2 rounded-md px-2 py-1 text-[13.5px] text-ink-3 hover:bg-ink/[0.05] hover:text-ink">← Dersler</button>
        <h1 className="m-0 mt-3 text-[36px] font-semibold tracking-tight text-ink">Tekrar defteri</h1>
        {course.data && <p className="m-0 mt-2 text-[14px] text-ink-3">{course.data.name}</p>}
        <p className="product-note mt-4 max-w-[36rem]">
          Alıştırma ve sınavlarda yanlış yaptığın sorular, kaynağıyla birlikte. Puan ya da hazırlık tahmini verilmez.
        </p>
        <WrongNotebook
          courseId={courseId}
          onOpenSource={(source) => navigate(`/dersler/${courseId}/ogrenme`, { openSource: source })}
          onRetry={(quizId) => navigate(`/dersler/${courseId}/quiz`, { quizId })}
        />
      </div>
    </PageFrame>
  )
}
