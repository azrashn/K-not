import { useEffect, useMemo, useRef, useState } from "react";
import RichText, { RichInline } from "../components/RichText";
import { api } from "../api/endpoints";
import { useResource } from "../hooks/useApi";
import { useApp } from "../app/store";
import { PageFrame, Btn } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { PageTitle, EmptyState } from "../components/ProductUI";
import { videoErrorText } from "../lib/video";
import { HISTORY_FILTERS, filterHistory, historyLabel, summarizeHistory } from "../lib/quiz-history";
const labels = {
  MULTIPLE_CHOICE: "Çoktan seçmeli",
  TRUE_FALSE: "Doğru / yanlış",
  CLOZE: "Boşluk doldurma",
  SHORT_ANSWER: "Kısa yanıt",
  OPEN: "Açık uçlu yansıtma",
};
// Sohbetteki sorunun tamamı konu alanına yazılmasın: ilk cümle, en fazla 80 karakter, kelime sınırında.
function shortTopic(text) {
  const first = String(text).trim().split(/(?<=[.?!])\s/)[0].replace(/[?!.]+$/, "");
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80) + "…";
}

/** The form also offers "Karışık": the kinds in turn (one question is a multiple-choice one). */
const kindChoices = { ...labels, MIXED: "Karışık (türler sırayla)" };
/** 1 question comes back at once; 2-15 are a set written in the background (GET /quiz-sets/:id). */
const QUIZ_COUNTS = Array.from({ length: 15 }, (_, i) => i + 1);
const SET_POLL_MS = 2000;
export default function CourseQuiz({ courseId }) {
  const { navigate, takeIntent } = useApp(),
    courses = useResource((signal) => api.courses(signal), []);
  const [course, setCourse] = useState(courseId || ""),
    [topic, setTopic] = useState(""),
    [kind, setKind] = useState("MULTIPLE_CHOICE"),
    [count, setCount] = useState(1),
    [material, setMaterial] = useState("");
  // A quiz set: its summary with the questions made so far, and which one is open.
  const [quizSet, setQuizSet] = useState(null),
    [setIndex, setSetIndex] = useState(0);
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
    [examStyleId, setExamStyleId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false),
    [scopeNote, setScopeNote] = useState(""),
    [elapsed, setElapsed] = useState(0);
  const abortRef = useRef(null);
  const summary = summarizeHistory(history);
  const visibleHistory = filterHistory(history, historyFilter);
  const consumed = useRef(false), requestEpoch = useRef(0);
  // Topic ideas: what was practised before and what the course materials are called.
  const suggestions = useMemo(() => {
    const names = materials
      .filter((m) => m.status === "READY")
      .map((m) => String(m.title || "").replace(/\.[A-Za-z0-9]+$/, ""));
    return [...new Set([...history.slice(0, 3).map((h) => h.topic), ...names.slice(0, 3)].map((t) => String(t || "").trim()).filter(Boolean))]
      .filter((t) => t !== topic.trim())
      .slice(0, 5);
  }, [history, materials, topic]);
  const advancedSummary = [
    scopeMode === "course" ? "Tüm ders kaynakları" : scopeMode === "active" ? "Bir materyal" : `${selectedMaterials.length} materyal`,
    watchedOnly ? "izlenen bölümler" : null,
    examStyleId ? "sınav stili" : null,
  ].filter(Boolean).join(" · ");
  // Preparation can take minutes on a local model: show how long, and let the student stop waiting.
  useEffect(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  function cancel() {
    requestEpoch.current += 1;
    abortRef.current?.abort();
    setBusy(false);
    setError("Hazırlama iptal edildi. Sunucu soruyu yine de tamamlayabilir; bittiyse “Önceki alıştırmalar” içinde görünür.");
  }
  useEffect(() => () => { requestEpoch.current += 1; }, []);
  const setQuestions = (quizSet?.questions ?? []).filter((q) => q.available);
  const setRunning = quizSet?.status === "GENERATING";
  const sourceWarning = quiz?.source_warning || quizSet?.source_warning || "";
  // A set is written in the background: follow it until it is done, then refresh the history.
  useEffect(() => {
    if (!course || !quizSet?.id || quizSet.status !== "GENERATING") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.quizSet(course, quizSet.id);
        if (stopped) return;
        setQuizSet(next);
        if (next.status !== "GENERATING") api.quizzes(course).then((h) => !stopped && setHistory(h)).catch(() => {});
      } catch (e) {
        if (!stopped) setError(videoErrorText(e));
      }
    }, SET_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [course, quizSet?.id, quizSet?.status]);
  // The first question of a set opens as soon as it exists; the student need not wait for the rest.
  useEffect(() => {
    if (quizSet && !quiz && setQuestions[setIndex]) setQuiz(setQuestions[setIndex]);
  }, [quizSet, setIndex]); // eslint-disable-line react-hooks/exhaustive-deps
  function openSetQuestion(i) {
    setSetIndex(i);
    setQuiz(setQuestions[i]);
    setResult(null);
    setAnswer("");
  }
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const intent = takeIntent?.();
    if (intent?.topic) setTopic(shortTopic(intent.topic));
    if (intent?.materialId) {
      // Started from the study screen: keep the quiz on the material the student was looking at.
      setScopeMode("active");
      setMaterial(intent.materialId);
      setAdvancedOpen(true);
      setScopeNote(`Çalışma ekranındaki materyalden başlatıldı${intent.materialTitle ? `: ${intent.materialTitle}` : ""}. Kapsamı “Gelişmiş ayarlar” içinden değiştirebilirsin.`);
    }
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
  async function start(e) {
    e?.preventDefault?.();
    const epoch = ++requestEpoch.current;
    setBusy(true);
    setQuiz(null);
    setQuizSet(null);
    setSetIndex(0);
    setError("");
    setResult(null);
    setAnswer("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
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
        ...(count > 1 ? { count } : {}),
        ...(examStyleId ? { exam_style_id: examStyleId } : {}),
      }, controller.signal);
      if (epoch !== requestEpoch.current) return;
      if (q?.type === "quiz_set") setQuizSet(q);
      else setQuiz(q);
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
        note="bir deneme çöz"
        tone="lilac"
        actions={
          <>
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
            <h2>Yeni alıştırma</h2>
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
                  setQuizSet(null);
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
            {suggestions.length > 0 && (
              <div className="topic-suggestions" role="group" aria-label="Konu önerileri">
                {suggestions.map((t) => (
                  <button key={t} type="button" disabled={busy} onClick={() => setTopic(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
            <label>
              Soru türü
              <select
                aria-label="Soru türü"
                disabled={busy}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                {Object.entries(kindChoices).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Soru sayısı
              <select
                aria-label="Soru sayısı"
                disabled={busy}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {QUIZ_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {count > 1 && (
              <p className="product-note">
                Sorular arka planda tek tek hazırlanır; ilki hazır olunca çözmeye başlayabilirsin.
              </p>
            )}
            {scopeNote && <p className="product-note">{scopeNote}</p>}
            <div className="quiz-actions">
              <Btn
                type="submit"
                disabled={
                  busy ||
                  setRunning ||
                  !course ||
                  !topic.trim() ||
                  (scopeMode === "active" && !material) ||
                  (scopeMode === "selected" && !selectedMaterials.length)
                }
              >
                {busy ? `Hazırlanıyor… ${elapsed} sn` : "Alıştırma hazırla"}
              </Btn>
              {busy && (
                <button type="button" className="product-link" onClick={cancel}>
                  İptal
                </button>
              )}
            </div>
            <details
              className="quiz-advanced"
              open={advancedOpen}
              onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
            >
              <summary>
                Gelişmiş ayarlar <small>{advancedSummary}</small>
              </summary>
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
              <p className="product-note">Geçmiş sınav eklemek ve yeni sınav hazırlamak için soldaki <strong>Sınav</strong> menüsünü kullan.</p>
            </details>
            <p className="product-note">
              Sorular seçtiğin ders kaynaklarından hazırlanır. Yanıtından sonra
              açıklamayı ve ilgili kaynağı görebilirsin. Açık uçlu yanıtlar
              otomatik puanlanmaz.
            </p>
          </form>
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
                  setQuizSet(null);
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
              {error}{" "}
              {!busy && course && topic.trim() && (
                <button type="button" className="product-link" onClick={() => start()}>
                  Yeniden dene
                </button>
              )}
            </p>
          )}
          {quizSet && (
            <div className="mb-5" aria-label="Alıştırma seti">
              {setRunning ? (
                <p role="status" className="product-note">
                  {quizSet.requested} sorudan {quizSet.produced} tanesi hazır; diğerleri hazırlanıyor…
                </p>
              ) : (
                <p className="product-note">
                  {quizSet.requested} sorudan {quizSet.produced} tanesi hazırlandı.
                </p>
              )}
              {quizSet.note && <p className="product-note">{quizSet.note}</p>}
            </div>
          )}
          {sourceWarning && (
            <p className="quiz-source-warning mb-5" role="note">
              {sourceWarning}
            </p>
          )}
          {busy && !quiz ? <p role="status">Seçtiğin kaynaklardan soru hazırlanıyor ve denetleniyor…</p> : quizSet && !quiz ? (
            setRunning ? null : (
              <EmptyState title="Alıştırma seti boş kaldı">
                Bu konuda soru hazırlanamadı. Nedeni yukarıdaki notta yazıyor.
              </EmptyState>
            )
          ) : !quiz ? (
            <EmptyState title="Öğrendiklerini dene">
              Bir ders, konu ve soru türü seç. Gerçek kaynak bulunduğunda
              alıştırman burada açılır.
            </EmptyState>
          ) : (
            <article className="quiz-question product-panel">
              {quizSet && setQuestions.length > 0 && (
                <span className="source-badge">
                  Soru {setIndex + 1} / {setRunning ? quizSet.requested : setQuestions.length}
                </span>
              )}{" "}
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
              <h2><RichInline text={quiz.question} /></h2>
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
                        <span><RichInline text={option} /></span>
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
                  {result.explanation && result.explanation !== result.quote && <RichText text={result.explanation} />}
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
                    {quizSet && setIndex + 1 < setQuestions.length && (
                      <Btn onClick={() => openSetQuestion(setIndex + 1)}>
                        Sonraki soru →
                      </Btn>
                    )}
                    {quizSet && setIndex + 1 >= setQuestions.length && setRunning && (
                      <span className="product-note" role="status">Sonraki soru hazırlanıyor…</span>
                    )}
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
