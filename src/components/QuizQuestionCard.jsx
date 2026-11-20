import { useEffect, useRef, useState } from "react";
import RichText, { RichInline } from "./RichText";
import { api } from "../api/endpoints";
import { useApp } from "../app/store";
import { Btn } from "./ui";
import { KIND_LABELS } from "../lib/quiz-history";

/**
 * One question to solve: the stem, the options or a text box, and after the answer the feedback with the
 * explanation and the source passage. Used by the practice page and by the exam page ("Sınavı çöz").
 *
 * The answer is saved on the question itself (POST /quizzes/:id/answers), so a generated exam's question is
 * recorded with its own purpose (EXAM) and appears under "Sınavdan" in the history.
 *
 * `result` is kept by the parent (the exam summary needs every result); the typed answer is local. Give the
 * component `key={quiz.id}` so a new question starts with an empty answer.
 */
export default function QuizQuestionCard({
  courseId,
  quiz,
  result,
  onResult,
  onRetry,
  onError,
  badge = null,
  actions = null,
  disabled = false,
}) {
  const { navigate } = useApp();
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api.answerQuiz(courseId, quiz.id, answer);
      if (alive.current) onResult?.(saved);
    } catch (err) {
      if (alive.current) onError?.(err);
    } finally {
      if (alive.current) setSaving(false);
    }
  }

  return (
    <article className="quiz-question product-panel">
      {badge}
      {badge && " "}
      <span className="source-badge">{KIND_LABELS[quiz.kind]}</span>
      {quiz.question_style === "SOURCE_COMPLETION" && <p className="product-note">Kaynakta geçen kavramı hatırlama sorusu</p>}
      {quiz.objective && <p className="product-note">Öğrenme hedefi: {quiz.objective}</p>}
      {quiz.quality_state === "LEGACY_NOT_REVIEWED" && (
        <p className="product-note">Bu eski alıştırma yeni kalite kontrolünden geçmemiştir.</p>
      )}
      <h2><RichInline text={quiz.question} /></h2>
      {quiz.note && <p className="product-note mb-5">{quiz.note}</p>}
      <form className="product-form" onSubmit={submit}>
        {quiz.options?.length ? (
          <fieldset>
            <legend className="sr-only">Yanıt seçenekleri</legend>
            {quiz.options.map((option, i) => (
              <label key={i} className={`quiz-option ${answer === String(i) ? "selected" : ""}`}>
                <input
                  type="radio"
                  name={`quiz-answer-${quiz.id}`}
                  value={i}
                  checked={answer === String(i)}
                  onChange={() => setAnswer(String(i))}
                />
                <span><RichInline text={option} /></span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label>
            Yanıtın
            <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={2000} rows={5} />
          </label>
        )}
        <Btn type="submit" disabled={disabled || saving || !answer.trim()}>
          {saving ? "Yanıt kaydediliyor…" : "Yanıtı değerlendir"}
        </Btn>
      </form>
      {result && (
        <section className="quiz-feedback" aria-label="Alıştırma geri bildirimi">
          <span className="source-badge">
            {result.score === 1
              ? "Cevap anahtarıyla eşleşti"
              : result.score === 0
                ? "Kaynağı tekrar incele"
                : "Yanıtın kaydedildi"}
          </span>
          <p>{result.message}</p>
          {result.objective && <p>Öğrenme hedefi: {result.objective}</p>}
          {result.explanation && result.explanation !== result.quote && <RichText text={result.explanation} />}
          {result.selected_option_feedback && <p>Seçtiğin yanıt: {result.selected_option_feedback}</p>}
          {result.expected && (
            <p>
              <strong>Kaynakla eşleştirilen yanıt:</strong> {result.expected}
            </p>
          )}
          {result.quote && <blockquote>{result.quote}</blockquote>}
          <div className="product-actions">
            {actions}
            {result.source && (
              <Btn
                onClick={() =>
                  // The quote travels with the source so the viewer can mark the sentence the question rests on.
                  navigate(`/dersler/${courseId}/ogrenme`, {
                    openSource: { ...result.source, ...(result.quote ? { quote: result.quote } : {}) },
                  })
                }
              >
                İlgili kaynağı aç →
              </Btn>
            )}
            <button
              className="product-link"
              onClick={() => {
                setAnswer("");
                onRetry?.();
              }}
            >
              Tekrar dene
            </button>
            <button className="product-link" onClick={() => navigate("/analitik")}>
              Çalışmalarımı incele
            </button>
          </div>
        </section>
      )}
    </article>
  );
}
