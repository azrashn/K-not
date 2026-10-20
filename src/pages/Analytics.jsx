import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/endpoints'
import { useApp } from '../app/store'
import { useResource } from '../hooks/useApi'
import { PageFrame } from '../components/ui'
import { MobileBar, SampleNotice } from '../components/PageBits'
import SummaryCards from '../components/analytics/SummaryCards'
import PerformanceChart from '../components/analytics/PerformanceChart'
import TopicPerformance from '../components/analytics/TopicPerformance'
import RecommendedTopics from '../components/analytics/RecommendedTopics'
import SourceTrustTab from '../components/analytics/SourceTrustTab'

const TABS = [
  { id: 'learn', label: 'Öğrenme durumu' },
  { id: 'trust', label: 'Yanıt ve kaynak analizi' },
]

export default function Analytics() {
  const { topics: mockTopics, review, stats, unsupported, navigate, takeIntent } = useApp()
  const summaryRes = useResource((signal) => api.quizSummary(signal), [])
  const summary = summaryRes.data
  // Gerçek quiz sonuçları varsa konu verisi onlardan gelir; yoksa örnek veri gösterilir.
  const realTopics = useMemo(() => (summary?.topics ?? []).filter((t) => t.answered > 0).map((t) => ({
    id: t.topic, name: t.topic, score: Math.max(t.accuracy_pct / 100, 0.01), answered: t.answered, correct: t.correct,
  })), [summary])
  const real = realTopics.length > 0
  const topics = real ? realTopics : mockTopics
  const [tab, setTab] = useState('learn')
  const [focusId, setFocusId] = useState(null)
  const consumed = useRef(false)
  useEffect(() => {
    if (consumed.current) return
    consumed.current = true
    const i = takeIntent()
    if (i?.topic) setFocusId(i.topic)
    if (i?.tab) setTab(i.tab)
  }, [takeIntent])

  return (
    <PageFrame>
      <MobileBar />
      <SampleNotice>{real && tab === 'learn' ? 'Kaynak güveni sayıları örnek veridir (WBS-8).' : 'Konu puanları ve kaynak sayıları örnek veridir; henüz tamamlanmış quiz yok.'}</SampleNotice>
      <header className="pb-6 pt-4 lg:pt-10">
        <h1 className="display m-0 text-[36px] text-ink sm:text-[44px]">Öğrenme Analizi</h1>
        <p className="m-0 mt-2 max-w-[36rem] text-[16px] leading-snug text-ink-2">Çalışmalarını, konu bazlı performansını ve gelişimini tek yerden takip et.</p>
        <div role="tablist" aria-label="Öğrenme analizi bölümleri" className="mt-6 inline-flex gap-1 rounded-lg border border-line bg-sheet p-1">
          {TABS.map((t) => (
            <button
              key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
              className={`press h-9 rounded-md px-4 text-[14px] font-medium ${tab === t.id ? 'bg-accent text-white' : 'text-ink-3 hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div role="tabpanel" className="grid gap-4 pb-12">
        {tab === 'learn' ? (
          <>
            <SummaryCards topics={topics} summary={summary} />
            <PerformanceChart attempts={summary?.attempts ?? []} />
            <TopicPerformance topics={topics} focusId={focusId} />
            <RecommendedTopics topics={topics} review={real ? [] : review} navigate={navigate} real={real} />
          </>
        ) : (
          <SourceTrustTab stats={stats} unsupported={unsupported} navigate={navigate} />
        )}
      </div>
    </PageFrame>
  )
}
