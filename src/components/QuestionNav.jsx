import { Btn } from "./ui";

/**
 * The way between the questions of an exam or a quiz set: back, forward, and on the last question
 * `last` instead of "forward" (the exam's "Özeti gör", a set's "Sonraki soru hazırlanıyor…", or nothing).
 * `children` follow (e.g. "Sınav kâğıdına dön").
 */
export default function QuestionNav({
  at,
  total,
  onGo,
  prevLabel = "← Önceki",
  nextLabel = "Sonraki →",
  last = null,
  label = "Sorular arasında gezin",
  children = null,
}) {
  return (
    <nav className="product-actions question-nav" aria-label={label}>
      <Btn variant="soft" disabled={at <= 0} onClick={() => onGo(at - 1)}>{prevLabel}</Btn>
      {at + 1 < total ? <Btn variant="soft" onClick={() => onGo(at + 1)}>{nextLabel}</Btn> : last}
      {children}
    </nav>
  );
}
