import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { api } from "../api/endpoints";
import { useApp } from "../app/store";
import { PageFrame, Btn } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { PageTitle, EmptyState } from "../components/ProductUI";
import { videoErrorText } from "../lib/video";
import { describeExamStyle, examStyleProblem } from "../lib/exam-style";
import {
  KIND_LABELS, OPTION_LETTERS, examFormProblem, examStatusText, fileProblem, topicsFromText,
} from "../lib/exam";

// The exam as printed paper. The same component is shown on screen and, while printing, as a copy
// outside the app shell (the shell clips content to the window, which would cut the paper).
function ExamSheet({ exam, answerKey, courseId, navigate, printOnly = false }) {
  return (
    <div className={printOnly ? "exam-print-sheet" : "exam-sheet"}>
      <h1 className="exam-sheet-title">{exam.title}</h1>
      <p className="exam-sheet-meta">Ad Soyad: ______________________ Tarih: ____________</p>
      <ol className="exam-questions">
        {(exam.questions || []).map((q) => (
          <li key={q.id}>
            {q.available === false ? (
              !printOnly && <p className="product-note">Bu sorunun kaynağı kaldırıldı veya değişti; soru gösterilmiyor.</p>
            ) : (
              <>
                <p className="exam-stem">{q.question}</p>
                {q.options?.length > 0 && (
                  <ul className="exam-options">
                    {q.options.map((o, i) => (
                      <li key={i}>{OPTION_LETTERS[i]}) {o}</li>
                    ))}
                  </ul>
                )}
                {!q.options?.length && (
                  <div className="exam-lines" aria-hidden="true"><i /><i /></div>
                )}
                {!printOnly && (
                  <p className="exam-meta">
                    <span className="source-badge">{KIND_LABELS[q.kind] || q.kind}</span>
                    {q.source?.title && <span className="source-badge"> · {q.source.title}</span>}
                    <button type="button" className="product-link" onClick={() => navigate(`/dersler/${courseId}/quiz`, { quizId: q.id })}>
                      Bu soruyu çöz
                    </button>
                  </p>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      {answerKey && (
        <section className="exam-key" {...(printOnly ? {} : { "aria-label": "Cevap anahtarı" })}>
          <h2>Cevap anahtarı</h2>
          <ol>
            {answerKey.key.map((k) => (
              <li key={k.quiz_id}>
                {k.available === false ? (
                  "Kaynak kaldırıldı"
                ) : (
                  <>
                    <strong>{k.expected ?? "Açık uçlu: öğretmen değerlendirir"}</strong>
                    {k.explanation && <span> — {k.explanation}</span>}
                    {k.source?.title && <small> ({k.source.title})</small>}
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// Past exam → saved style → a new source-bound exam. Questions that no course source supports are
// not written; the exam lists what could not be prepared and why.
export default function CourseExams({ courseId, pollMs = 2500 }) {
  const { navigate } = useApp();
  const [styles, setStyles] = useState([]),
    [exams, setExams] = useState([]),
    [exam, setExam] = useState(null),
    [key, setKey] = useState(null),
    [showKey, setShowKey] = useState(false),
    [printing, setPrinting] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("file"),
    [file, setFile] = useState(null),
    [name, setName] = useState(""),
    [text, setText] = useState("");
  const [styleId, setStyleId] = useState(""),
    [count, setCount] = useState(5),
    [topicsText, setTopicsText] = useState("");
  const alive = useRef(true);

  // While the browser prints (button or Ctrl+P) the paper is rendered outside the app shell.
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    Promise.all([api.examStyles(courseId, abort.signal), api.exams(courseId, abort.signal)])
      .then(([s, e]) => {
        if (abort.signal.aborted) return;
        setStyles(s);
        setExams(e);
        setStyleId((cur) => cur || s[0]?.id || "");
        const running = e.find((x) => x.status === "GENERATING");
        if (running) setExam({ ...running, questions: [] });
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(videoErrorText(err));
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [courseId]);

  const refreshList = useCallback(async () => {
    try {
      const list = await api.exams(courseId);
      if (alive.current) setExams(list);
    } catch {
      /* the list is refreshed again on the next action */
    }
  }, [courseId]);

  // While an exam is being prepared, follow its progress.
  useEffect(() => {
    if (exam?.status !== "GENERATING") return;
    const id = exam.id;
    const timer = setInterval(async () => {
      try {
        const next = await api.exam(courseId, id);
        if (!alive.current) return;
        setExam((cur) => (cur?.id === id ? next : cur));
        if (next.status !== "GENERATING") refreshList();
      } catch (err) {
        if (alive.current) setError(videoErrorText(err));
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [exam?.id, exam?.status, courseId, pollMs, refreshList]);

  async function saveStyle(saved) {
    setStyles((list) => [saved, ...list]);
    setStyleId(saved.id);
    setFile(null);
    setName("");
    setText("");
  }

  async function submitStyle(e) {
    e.preventDefault();
    setError("");
    const problem =
      mode === "file" ? fileProblem(file) : examStyleProblem({ name, text });
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const saved =
        mode === "file"
          ? await api.uploadExamStyleFile(courseId, file, name.trim())
          : await api.createExamStyle(courseId, { name: name.trim(), text });
      await saveStyle(saved);
    } catch (err) {
      setError(videoErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeStyle(id) {
    try {
      await api.deleteExamStyle(courseId, id);
      setStyles((list) => list.filter((x) => x.id !== id));
      if (styleId === id) setStyleId("");
    } catch (err) {
      setError(videoErrorText(err));
    }
  }

  async function generate(e) {
    e.preventDefault();
    setError("");
    const topics = topicsFromText(topicsText);
    const style = styles.find((x) => x.id === styleId);
    const problem = examFormProblem({
      styleId,
      count,
      hasStyleTopics: Boolean(style?.profile?.topic_terms?.length),
      topics,
    });
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const created = await api.createExam(courseId, {
        exam_style_id: styleId,
        count: Number(count),
        ...(topics.length ? { topics } : {}),
      });
      setExams((list) => [created, ...list]);
      setExam({ ...created, questions: [] });
      setKey(null);
      setShowKey(false);
    } catch (err) {
      setError(videoErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function open(id) {
    setError("");
    try {
      setExam(await api.exam(courseId, id));
      setKey(null);
      setShowKey(false);
    } catch (err) {
      setError(videoErrorText(err));
    }
  }

  async function removeExam(id) {
    try {
      await api.deleteExam(courseId, id);
      setExams((list) => list.filter((x) => x.id !== id));
      if (exam?.id === id) setExam(null);
    } catch (err) {
      setError(videoErrorText(err));
    }
  }

  async function print(withKey) {
    setError("");
    try {
      if (withKey && !key) setKey(await api.examKey(courseId, exam.id));
      setShowKey(withKey);
      setTimeout(() => window.print(), 50);
    } catch (err) {
      setError(videoErrorText(err));
    }
  }

  return (
    <PageFrame>
      <MobileBar />
      <PageTitle
        eyebrow="Geçmiş sınavdan yeni sınav"
        title="Sınavlar"
        note="geçmişten yarına"
        tone="red"
        actions={
          <button className="product-link" onClick={() => navigate(`/dersler/${courseId}/quiz`)}>
            Alıştırmalara dön →
          </button>
        }
      >
        Geçmiş bir sınavını yükle; soru biçimini öğrenip ders kaynaklarından benzer yeni bir sınav
        hazırlanır. Kaynakta karşılığı olmayan soru yazılmaz.
      </PageTitle>
      <div className="quiz-layout exam-layout">
        <aside>
          <section className="product-panel product-form" aria-label="Geçmiş sınav ekle">
            <h2>1. Geçmiş sınav ekle</h2>
            <div role="group" aria-label="Ekleme yöntemi" className="exam-modes">
              {[["file", "Dosya yükle"], ["paste", "Metin yapıştır"]].map(([id, label]) => (
                <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>
                  {label}
                </button>
              ))}
            </div>
            <form onSubmit={submitStyle} className="product-form">
              <label>
                Sınav adı{mode === "file" ? " (isteğe bağlı)" : ""}
                <input aria-label="Sınav adı" value={name} maxLength={120} disabled={busy} onChange={(e) => setName(e.target.value)} />
              </label>
              {mode === "file" ? (
                <label>
                  Sınav dosyası (PDF, DOCX, TXT)
                  <input
                    aria-label="Sınav dosyası"
                    type="file"
                    accept=".pdf,.docx,.txt,.md"
                    disabled={busy}
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              ) : (
                <label>
                  Sınav metni
                  <textarea aria-label="Sınav metni" rows={6} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
                </label>
              )}
              <Btn type="submit" disabled={busy}>{mode === "file" ? "Dosyayı oku" : "Stili kaydet"}</Btn>
            </form>
            <p className="product-note">
              Sorular numaralı olmalı (1. … 2. …). Taranmış PDF okunamaz; metnini yapıştır. Sınav metni
              saklanmaz, yalnız soru biçimi ve sık terimler saklanır.
            </p>
            {styles.map((s) => (
              <div key={s.id} className="resume-row">
                <strong>{s.name}</strong>
                <small>{describeExamStyle(s.profile)}</small>
                <button type="button" className="product-link" onClick={() => removeStyle(s.id)}>
                  Stili sil
                </button>
              </div>
            ))}
          </section>

          <form className="product-panel product-form mt-6" onSubmit={generate} aria-label="Yeni sınav hazırla">
            <h2>2. Yeni sınav hazırla</h2>
            <label>
              Sınav stili
              <select aria-label="Sınav stili" value={styleId} disabled={busy} onChange={(e) => setStyleId(e.target.value)}>
                <option value="">Stil seç</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label>
              Soru sayısı
              <input aria-label="Soru sayısı" type="number" min={1} max={20} value={count} disabled={busy} onChange={(e) => setCount(e.target.value)} />
            </label>
            <label>
              Konular (satır başına bir konu, isteğe bağlı)
              <textarea aria-label="Konular" rows={3} value={topicsText} disabled={busy} placeholder="Boş bırakırsan sınavdaki sık terimler kullanılır" onChange={(e) => setTopicsText(e.target.value)} />
            </label>
            <Btn type="submit" disabled={busy || !styleId}>Sınavı hazırla</Btn>
          </form>
        </aside>

        <section>
          {error && (
            <p role="alert" className="product-error">{error}</p>
          )}
          {exams.length > 0 && (
            <div className="exam-list" role="list" aria-label="Hazırlanan sınavlar">
              {exams.map((x) => (
                <div role="listitem" key={x.id} className={`resume-row${exam?.id === x.id ? " active" : ""}`}>
                  <button type="button" className="exam-open" onClick={() => open(x.id)}>
                    <strong>{x.title}</strong>
                    <small>{examStatusText(x)}</small>
                  </button>
                  <button type="button" className="product-link" onClick={() => removeExam(x.id)} aria-label={`${x.title} sınavını sil`}>
                    Sil
                  </button>
                </div>
              ))}
            </div>
          )}
          {!exam ? (
            <EmptyState title="Henüz sınav seçilmedi">
              Soldan bir geçmiş sınav ekleyip yeni sınav hazırla ya da hazırlanmış bir sınavı seç.
            </EmptyState>
          ) : (
            <article className="product-panel exam-detail" aria-label="Sınav">
              <div className="exam-head no-print">
                <h2>{exam.title}</h2>
                <p role="status" className="product-note">{examStatusText(exam)}</p>
                {exam.note && <p className="product-note">{exam.note}</p>}
                {exam.failures?.length > 0 && (
                  <details>
                    <summary>Hazırlanamayan {exam.failures.length} deneme</summary>
                    <ul>
                      {exam.failures.map((f, i) => (
                        <li key={i}><span className="source-badge">{f.topic}</span> {f.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {exam.questions?.length > 0 && (
                  <div className="product-actions">
                    <button type="button" className="exam-print" onClick={() => print(false)}>Yazdır / PDF olarak kaydet</button>
                    <button type="button" className="exam-print" onClick={() => print(true)}>Cevap anahtarıyla yazdır</button>
                  </div>
                )}
              </div>
              <ExamSheet
                exam={exam}
                answerKey={showKey ? key : null}
                courseId={courseId}
                navigate={navigate}
              />
            </article>
          )}
        </section>
      </div>
      {printing && exam && createPortal(
        <div className="exam-print-root">
          <ExamSheet exam={exam} answerKey={showKey ? key : null} courseId={courseId} navigate={navigate} printOnly />
        </div>,
        document.body,
      )}
    </PageFrame>
  );
}
