import { LEARN_LABEL, topicState } from '../../data/academic'
import { Btn } from '../ui'
import EmptyState, { Panel } from './EmptyState'

export default function RecommendedTopics({ topics, review, navigate, real = false }) {
  const studied = topics.filter((t) => t.score > 0)
  const needs = studied.filter((t) => topicState(t.score) !== 'tight').sort((a, b) => a.score - b.score)
  const queued = review.map((r) => topics.find((t) => t.id === r.topicId)).filter(Boolean)
  const list = [...new Map([...queued, ...needs].map((t) => [t.id, t])).values()].slice(0, 5)
  return (
    <Panel title="Tekrar etmeni önerdiğimiz konular">
      {studied.length === 0 ? (
        <EmptyState>Henüz kişiselleştirilmiş öneri oluşturmak için yeterli değerlendirme verisi bulunmuyor.</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState>Tüm konularda iyi gidiyorsun!</EmptyState>
      ) : (
        <ul className="m-0 list-none p-0">
          {list.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-hair py-3 first:border-t-0 first:pt-0">
              <div className="min-w-0">
                <p className="m-0 text-[15px] font-medium text-ink">{t.name}</p>
                <p className="m-0 text-[13px] text-ink-3">
                  <span className="font-mono text-[11.5px] uppercase tracking-wide text-ink-2">{LEARN_LABEL[topicState(t.score)]}</span>
                  {t.answered > 0 && <> · {t.answered} sorunun {t.correct}’ini doğru yanıtladın</>}
                </p>
              </div>
              <div className="flex gap-2">
                <Btn size="sm" variant="soft" onClick={() => navigate('/dersler/veri-yapilari/calisma', { question: `${t.name} nedir, nasıl çalışır?` })}>Konuyu tekrar et</Btn>
                <Btn size="sm" onClick={() => navigate('/quiz', real ? undefined : { topic: t.id })}>Quiz çöz</Btn>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
