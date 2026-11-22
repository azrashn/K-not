import { useEffect, useMemo, useRef, useState } from "react";
import QuizQuestionCard from "../components/QuizQuestionCard";
import QuestionNav from "../components/QuestionNav";
import { hashParam, hashWith, rememberInHash } from "../lib/page-query";
import { LAST, clearResume, finished, loadResume, positionOf, recordedResults, saveResume } from "../lib/resume";
import { api } from "../api/endpoints";
import { useResource } from "../hooks/useApi";
import { useApp } from "../app/store";
import { PageFrame, Btn } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { PageTitle, EmptyState } from "../components/ProductUI";
import { videoErrorText } from "../lib/video";
import { KIND_LABELS } from "../lib/quiz-history";
import QuizHistory from "../components/QuizHistory";
import { cleanTitle } from "../lib/topic-title";
const labels = KIND_LABELS;
/** The form also offers "Karışık": the kinds in turn (one question is a multiple-choice one). */
const kindChoices = { ...labels, MIXED: "Karışık (türler sırayla)" };
// Sohbetteki sorunun tamamı konu alanına yazılmasın: ilk cümle, en fazla 80 karakter, kelime sınırında.
function shortTopic(text) {
  const first = String(text).trim().split(/(?<=[.?!])\s/)[0].replace(/[?!.]+$/, "");
  if (first.length <= 80) return first;
  const cut = first.slice(0, 80);
  return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 80) + "…";
}
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
    // The course's practice list has arrived (an empty one too): until then no "no practice yet" text.
    [historyLoaded, setHistoryLoaded] = useState(false),
    // Questions of generated exams: not practice, shown only under the "Sınavdan" filter.
    [examHistory, setExamHistory] = useState([]),
    // Short topics from the course sources (GET /quiz-topics); null until they arrive or when unavailable.
    [sourceTopics, setSourceTopics] = useState(null),
    [quiz, setQuiz] = useState(null),
    // Feedback per question id: going back in a set shows the answer given there.
    [results, setResults] = useState({}),
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
  const consumed = useRef(false), requestEpoch = useRef(0), intentRef = useRef(null);
  // The open set lives in the address ("?set=<id>&q=<question id>", plus "course=" on the general /quiz
  // page), so leaving the page and coming back reopens it at the same question. Not written before the
  // address has been read, or the first render would erase it.
  const addressRead = useRef(false);
  const base = courseId ? `#/dersler/${courseId}/quiz` : "#/quiz";
  const result = quiz ? results[quiz.id] ?? null : null;
  // Topic ideas: what was practised before, then short topics from the sources (headings, subject words).
  // Only when the server has none: the material titles, cut to their subject ("2 Dakikada Java   Java
  // Nedir, …" → "Java Nedir"). The topic field itself starts empty.
  const suggestions = useMemo(() => {
    const fromSources = sourceTopics?.length
      ? sourceTopics
      : materials.filter((m) => m.status === "READY").map((m) => cleanTitle(m.title)).slice(0, 3);
    return [...new Set([...history.slice(0, 3).map((h) => h.topic), ...fromSources].map((t) => String(t || "").trim()).filter(Boolean))]
      .filter((t) => t !== topic.trim())
      .slice(0, 5);
  }, [history, materials, sourceTopics, topic]);
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
        // Answers given meanwhile stay; the server's record fills in the rest.
        setResults((rs) => ({ ...recordedResults(next?.questions), ...rs }));
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
  // The position follows the open question, not the other way round: if the list order ever changes while the
  // set is written, "Sonraki soru" must not open the question the student just answered.
  useEffect(() => {
    if (!quizSet || !quiz) return;
    const i = setQuestions.findIndex((q) => q.id === quiz.id);
    if (i >= 0 && i !== setIndex) setSetIndex(i);
  }, [quizSet]); // eslint-disable-line react-hooks/exhaustive-deps
  function openSetQuestion(i) {
    setSetIndex(i);
    setQuiz(setQuestions[i]);
  }
  // The address ("?set=<id>&q=2", q counted from 1) and this tab's record follow the open set.
  const openQ = quizSet?.id && quiz ? setIndex + 1 : null;
  useEffect(() => {
    if (!addressRead.current) return;
    rememberInHash(base, quizSet?.id ? { ...(courseId ? {} : { course }), set: quizSet.id, q: openQ } : {});
    if (quizSet?.id) {
      saveResume("quiz", course, { id: quizSet.id, q: openQ ?? 1 });
      saveResume("quiz", LAST, { id: quizSet.id, q: openQ ?? 1, course });
    }
  }, [base, courseId, course, quizSet?.id, openQ]);
  /** The set is closed by the student: neither this course's record nor the tab's last set points to it. */
  function forgetSet(c) {
    clearResume("quiz", c);
    if (loadResume("quiz", LAST)?.course === c) clearResume("quiz", LAST);
  }
  // Where "← Soruya dön" brings the student back: built from what is open, not read back from the address.
  const returnTo = quizSet?.id
    ? hashWith(base.slice(1), { ...(courseId ? {} : { course }), set: quizSet.id, q: openQ ?? 1 })
    : undefined;
  useEffect(() => {
    // The intent is taken once (it is gone after takeIntent); the restore below runs on every mount. In
    // development React mounts, unmounts and mounts again (StrictMode): the restore used to run only on the
    // first mount, whose answer the unmount then marked stale, so the page stayed empty ("Ders seç").
    if (!consumed.current) {
      consumed.current = true;
      const taken = takeIntent?.() ?? null;
      intentRef.current = taken;
      if (taken?.topic) setTopic(shortTopic(taken.topic));
      if (taken?.materialId) {
        // Started from the study screen: keep the quiz on the material the student was looking at.
        setScopeMode("active");
        setMaterial(taken.materialId);
        setAdvancedOpen(true);
        setScopeNote(`Çalışma ekranındaki materyalden başlatıldı${taken.materialTitle ? `: ${taken.materialTitle}` : ""}. Kapsamı “Gelişmiş ayarlar” içinden değiştirebilirsin.`);
      }
    }
    const intent = intentRef.current;
    let cancelled = false;
    const epoch = requestEpoch.current; // a request the student starts meanwhile wins over the restore
    const stale = () => cancelled || epoch !== requestEpoch.current;
    if (intent?.quizId && courseId) {
      addressRead.current = true;
      api
        .quiz(courseId, intent.quizId)
        .then((q) => !stale() && setQuiz(q))
        .catch((e) => !stale() && setError(videoErrorText(e)));
      return () => {
        cancelled = true;
      };
    }
    // Which set to reopen, at which question: the one in the address (back from another page, a reload),
    // else the one this tab left open (from the menu, or "← Soruya dön" when the address lost it). Not when
    // the student came to start something new (a topic or material from the study screen).
    const hash = window.location.hash;
    const back = Boolean(intent?.returnToQuestion);
    const addressCourse = courseId || hashParam(hash, "course");
    const fromAddress = hashParam(hash, "set");
    let record = null;
    if (!fromAddress && !intent?.topic && !intent?.materialId) {
      record = loadResume("quiz", addressCourse);
      // The general quiz page does not know the course: the last set open in this tab names it.
      const last = record || courseId ? null : loadResume("quiz", LAST);
      if (last?.course && (!addressCourse || last.course === addressCourse)) record = last;
    }
    const setCourseId = addressCourse || record?.course;
    const setId = fromAddress || record?.id;
    const q = fromAddress ? hashParam(hash, "q") : record?.q;
    if (!setId || !setCourseId) {
      addressRead.current = true;
      return undefined;
    }
    Promise.resolve(api.quizSet(setCourseId, setId))
      .then((s) => {
        if (stale()) return;
        addressRead.current = true;
        if (!s) return;
        // Every question answered: nothing to go back to from the menu (but "← Soruya dön" still goes back).
        if (record && !back && finished(s)) return forgetSet(setCourseId);
        if (!courseId) setCourse(setCourseId);
        const questions = (s.questions ?? []).filter((x) => x.available);
        const i = positionOf(q, questions.length);
        setQuizSet(s);
        setSetIndex(i);
        setResults(recordedResults(s.questions));
        if (questions[i]) setQuiz(questions[i]);
      })
      .catch(() => {
        if (stale()) return;
        addressRead.current = true;
        forgetSet(setCourseId);
        rememberInHash(base, {}); // removed meanwhile: the page opens without it
      });
    return () => {
      cancelled = true;
    };
    // Only on mount and when the course page changes: not when takeIntent's identity does (a new
    // function would rerun the restore and put the saved set back over the one just started).
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!course) return;
    const abort = new AbortController();
    setHistoryLoaded(false);
    Promise.all([
      api.knowledgeMaterials(course, abort.signal),
      api.quizzes(course, abort.signal),
    ])
      .then(([m, h]) => {
        if (abort.signal.aborted) return;
        setMaterials(m.materials);
        setHistory(h);
        setHistoryLoaded(true);
      })
      .catch((e) => {
        if (e.name === "AbortError" || abort.signal.aborted) return;
        setError(videoErrorText(e));
        setHistoryLoaded(true);
      });
    // Topic suggestions are optional: without them the material titles are used.
    setSourceTopics(null);
    Promise.resolve(api.quizTopics(course, abort.signal))
      .then((r) => {
        if (!abort.signal.aborted) setSourceTopics(Array.isArray(r?.topics) ? r.topics : null);
      })
      .catch(() => {});
    // A missing exam list only hides the "Sınavdan" rows; practice still works.
    api
      .quizzes(course, abort.signal, "EXAM")
      .then((h) => {
        if (!abort.signal.aborted) setExamHistory(Array.isArray(h) ? h : []);
      })
      .catch(() => {});
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
  /** Opens a question of the history. A practice set opens as a set, so "Sonraki soru" goes on through it;
   *  an exam question or a single question opens on its own (also when the set cannot be read). */
  async function openHistoryQuestion(card, item) {
    const epoch = ++requestEpoch.current;
    setError("");
    try {
      if (card.setId && !card.exam) {
        const s = await api.quizSet(course, card.setId).catch(() => null);
        if (epoch !== requestEpoch.current) return;
        const questions = (s?.questions ?? []).filter((q) => q.available);
        const i = questions.findIndex((q) => q.id === item.id);
        if (i >= 0) {
          setQuizSet(s);
          setSetIndex(i);
          setQuiz(questions[i]);
          setResults(recordedResults(s.questions));
          return;
        }
      }
      const saved = await api.quiz(course, item.id);
      if (epoch !== requestEpoch.current) return;
      setQuizSet(null);
      forgetSet(course); // a single question now: the set is no longer the place to return to
      setQuiz(saved);
      setResults({});
    } catch (e) {
      if (epoch === requestEpoch.current) setError(videoErrorText(e));
    }
  }
  async function start(e) {
    e?.preventDefault?.();
    const epoch = ++requestEpoch.current;
    setBusy(true);
    setQuiz(null);
    setQuizSet(null);
    setSetIndex(0);
    setError("");
    setResults({});
    forgetSet(course); // a new practice replaces the one left open
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
                  setMaterials([]);
                  setHistory([]);
                  setExamHistory([]);
                  setSelectedMaterials([]);
                  setQuiz(null);
                  setQuizSet(null);
                  setResults({});
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
          <QuizHistory
            key={course || "none"}
            course={course}
            history={history}
            examHistory={examHistory}
            loaded={historyLoaded}
            busy={busy}
            onOpen={openHistoryQuestion}
          />
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
            <>
            <QuizQuestionCard
              key={quiz.id}
              courseId={course}
              returnTo={returnTo}
              quiz={quiz}
              result={result}
              disabled={busy}
              onResult={async (saved) => {
                const epoch = requestEpoch.current;
                const id = quiz.id;
                setResults((rs) => ({ ...rs, [id]: saved }));
                try {
                  const next = await api.quizzes(course);
                  if (epoch === requestEpoch.current) setHistory(next);
                } catch {
                  /* the history is refreshed again after the next answer */
                }
              }}
              onRetry={() =>
                setResults((rs) => {
                  const next = { ...rs };
                  delete next[quiz.id];
                  return next;
                })
              }
              onError={(err) => setError(videoErrorText(err))}
              badge={
                quizSet && setQuestions.length > 0 ? (
                  <span className="source-badge">
                    Soru {setIndex + 1} / {setRunning ? quizSet.requested : setQuestions.length}
                  </span>
                ) : null
              }
            />
            {quizSet && setQuestions.length > 0 && (
              <QuestionNav
                at={setIndex}
                total={setQuestions.length}
                onGo={openSetQuestion}
                prevLabel="← Önceki soru"
                nextLabel="Sonraki soru →"
                label="Setteki sorular arasında gezin"
                last={setRunning ? <span className="product-note" role="status">Sonraki soru hazırlanıyor…</span> : null}
              />
            )}
            </>
          )}
        </section>
      </div>
    </PageFrame>
  );
}
