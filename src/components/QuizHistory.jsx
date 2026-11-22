import { useState } from "react";
import {
  HISTORY_FILTERS,
  cardDate,
  doneText,
  filterCounts,
  groupHistory,
  historySummary,
  progressText,
  questionStatus,
  visibleCards,
} from "../lib/quiz-history";

/**
 * "Önceki alıştırmalar": one card per quiz set (or generated exam under "Sınavdan"); a single question is a
 * compact row. A card shows its topic, size, kind, date and recorded progress; opened, it lists its questions
 * with their latest outcome. `onOpen(card, question)` opens a question; "Başla" (nothing answered yet) and
 * "Devam et" (partly answered) open the first unanswered one.
 */
export default function QuizHistory({ course, history = [], examHistory = [], loaded = true, busy = false, onOpen }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState(() => new Set());

  if (!course) return <p className="product-note">Geçmişi görmek için bir ders seç.</p>;
  if (!loaded) return <p className="product-note" role="status">Geçmiş yükleniyor…</p>;
  if (!history.length && !examHistory.length)
    return (
      <p className="product-note">
        Bu derste henüz alıştırma yok. Yeni alıştırma formundan bir konu yazıp ilk alıştırmanı hazırla; yanıtladığın
        sorular burada toplanır.
      </p>
    );

  const exam = filter === "exam";
  const counts = filterCounts(history, examHistory);
  const cards = exam ? groupHistory(examHistory, { exam: true }) : visibleCards(groupHistory(history), filter);
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="quiz-history">
      <div role="group" aria-label="Alıştırma filtresi" className="quiz-history-filters">
        {HISTORY_FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label} <span className="quiz-history-count">{counts[f.id]}</span>
          </button>
        ))}
      </div>
      <p className="product-note quiz-history-summary" aria-live="polite">
        {historySummary(filter, cards)}
      </p>
      {cards.length === 0 && (
        <p className="product-note">
          {exam
            ? "Bu derste hazırlanmış sınav sorusu yok."
            : filter === "unanswered"
              ? "Yanıt bekleyen soru yok."
              : filter === "answered"
                ? "Henüz yanıtlanmış soru yok."
                : "Bu filtrede alıştırma yok."}
        </p>
      )}
      <ul className="quiz-history-list">
        {cards.map((card) => {
          const isOpen = open.has(card.key);
          const listId = `quiz-history-${card.key.replace(/[^\w-]/g, "-")}`;
          const ratio = card.total ? card.answered / card.total : 0;
          if (card.single) {
            // One question: a compact row titled by the question itself, its status on the right.
            const q = card.questions[0];
            const status = questionStatus(q);
            return (
              <li key={card.key} className="quiz-history-row">
                <button type="button" disabled={busy} onClick={() => onOpen?.(card, q)} title={q.question || card.title}>
                  <span className="quiz-history-row-text">
                    <span className="quiz-history-row-title">{card.title}</span>
                    <span className="quiz-history-meta">
                      {card.kind}
                      {card.createdAt && (
                        <>
                          {" · "}
                          <time dateTime={String(card.createdAt)}>{cardDate(card.createdAt)}</time>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="quiz-history-status" data-tone={status.tone}>
                    {status.label}
                  </span>
                </button>
              </li>
            );
          }
          return (
            <li key={card.key} className="quiz-history-card" data-done={card.done || undefined}>
              <button
                type="button"
                className="quiz-history-head"
                aria-expanded={isOpen}
                aria-controls={listId}
                onClick={() => toggle(card.key)}
              >
                <span className="quiz-history-title">{card.title}</span>
                <span className="quiz-history-meta">
                  {card.total} soru · {card.kind}
                  {card.createdAt && (
                    <>
                      {" · "}
                      <time dateTime={String(card.createdAt)}>{cardDate(card.createdAt)}</time>
                    </>
                  )}
                </span>
              </button>
              <div className="quiz-history-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${ratio})` }} />
              </div>
              <div className="quiz-history-foot">
                {card.done ? (
                  <span
                    className="quiz-history-done"
                    title={card.graded ? `Puanlanan ${card.graded} sorudan ${card.correct} doğru` : "Açık uçlu ve kısa yanıtlar puanlanmaz"}
                  >
                    {doneText(card)}
                  </span>
                ) : (
                  <span className="quiz-history-state">{progressText(card)}</span>
                )}
                {!card.done && card.next && (
                  <button
                    type="button"
                    className="product-link quiz-history-resume"
                    disabled={busy}
                    onClick={() => onOpen?.(card, card.next)}
                    aria-label={`${card.answered ? "Devam et" : "Başla"}: ${card.title}`}
                  >
                    {card.answered ? "Devam et" : "Başla"} →
                  </button>
                )}
              </div>
              <ol id={listId} className="quiz-history-questions" hidden={!isOpen}>
                  {card.questions.map((q) => {
                    const status = questionStatus(q);
                    return (
                      <li key={q.id}>
                        <button type="button" disabled={busy} onClick={() => onOpen?.(card, q)}>
                          <span className="quiz-history-question" title={q.question || q.topic}>
                            {q.question || q.topic || "Soru"}
                          </span>
                          <span className="quiz-history-status" data-tone={status.tone}>
                            {status.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ol>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
