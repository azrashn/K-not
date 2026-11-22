import { api } from '../api/endpoints'
import { useResource } from '../hooks/useApi'
import { PURPOSE_LABEL, STATUS_LABEL, openLabel, sourceBadgeText } from '../lib/review'

function Item({ item, onRetry }) {
  return (
    <li className="review-item" data-status={item.status} data-quiz-id={item.quiz_id}>
      <div className="review-item-top">
        <span className="source-badge mono">{STATUS_LABEL[item.status]}</span>
        <span className="source-badge mono">{PURPOSE_LABEL[item.purpose] || item.purpose}</span>
        {item.wrong_count > 1 && <span className="source-badge mono">{item.wrong_count} kez yanlış</span>}
      </div>
      <p className="review-question">{item.question}</p>
      {item.your_answer && (
        <p className="review-answer">
          {item.status === 'LAST_CORRECT' ? 'Önceki yanlış cevabın' : 'Verdiğin cevap'}: {item.your_answer}
        </p>
      )}
      {item.correct_answer && (
        <details className="review-reveal">
          <summary>Doğru cevabı göster</summary>
          <p>{item.correct_answer}</p>
        </details>
      )}
      <button type="button" className="product-link" onClick={() => onRetry(item.quiz_id)}>
        Tekrar çöz
      </button>
    </li>
  )
}

/**
 * Yanlış defteri. Yalnızca kayıtlı cevap denemelerinden türetilir (GET /courses/:id/review);
 * kaynak bağlantısı yalnızca kaynağı kayıtlı sorularda görünür.
 */
export default function WrongNotebook({ courseId, refreshKey = 0, onOpenSource, onRetry }) {
  const { data, error, loading, reload } = useResource((signal) => api.review(courseId, signal), [courseId, refreshKey])
  if (loading && !data) return <p className="product-note" role="status">Yanlış defteri yükleniyor…</p>
  if (error)
    return (
      <p className="product-error" role="alert">
        Yanlış defteri yüklenemedi.{' '}
        <button type="button" className="product-link" onClick={reload}>Yeniden dene</button>
      </p>
    )
  const { groups = [], unlinked = [], counts = { open: 0, last_correct: 0 } } = data || {}
  if (!groups.length && !unlinked.length) return <p className="product-note">Yanlış defterin boş.</p>
  return (
    <div className="review-notebook">
      <p className="review-counts mono" data-testid="review-counts">
        {counts.open} bekleyen · {counts.last_correct} son denemede doğru
      </p>
      {groups.map((g) => {
        const first = g.items[0].source
        return (
          <section key={g.key} className="review-group" aria-label={sourceBadgeText(g.title, g.locator)}>
            <header className="review-group-head">
              <span className="source-badge mono">{sourceBadgeText(g.title, g.locator)}</span>
              <button type="button" className="product-link" onClick={() => onOpenSource(first, sourceBadgeText(g.title, g.locator))}>
                {openLabel(g.locator)}
              </button>
            </header>
            <ul className="review-list">
              {g.items.map((it) => <Item key={it.quiz_id} item={it} onRetry={onRetry} />)}
            </ul>
          </section>
        )
      })}
      {unlinked.length > 0 && (
        <section className="review-group" aria-label="Kaynak bağlantısı olmayan sorular">
          <header className="review-group-head">
            <span className="source-badge mono">Kaynak bağlantısı yok</span>
          </header>
          <ul className="review-list">
            {unlinked.map((it) => <Item key={it.quiz_id} item={it} onRetry={onRetry} />)}
          </ul>
        </section>
      )}
    </div>
  )
}
