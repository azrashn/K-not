import EmptyState, { Panel } from './EmptyState'

// Zaman damgalı quiz sonuçları henüz saklanmıyor (WBS-6/7); grafik veri gelince bağlanır.
export default function PerformanceChart() {
  return (
    <Panel title="Performans gelişimi">
      <EmptyState>Performans geçmişi için en az iki farklı tarihte quiz tamamlamanız gerekiyor.</EmptyState>
    </Panel>
  )
}
