import { useEffect, useRef, useState } from "react";
import { api } from "../api/endpoints";
import { useResource } from "../hooks/useApi";
import { useApp } from "../app/store";
import { PageFrame, Btn } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { PageTitle, EmptyState } from "../components/ProductUI";
import { videoErrorText } from "../lib/video";
import { describeExamStyle, examStyleProblem } from "../lib/exam-style";
import { HISTORY_FILTERS, filterHistory, historyLabel, summarizeHistory } from "../lib/quiz-history";
const labels = {
  MULTIPLE_CHOICE: "Çoktan seçmeli",
  TRUE_FALSE: "Doğru / yanlış",
  CLOZE: "Boşluk doldurma",
  SHORT_ANSWER: "Kısa yanıt",
  OPEN: "Açık uçlu yansıtma",
};
export default function CourseQuiz({ courseId }) {
  const { navigate, takeIntent } = useApp(),
    courses = useResource((signal) => api.courses(signal), []);
  const [course, setCourse] = useState(courseId || ""),
    [topic, setTopic] = useState(""),
    [kind, setKind] = useState("MULTIPLE_CHOICE"),
    [material, setMaterial] = useState("");
  const [materials, setMaterials] = useState([]),
    [history, setHistory] = useState([]),
    [historyFilter, setHistoryFilter] = useState("all"),
    [quiz, setQuiz] = useState(null),
    [answer, setAnswer] = useState(""),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [scopeMode, setScopeMode] = useState("course"),
    [selectedMaterials, setSelectedMaterials] = useState([]),
    [watchedOnly, setWatchedOnly] = useState(false);
  const [examStyles, setExamStyles] = useState([]),
    [examStyleId, setExamStyleId] = useState(""),
    [examName, setExamName] = useState(""),
    [examText, setExamText] = useState(""),
    [examError, setExamError] = useState("");
  const summary = summarizeHistory(history);
  const visibleHistory = filterHistory(history, historyFilter);
  const consumed = useRef(false), requestEpoch = useRef(0);
  useEffect(() => () => { requestEpoch.current += 1; }, []);
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const intent = takeIntent?.();
    if (intent?.topic) setTopic(intent.topic.slice(0, 200));
    if (intent?.quizId && courseId)
      api
        .quiz(courseId, intent.quizId)
        .then(setQuiz)
        .catch((e) => setError(videoErrorText(e)));
  }, [takeIntent, courseId]);
  useEffect(() => {
    if (!course) return;
    const abort = new AbortController();
    Promise.all([
      api.knowledgeMaterials(course, abort.signal),
      api.quizzes(course, abort.signal),
    ])
      .then(([m, h]) => {
        if (abort.signal.aborted) return;
        setMaterials(m.materials);
        setHistory(h);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(videoErrorText(e));
      });
    return () => abort.abort();
  }, [course]);
  useEffect(() => {
    if (!course) return;
    const abort = new AbortController();
    api
      .examStyles(course, abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setExamStyles(list);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [course]);
  async function saveExamStyle(e) {
    e.preventDefault();
    const problem = examStyleProblem({ name: examName, text: examText });
    setExamError(problem);
    if (problem) return;
    try {
      const saved = await api.createExamStyle(course, { name: examName.trim(), text: examText });
      setExamStyles((list) => [saved, ...list]);
      setExamStyleId(saved.id);
      setExamName("");
      setExamText("");
    } catch (err) {
      setExamError(videoErrorText(err));
    }
  }
  async function removeExamStyle(id) {
    try {
      await api.deleteExamStyle(course, id);
      setExamStyles((list) => list.filter((x) => x.id !== id));
      if (examStyleId === id) setExamStyleId("");
    } catch (err) {
      setExamError(videoErrorText(err));
    }
  }
  async function start(e) {
    e.preventDefault();
    const epoch = ++requestEpoch.current;
    setBusy(true);
    setQuiz(null);
    setError("");
    setResult(null);
    setAnswer("");
    try {
      const q = await api.createQuiz(course, {
        topic: topic.trim(),
        kind,
        scope:
          scopeMode === "selected"
            ? { mode: "selected", material_ids: selectedMaterials }
            : scopeMode === "active"
              ? { mode: "selected", material_ids: [material] }
              : { mode: "course" },
        watched_only: watchedOnly,
        ...(examStyleId ? { exam_style_id: examStyleId } : {}),
      });
      if (epoch !== requestEpoch.current) return;
      setQuiz(q);
      const history = await api.quizzes(course);
      if (epoch === requestEpoch.current) setHistory(history);
    } catch (err) {
      if (epoch === requestEpoch.current) setError(videoErrorText(err));
    } finally {
      if (epoch === requestEpoch.current) setBusy(false);
    }
  }
  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Kaynakla çalış, geri bildirim al"
        title="Alıştırmalar"
        actions={
          <>
            {course && (
              <button
                className="product-link"
                onClick={() => navigate(`/dersler/${course}/sinavlar`)}
              >
                Sınav hazırla →
              </button>
            )}
            <button
              className="product-link"
              onClick={() => navigate("/analitik")}
            >
              Sonuçlarım →
            </button>
          </>
        }
      >
        Sorular ders kaynaklarına bağlanır. Geri bildirimden ilgili sayfa, slayt
        veya video bölümüne dönebilirsin.
      </PageTitle>
      {courses.error && <div className="product-error" role="alert">Dersler yüklenemedi. <button className="product-link" onClick={courses.reload}>Dersleri yeniden yükle</button></div>}
      <div className="quiz-layout">
        <aside>
          <form
            className="product-panel product-form"
            onSubmit={start}
            onChange={() => setError("")}
          >
            <h2>Çalışma kapsamı</h2>
            <label>
              Ders
              <select
                aria-label="Ders"
                value={course}
                onChange={(e) => {
                  requestEpoch.current += 1;
                  setCourse(e.target.value);
                  setBusy(false);
                  setAnswer("");
                  setMaterials([]);
                  setHistory([]);
                  setSelectedMaterials([]);
                  setQuiz(null);
                  setResult(null);
                  setMaterial("");
                }}
              >
                <option value="">Ders seç</option>
                {courses.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Konu
              <input
                aria-label="Konu"
                disabled={busy}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={200}
                placeholder="Kaynaklarında geçen bir konu yaz"
              />
            </label>
            <label>
              Kaynak kapsamı
              <select
                aria-label="Kaynak kapsamı"
                disabled={busy}
                value={scopeMode}
                onChange={(e) => setScopeMode(e.target.value)}
              >
                <option value="course">Tüm ders kaynakları</option>
                <option value="active">Bir materyal</option>
                <option value="selected">Birden fazla materyal seç</option>
              </select>
            </label>
            {scopeMode === "active" && (
              <label>
                Materyal
                <select
                  aria-label="Quiz materyali"
                  disabled={busy}
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                >
                  <option value="">Materyal seç</option>
                  {materials
                    .filter((m) => m.status === "READY")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.kind} · {m.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {scopeMode === "selected" && (
              <fieldset>
                <legend className="text-xs">Seçili kaynaklar</legend>
                {materials
                  .filter((m) => m.status === "READY")
                  .map((m) => (
                    <label className="reference-check" key={m.id}>
                      <input
                        type="checkbox"
                        disabled={busy}
                        aria-label={`${m.title} quiz kapsamına ekle`}
                        checked={selectedMaterials.includes(m.id)}
                        onChange={(e) =>
                          setSelectedMaterials((ids) =>
                            e.target.checked
                              ? [...ids, m.id]
                              : ids.filter((id) => id !== m.id),
                          )
                        }
                      />
                      {m.kind} · {m.title}
                    </label>
                  ))}
              </fieldset>
            )}
            <label className="reference-check">
              <input
                type="checkbox"
                disabled={busy}
                checked={watchedOnly}
                onChange={(e) => setWatchedOnly(e.target.checked)}
              />
              Yalnız izlediğim video bölümleri
            </label>
            {watchedOnly && (
              <p className="product-note">
                Yalnız tamamı izlenmiş gerçek video aralıkları kullanılır. İleri
                sarılan veya izleme kaydı olmayan bölüm dahil edilmez.
              </p>
            )}
            <label>
              Soru türü
              <select
                aria-label="Soru türü"
                disabled={busy}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sınav stili (isteğe bağlı)
              <select
                aria-label="Sınav stili"
                disabled={busy}
                value={examStyleId}
                onChange={(e) => setExamStyleId(e.target.value)}
              >
                <option value="">Genel soru üslubu</option>
                {examStyles.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="product-note">
              Sorular seçtiğin ders kaynaklarından hazırlanır. Yanıtından sonra
              açıklamayı ve ilgili kaynağı görebilirsin. Açık uçlu yanıtlar
              otomatik puanlanmaz.
            </p>
            <Btn
              type="submit"
              disabled={
                busy ||
                !course ||
                !topic.trim() ||
                (scopeMode === "active" && !material) ||
                (scopeMode === "selected" && !selectedMaterials.length)
              }
            >
              {busy ? "Kaynaklı soru hazırlanıyor…" : "Alıştırma hazırla"}
            </Btn>
          </form>
          <div className="section-heading mt-6">
            <h2>Sınav stilleri</h2>
          </div>
          <p className="product-note">
            Geçmiş sınavını yapıştır: yalnız soru biçimi, üslup ve sık terimler saklanır, sınav metni
            saklanmaz. Sorular numaralı olmalı (1. … 2. …).
          </p>
          {examStyles.map((x) => (
            <div key={x.id} className="resume-row">
              <strong>{x.name}</strong>
              <small>{describeExamStyle(x.profile)}</small>
              <button type="button" className="product-link" onClick={() => removeExamStyle(x.id)}>
                Sil
              </button>
            </div>
          ))}
          <form onSubmit={saveExamStyle} className="grid gap-2 mb-4">
            <label>
              Sınav adı
              <input aria-label="Sınav adı" value={examName} maxLength={120} onChange={(e) => setExamName(e.target.value)} />
            </label>
            <label>
              Sınav metni
              <textarea aria-label="Sınav metni" rows={6} value={examText} onChange={(e) => setExamText(e.target.value)} />
            </label>
            <Btn type="submit" disabled={busy}>Stili kaydet</Btn>
          </form>
          {examError && (
            <p role="alert" className="product-error">
              {examError}
            </p>
          )}
          <div className="section-heading mt-6">
            <h2>Önceki alıştırmalar</h2>
          </div>
          {history.length > 0 && (
            <p className="product-note" aria-live="polite">
              {summary.total} soru · {summary.answered} yanıtlandı · {summary.unanswered} yanıt bekliyor
            </p>
          )}
          {history.length > 0 && (
            <div role="group" aria-label="Alıştırma filtresi" className="flex gap-2 flex-wrap mb-3">
              {HISTORY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={historyFilter === f.id}
                  className="source-badge"
                  onClick={() => setHistoryFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {history.length > 0 && visibleHistory.length === 0 && (
            <p className="product-note">Bu filtrede alıştırma yok.</p>
          )}
          {visibleHistory.map((q) => (
            <button
              key={q.id}
              className="resume-row"
              disabled={busy}
              onClick={async () => {
                const epoch = ++requestEpoch.current;
                try {
                  const saved = await api.quiz(course, q.id);
                  if (epoch !== requestEpoch.current) return;
                  setQuiz(saved);
                  setResult(null);
                  setAnswer("");
                } catch (e) {
                  if (epoch === requestEpoch.current) setError(videoErrorText(e));
                }
              }}
            >
              <strong>{q.topic}</strong>
              <small>
                {labels[q.kind]} · {historyLabel(q)}
              </small>
            </button>
          ))}
        </aside>
        <section>
          {error && (
            <p role="alert" className="product-error">
              {error}
            </p>
          )}
          {busy && !quiz ? <p role="status">Seçtiğin kaynaklardan soru hazırlanıyor ve denetleniyor…</p> : !quiz ? (
            <EmptyState title="Öğrendiklerini dene">
              Bir ders, konu ve soru türü seç. Gerçek kaynak bulunduğunda
              alıştırman burada açılır.
            </EmptyState>
          ) : (
            <article className="quiz-question product-panel">
              <span className="source-badge">{labels[quiz.kind]}</span>
              {quiz.question_style === "SOURCE_COMPLETION" && <p className="product-note">Kaynakta geçen kavramı hatırlama sorusu</p>}
              {quiz.objective && (
                <p className="product-note">Öğrenme hedefi: {quiz.objective}</p>
              )}
              {quiz.quality_state === "LEGACY_NOT_REVIEWED" && (
                <p className="product-note">
                  Bu eski alıştırma yeni kalite kontrolünden geçmemiştir.
                </p>
              )}
              <h2>{quiz.question}</h2>
              {quiz.note && <p className="product-note mb-5">{quiz.note}</p>}
              <form
                className="product-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const epoch = ++requestEpoch.current;
                  setBusy(true);
                  try {
                    const result = await api.answerQuiz(course, quiz.id, answer);
                    if (epoch !== requestEpoch.current) return;
                    setResult(result);
                    const history = await api.quizzes(course);
                    if (epoch === requestEpoch.current) setHistory(history);
                  } catch (err) {
                    if (epoch === requestEpoch.current) setError(videoErrorText(err));
                  } finally {
                    if (epoch === requestEpoch.current) setBusy(false);
                  }
                }}
              >
                {quiz.options?.length ? (
                  <fieldset>
                    <legend className="sr-only">Yanıt seçenekleri</legend>
                    {quiz.options.map((option, i) => (
                      <label
                        key={i}
                        className={`quiz-option ${answer === String(i) ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="quiz-answer"
                          value={i}
                          checked={answer === String(i)}
                          onChange={() => setAnswer(String(i))}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <label>
                    Yanıtın
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      maxLength={2000}
                      rows={5}
                    />
                  </label>
                )}
                <Btn type="submit" disabled={busy || !answer.trim()}>
                  {busy ? "Yanıt kaydediliyor…" : "Yanıtı değerlendir"}
                </Btn>
              </form>
              {result && (
                <section
                  className="quiz-feedback"
                  aria-label="Alıştırma geri bildirimi"
                >
                  <span className="source-badge">
                    {result.score === 1
                      ? "Cevap anahtarıyla eşleşti"
                      : result.score === 0
                        ? "Kaynağı tekrar incele"
                        : "Yanıtın kaydedildi"}
                  </span>
                  <p>{result.message}</p>
                  {result.objective && <p>Öğrenme hedefi: {result.objective}</p>}
                  {result.explanation && result.explanation !== result.quote && <p>{result.explanation}</p>}
                  {result.selected_option_feedback && (
                    <p>Seçtiğin yanıt: {result.selected_option_feedback}</p>
                  )}
                  {result.expected && (
                    <p>
                      <strong>Kaynakla eşleştirilen yanıt:</strong>{" "}
                      {result.expected}
                    </p>
                  )}
                  <blockquote>{result.quote}</blockquote>
                  <div className="product-actions">
                    <Btn
                      onClick={() =>
                        navigate(`/dersler/${course}/ogrenme`, {
                          openSource: result.source,
                        })
                      }
                    >
                      İlgili kaynağı aç →
                    </Btn>
                    <button
                      className="product-link"
                      onClick={() => {
                        setResult(null);
                        setAnswer("");
                      }}
                    >
                      Tekrar dene
                    </button>
                    <button
                      className="product-link"
                      onClick={() => navigate("/analitik")}
                    >
                      Çalışmalarımı incele
                    </button>
                  </div>
                </section>
              )}
            </article>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
