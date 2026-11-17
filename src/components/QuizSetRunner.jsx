import { useMemo, useState } from "react";
import RichText, { RichInline } from "./RichText";
import { Btn } from "./ui";
import { videoErrorText } from "../lib/video";
import { DIFFICULTY_LABELS, FOCUS_LABELS, KIND_LABELS, answerStats, topicVerdict } from "../lib/quiz-set";

// One question at a time, no clock anywhere: the student can think as long as they like.
// Answers stay in the browser until "Alıştırmayı bitir", so they can be changed freely and reviewed first.
export default function QuizSetRunner({ set, submit, onOpenSource, onNewSet }) {
  const questions = useMemo(() => (set.questions || []).filter((q) => q.available !== false), [set]);
  const missing = (set.questions || []).length - questions.length;
  const [phase, setPhase] = useState(set.result ? "result" : "answer");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(set.result || null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const stats = answerStats(questions, answers);

  async function finish() {
    setSubmitting(true);
    setError("");
    try {
      const body = questions
        .filter((q) => String(answers[q.id] ?? "").trim())
        .map((q) => ({ quiz_id: q.id, response: String(answers[q.id]) }));
      setResult(await submit(body));
      setPhase("result");
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!questions.length)
    return <p role="alert" className="product-error">Bu alıştırmanın soruları artık kullanılamıyor. Yeni bir alıştırma hazırla.</p>;

  if (phase === "result" && result) return <Result result={result} onOpenSource={onOpenSource} onNewSet={onNewSet} />;

  if (phase === "review")
    return (
      <section className="qs product-panel" aria-label="Cevapları gözden geçir">
        <h2>Gözden geçir</h2>
        <p className="product-note" aria-live="polite">
          {stats.answered} / {stats.total} soru yanıtlandı.
          {stats.unanswered > 0 && ` ${stats.unanswered} soru yanıtsız; bitirirsen boş sayılır ve başarı yüzdene dahil edilir.`}
        </p>
        <ul className="qs-review">
          {questions.map((q, i) => {
            const done = Boolean(String(answers[q.id] ?? "").trim());
            return (
              <li key={q.id} className={done ? "" : "qs-empty"}>
                <span className="qs-num">{i + 1}</span>
                <span className="qs-review-q"><RichInline text={q.question} /></span>
                <span className="source-badge">{done ? "Yanıtlandı" : "Boş"}</span>
                <button type="button" className="product-link" onClick={() => { setIndex(i); setPhase("answer"); }}>
                  {done ? "Değiştir" : "Yanıtla"}
                </button>
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="product-error">{error}</p>}
        <div className="product-actions">
          <button type="button" className="product-link" onClick={() => setPhase("answer")}>Sorulara dön</button>
          <Btn type="button" disabled={submitting} onClick={finish}>{submitting ? "Değerlendiriliyor…" : "Alıştırmayı bitir"}</Btn>
        </div>
      </section>
    );

  const q = questions[index];
  const value = String(answers[q.id] ?? "");
  const set1 = (v) => setAnswers((a) => ({ ...a, [q.id]: v }));
  return (
    <section className="qs product-panel" aria-label="Alıştırma">
      <div className="qs-head">
        <strong>Soru {index + 1} / {questions.length}</strong>
        <span className="product-note">{stats.answered} / {stats.total} yanıtlandı</span>
      </div>
      <div className="qs-bar" role="progressbar" aria-label="Yanıtlanan soru oranı" aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={stats.answered}>
        <span style={{ width: `${stats.total ? (stats.answered / stats.total) * 100 : 0}%` }} />
      </div>
      {missing > 0 && <p className="product-note">{missing} soru kaynağı değiştiği için gösterilemiyor.</p>}
      <nav className="qs-grid" aria-label="Soru listesi">
        {questions.map((item, i) => {
          const done = Boolean(String(answers[item.id] ?? "").trim());
          return (
            <button
              key={item.id}
              type="button"
              className={`${done ? "done" : ""} ${i === index ? "current" : ""}`}
              aria-current={i === index ? "step" : undefined}
              aria-label={`Soru ${i + 1}, ${done ? "yanıtlandı" : "yanıtsız"}`}
              onClick={() => setIndex(i)}
            >
              {i + 1}
            </button>
          );
        })}
      </nav>
      <div className="qs-badges">
        <span className="source-badge">{q.topic}</span>
        {q.difficulty && <span className="source-badge">{DIFFICULTY_LABELS[q.difficulty]}</span>}
        {q.focus && <span className="source-badge">{FOCUS_LABELS[q.focus]}</span>}
        <span className="source-badge">{KIND_LABELS[q.kind] || q.kind}</span>
      </div>
      <h2 className="qs-question"><RichInline text={q.question} /></h2>
      {q.options?.length ? (
        <fieldset>
          <legend className="sr-only">Yanıt seçenekleri</legend>
          {q.options.map((option, i) => (
            <label key={i} className={`quiz-option ${value === String(i) ? "selected" : ""}`}>
              <input type="radio" name={`qs-${q.id}`} value={i} checked={value === String(i)} onChange={() => set1(String(i))} />
              <span><RichInline text={option} /></span>
            </label>
          ))}
        </fieldset>
      ) : (
        <label>
          Yanıtın
          <textarea value={value} onChange={(e) => set1(e.target.value)} maxLength={2000} rows={4} />
        </label>
      )}
      <div className="product-actions">
        <button type="button" className="product-link" disabled={index === 0} onClick={() => setIndex(index - 1)}>← Önceki</button>
        {value && <button type="button" className="product-link" onClick={() => set1("")}>Seçimi temizle</button>}
        {index < questions.length - 1 ? (
          <Btn type="button" onClick={() => setIndex(index + 1)}>Sonraki →</Btn>
        ) : (
          <Btn type="button" onClick={() => setPhase("review")}>Gözden geçir</Btn>
        )}
      </div>
      {index < questions.length - 1 && (
        <button type="button" className="product-link" onClick={() => setPhase("review")}>
          Gözden geçir ve bitir{stats.unanswered > 0 ? ` (${stats.unanswered} boş)` : ""}
        </button>
      )}
    </section>
  );
}

function Bars({ title, rows, label = (k) => k }) {
  if (!rows?.length) return null;
  return (
    <div className="qs-bars">
      <h3>{title}</h3>
      {rows.map((r) => (
        <div key={r.key} className="qs-barrow">
          <span>{label(r.key)}</span>
          <div className="qs-bar" role="img" aria-label={`${label(r.key)}: yüzde ${r.percent}`}><span style={{ width: `${r.percent}%` }} /></div>
          <small>{r.correct}/{r.total} · %{r.percent}{r.blank ? ` · ${r.blank} boş` : ""}</small>
        </div>
      ))}
    </div>
  );
}

function Result({ result, onOpenSource, onNewSet }) {
  const s = result.summary;
  const [onlyMissed, setOnlyMissed] = useState(false);
  const verdict = topicVerdict(s.by_topic);
  const items = onlyMissed ? result.items.filter((i) => !i.correct) : result.items;
  return (
    <section className="qs product-panel" aria-label="Alıştırma sonucu">
      <h2>Sonuç: %{s.percent}</h2>
      <dl className="qs-tiles">
        <div><dt>Toplam soru</dt><dd>{s.total}</dd></div>
        <div><dt>Doğru</dt><dd>{s.correct}</dd></div>
        <div><dt>Yanlış</dt><dd>{s.wrong}</dd></div>
        <div><dt>Boş</dt><dd>{s.blank}</dd></div>
      </dl>
      {s.by_topic.length > 0 && (verdict.weak.length > 0 || verdict.strong.length > 0) && (
        <p className="product-note">
          {verdict.strong.length > 0 && <>Güçlü olduğun konular: <strong>{verdict.strong.join(", ")}</strong>. </>}
          {verdict.weak.length > 0 && <>Tekrar etmen gereken konular: <strong>{verdict.weak.join(", ")}</strong>.</>}
        </p>
      )}
      <Bars title="Konuya göre" rows={s.by_topic} />
      <Bars title="Zorluğa göre" rows={s.by_difficulty} label={(k) => DIFFICULTY_LABELS[k] || k} />
      <Bars title="Soru yaklaşımına göre" rows={s.by_focus} label={(k) => FOCUS_LABELS[k] || k} />
      <div className="qs-filter" role="group" aria-label="Soru filtresi">
        <button type="button" className="source-badge" aria-pressed={!onlyMissed} onClick={() => setOnlyMissed(false)}>Tüm sorular</button>
        <button type="button" className="source-badge" aria-pressed={onlyMissed} onClick={() => setOnlyMissed(true)}>Yanlış ve boş ({s.wrong + s.blank})</button>
      </div>
      <ol className="qs-items">
        {items.map((it) => (
          <li key={it.quiz_id} className={it.correct ? "ok" : "miss"}>
            <div className="qs-badges">
              <span className="source-badge">Soru {it.index}</span>
              <span className="source-badge">{it.correct ? "Doğru" : it.answered ? "Yanlış" : "Boş"}</span>
              <span className="source-badge">{it.topic}</span>
              {it.difficulty && <span className="source-badge">{DIFFICULTY_LABELS[it.difficulty]}</span>}
            </div>
            <p className="qs-question"><RichInline text={it.question || ""} /></p>
            {it.options.length > 0 ? (
              <ul className="qs-options">
                {it.options.map((o) => (
                  <li key={o.index} className={`${o.correct ? "right" : ""} ${o.chosen && !o.correct ? "wrong" : ""}`}>
                    <strong>{o.correct ? "Doğru cevap" : o.chosen ? "Senin cevabın" : ""}</strong>
                    <RichInline text={o.text} />
                    {o.feedback && (o.correct || o.chosen || !it.correct) && <small>{o.feedback}</small>}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{it.response ? `Cevabın: ${it.response}` : "Cevap verilmedi."} Doğru cevap: <strong>{it.expected}</strong></p>
            )}
            {!it.answered && <p className="product-note">Bu soruyu boş bıraktın.</p>}
            {it.explanation && <RichText text={it.explanation} />}
            {it.quote && <blockquote>{it.quote}</blockquote>}
            {it.source && (
              <button type="button" className="product-link" onClick={() => onOpenSource(it.source)}>
                {it.source.title}{it.source.location?.page ? ` · sayfa ${it.source.location.page}` : ""} — ilgili kaynağı aç →
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="product-actions">
        <Btn type="button" onClick={onNewSet}>Yeni alıştırma</Btn>
      </div>
    </section>
  );
}
