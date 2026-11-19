import Voice from "../components/Voice";
import { isSubmitKey } from "../lib/composer-keys";
import { modeLabel, statusLabel, stampFor, isExcerpt } from "../lib/answer-labels";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/endpoints";
import { useApp } from "../app/store";
import { PageFrame, Btn } from "../components/ui";
import { MobileBar } from "../components/PageBits";
import { useVideoProgress } from "../hooks/useVideoProgress";
import { videoTime, videoErrorText } from "../lib/video";
import DocumentCanvas from "../components/DocumentCanvas";
import VideoProgressPanel from "../components/VideoProgressPanel";
import { MaterialRename } from "../components/ProductUI";
import MaterialSummary from "../components/MaterialSummary";
import ClaimSupport from "../components/ClaimSupport";
import MaterialFind from "../components/MaterialFind";
import WorkspaceStart from "../components/WorkspaceStart";
import RichText from "../components/RichText";
import { lastMaterial, rememberMaterial } from "../lib/last-material";
import { mb, useLimits } from "../lib/limits";
import StepBoard from "../components/board/StepBoard";
import { hasSteps } from "../lib/board/content";

const locationLabel = (l) =>
  l.kind === "video"
    ? `${videoTime(l.start_ms / 1000)}–${videoTime(l.end_ms / 1000)}`
    : l.kind === "page"
      ? `Sayfa ${l.page}`
      : l.kind === "slide"
        ? `Slayt ${l.slide}${l.section === "speaker_notes" ? " · konuşmacı notu" : ""}`
        : "Metin";
const watchLabel = {
  WATCHED: "İlgili aralık izlendi",
  PARTIALLY_WATCHED: "İlgili aralık kısmen izlendi",
  UNWATCHED: "İlgili aralık izlenmedi",
  UNKNOWN: "İzleme kaydı bilinmiyor",
};

// Kaynaktan alınan metin: yeniden akıtılır (PDF satır sonları), uzunsa katlanır.
function QuoteBlock({ text, label }) {
  const [open, setOpen] = useState(false);
  const clean = String(text ?? "").replace(/(\p{L})-\n(\p{L})/gu, "$1$2");
  const long = clean.length > 420;
  return (
    <blockquote className="quote-block" data-collapsed={long && !open ? "true" : undefined}>
      <span className="quote-label">{label}</span>
      <RichText className="answer-text" text={clean} />
      {long && (
        <button type="button" className="quote-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Daha az göster ▴" : "Devamını göster ▾"}
        </button>
      )}
    </blockquote>
  );
}

export default function LearningWorkspace({ courseId }) {
  const { navigate, takeIntent } = useApp();
  const limits = useLimits();
  const [course, setCourse] = useState(null),
    [materials, setMaterials] = useState([]);
  const [selected, setSelected] = useState(null),
    [segments, setSegments] = useState([]),
    [source, setSource] = useState(null);
  const [url, setUrl] = useState(null),
    [question, setQuestion] = useState(""),
    [turns, setTurns] = useState([]),
    [freshAnswer, setFreshAnswer] = useState(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [chats, setChats] = useState([]),
    [chatId, setChatId] = useState(null),
    [chatLoading, setChatLoading] = useState(false),
    [assistantOpen, setAssistantOpen] = useState(true),
    [materialFilter, setMaterialFilter] = useState("");
  const [uploadMode, setUploadMode] = useState("document"),
    [link, setLink] = useState(""),
    [linkBusy, setLinkBusy] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [retryRequest, setRetryRequest] = useState(null);
  // Tahtada anlatılan cevap (steps taşıyorsa); yoksa çalışma alanı eskisi gibi.
  const [boardTurn, setBoardTurn] = useState(null);
  const viewerTop = useRef(null);
  const [viewport, setViewport] = useState(null),
    [scopeMode, setScopeMode] = useState("course"),
    [selectedMaterials, setSelectedMaterials] = useState([]),
    [references, setReferences] = useState([]),
    [currentMs, setCurrentMs] = useState(0);
  const viewportChanged = useCallback((v) => setViewport(v), []);
  const requestScope = {
    mode: scopeMode,
    ...(scopeMode === "selected" ? { material_ids: selectedMaterials } : {}),
  };
  const intent = useRef(null),
    intentConsumed = useRef(false),
    chatScroll = useRef(null);
  const initialSeek = useRef(false);
  const [tab, setTab] = useState("sayfa");
  useEffect(() => {
    setTab("sayfa");
  }, [selected?.id]);
  const input = useRef(null),
    player = useRef(null),
    activeRequest = useRef(null),
    previewRequest = useRef(null),
    pending = useRef(null);
  const videoId = selected?.kind === "VIDEO" ? selected.source_id : null;
  const watch = useVideoProgress(courseId, videoId, Boolean(videoId), player);
  useEffect(() => {
    if (!intentConsumed.current) {
      intent.current = takeIntent?.();
      intentConsumed.current = true;
    }
  }, [takeIntent]);
  useEffect(() => {
    const abort = new AbortController();
    api
      .conversations(courseId, abort.signal)
      .then((items) => {
        if (abort.signal.aborted) return;
        setChats(items);
        const saved = sessionStorage.getItem(`knot.chat.${courseId}`);
        if (saved && items.some((t) => t.id === saved)) void openChat(saved);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(videoErrorText(e));
      });
    return () => abort.abort();
  }, [courseId]);
  // Yeni yanıt gelince sohbet en alta atlamaz: yanıtın başı görünür kalır, okuma yukarıdan başlar.
  // Kaydedilmiş bir konuşma açılırken ise (çok sayıda yanıt birden) son yanıta inilir.
  useEffect(() => {
    const box = chatScroll.current;
    if (!box) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const behavior = reduce ? "auto" : "smooth";
    const last = turns.at(-1);
    if (last && last === freshAnswer) {
      const el = [...box.querySelectorAll(".chat-turn")].at(-1);
      if (el)
        box.scrollTo?.({
          top: el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8,
          behavior,
        });
    } else {
      box.scrollTo?.({ top: box.scrollHeight, behavior: "auto" });
    }
  }, [turns.length]);
  useEffect(() => {
    if (!materials.length || !intent.current) return;
    const next = intent.current;
    intent.current = null;
    if (next.openSource) void openEvidence(next.openSource);
    else if (next.resume?.materialId) {
      const m = materials.find((m) => m.id === next.resume.materialId);
      if (m) void select(m);
    }
  }, [materials]);
  async function openChat(id) {
    setChatLoading(true);
    setError("");
    try {
      const t = await api.conversation(courseId, id);
      setTurns(
        t.messages
          .filter((m) => m.role === "assistant")
          .map((m) => ({
            ...m.payload,
            message_id: m.id,
            chat_id: id,
            answer: m.content,
          })),
      );
      setChatId(id);
      setBoardTurn(null);
      sessionStorage.setItem(`knot.chat.${courseId}`, id);
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setChatLoading(false);
    }
  }
  const refresh = useCallback(
    async (signal) => {
      const [c, m] = await Promise.all([
        api.course(courseId, signal),
        api.knowledgeMaterials(courseId, signal),
      ]);
      if (!signal?.aborted) {
        setCourse(c);
        setMaterials(m.materials);
        setLoading(false);
      }
    },
    [courseId],
  );
  useEffect(() => {
    const abort = new AbortController();
    refresh(abort.signal).catch((e) => {
      if (e.name !== "AbortError") {
        setError(videoErrorText(e));
        setLoading(false);
      }
    });
    return () => {
      abort.abort();
      activeRequest.current?.abort();
      previewRequest.current?.abort();
    };
  }, [courseId, refresh]);
  useEffect(() => {
    if (!videoId) return;
    const abort = new AbortController();
    let objectUrl;
    api
      .videoFile(courseId, videoId, abort.signal)
      .then((blob) => {
        if (!abort.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl({ id: videoId, value: objectUrl });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(videoErrorText(e));
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courseId, videoId]);
  useEffect(() => {
    if (
      videoId &&
      watch.progress &&
      player.current?.readyState >= 1 &&
      !initialSeek.current
    ) {
      player.current.currentTime =
        (pending.current ?? watch.progress.position_ms ?? 0) / 1000;
      initialSeek.current = true;
    }
  }, [videoId, watch.progress, url]);
  useEffect(() => {
    if (
      !materials.some(
        (m) => !["READY", "FAILED", "failed", "UNAVAILABLE"].includes(m.status),
      )
    )
      return;
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [materials, refresh]);
  async function select(material, target) {
    previewRequest.current?.abort();
    const abort = new AbortController();
    previewRequest.current = abort;
    if (selected?.id !== material.id) {
      setUrl(null);
      initialSeek.current = false;
    }
    setSelected(material);
    rememberMaterial(courseId, material.id);
    if (scopeMode === "active")
      setReferences((rs) => rs.filter((r) => r.material_id === material.id));
    setViewport(null);
    setCurrentMs(target?.location?.start_ms || 0);
    setSegments([]);
    setSource(null);
    setError("");
    setConfirmDelete(false);
    pending.current = target?.location?.start_ms ?? null;
    if (material.status !== "READY") return;
    try {
      const result = await api.knowledgePreview(
        courseId,
        material.id,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setSegments(result.segments);
      const actual = target
        ? result.segments.find((s) => s.id === target.id)
        : result.segments[0];
      if (target && !actual) {
        setError(
          "Kaynak güncellenmiş veya kaldırılmış. Soruyu yeniden gönder.",
        );
        return;
      }
      setSource(actual || null);
      void api
        .activity(courseId, {
          material_id: material.id,
          ...(actual ? { segment_id: actual.id } : {}),
        })
        .catch(() =>
          setError(
            "Çalışma konumu kaydedilemedi. Materyali yeniden seçerek deneyebilirsin.",
          ),
        );
      if (
        material.kind === "VIDEO" &&
        player.current?.readyState >= 1 &&
        url?.id === material.source_id
      ) {
        player.current.currentTime =
          (pending.current ?? watch.progress?.position_ms ?? 0) / 1000;
      }
    } catch (e) {
      if (e.name !== "AbortError") setError(videoErrorText(e));
    }
  }
  async function openEvidence(e) {
    try {
      const actual = await api.knowledgeSource(courseId, e.material_id, e.id);
      const material = materials.find((m) => m.id === e.material_id);
      if (!material) throw new Error("Material missing");
      await select(material, actual);
    } catch {
      setError(
        "Bu kaynak kaldırılmış veya güncellenmiş olabilir. Soruyu yeniden gönder.",
      );
      await refresh();
    }
  }
  async function upload(file) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      if (/\.pdf$/i.test(file.name))
        await api.upload(courseId, file, { documentType: "notes" });
      else if (/\.(mp4|webm)$/i.test(file.name))
        await api.uploadVideo(courseId, file);
      else await api.knowledgeUpload(courseId, file);
      await refresh();
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setUploading(false);
    }
  }
  async function ask(
    event,
    explainTurn,
    responseMode = "default",
    retryPayload = null,
  ) {
    event?.preventDefault();
    const text =
      retryPayload?.question ||
      (explainTurn ? explainTurn.question : question.trim());
    if (!text || busy) return;
    const abort = new AbortController();
    activeRequest.current = abort;
    setBusy(true);
    setError("");
    let submitted = null;
    try {
      await watch.flushForQuestion();
      const previous = explainTurn || turns.at(-1);
      const snapshot =
        responseMode !== "default" ? explainTurn?.resolved_context : null;
      const time =
        videoId && player.current
          ? Math.round(player.current.currentTime * 1000)
          : null;
      // A transcript click does not stay active after playback leaves that span.
      const liveSource =
        source?.id &&
        (time === null ||
          (source.location.start_ms <= time && time < source.location.end_ms));
      submitted = retryPayload || {
        question: text,
        scope:
          responseMode !== "default" && explainTurn?.retrieval?.scope
            ? explainTurn.retrieval.scope
            : requestScope,
        response_mode: responseMode,
        // Kullanıcı açıkça bir bölge/metin seçtiyse soru o seçime aittir: sözcüklerden tahmin edilmez.
        reference_mode:
          responseMode !== "default"
            ? "conversation"
            : !videoId && (viewport?.region || viewport?.selected_text)
              ? "viewport"
              : "auto",
        ...(references.length
          ? { explicit_source_ids: references.map((e) => e.id) }
          : {}),
        ...(videoId && player.current
          ? {
              viewport: {
                kind: "video",
                timestamp_ms: Math.round(player.current.currentTime * 1000),
                ...(liveSource && viewport?.selected_text
                  ? { selected_text: viewport.selected_text }
                  : {}),
              },
            }
          : viewport
            ? { viewport }
            : {}),
        ...(chatId ? { chat_id: chatId } : {}),
        ...(selected ? { active_material_id: selected.id } : {}),
        ...(liveSource ? { active_source_id: source.id } : {}),
        ...(videoId && player.current
          ? { current_time_ms: Math.round(player.current.currentTime * 1000) }
          : {}),
        ...(previous ? { conversation_id: previous.conversation_id } : {}),
        ...(explainTurn?.message_id
          ? { parent_message_id: explainTurn.message_id }
          : {}),
        ...(explainTurn && responseMode === "default"
          ? { explain_now: true }
          : {}),
        ...(snapshot
          ? {
              active_material_id: snapshot.active_material_id,
              viewport: snapshot.viewport,
              explicit_source_ids: snapshot.explicit_source_ids || [],
              ...(snapshot.source_ids?.[0]
                ? { active_source_id: snapshot.source_ids[0] }
                : {}),
            }
          : {}),
      };
      const answer = await api.knowledgeAnswer(
        courseId,
        submitted,
        abort.signal,
      );
      if (!abort.signal.aborted) {
        setRetryRequest(null);
        setTurns((old) => [...old.slice(-49), answer]);
        setFreshAnswer(answer);
        setBoardTurn(hasSteps(answer) ? answer : null);
        setChatId(answer.chat_id || null);
        void api
          .conversations(courseId)
          .then(setChats)
          .catch(() => {});
        if (answer.chat_id)
          sessionStorage.setItem(`knot.chat.${courseId}`, answer.chat_id);
        if (!explainTurn) setQuestion("");
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setError(videoErrorText(e));
        setRetryRequest(submitted);
      }
    } finally {
      if (activeRequest.current === abort) setBusy(false);
    }
  }
  async function remove() {
    if (!selected) return;
    setUploading(true);
    try {
      if (selected.kind === "PDF") await api.remove(selected.source_id);
      else if (selected.kind === "VIDEO")
        await api.removeVideo(courseId, selected.source_id);
      else await api.knowledgeRemove(courseId, selected.id);
      setSelected(null);
      setSelectedMaterials((ids) => ids.filter((id) => id !== selected.id));
      setReferences((rs) => rs.filter((r) => r.material_id !== selected.id));
      if (
        scopeMode === "active" ||
        (scopeMode === "selected" &&
          selectedMaterials.every((id) => id === selected.id))
      )
        setScopeMode("course");
      setSource(null);
      setSegments([]);
      setConfirmDelete(false);
      setTurns([]);
      setBoardTurn(null);
      await refresh();
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setUploading(false);
    }
  }
  async function importLink(e) {
    e.preventDefault();
    setLinkBusy(true);
    setError("");
    try {
      await api.importVideoLink(courseId, link.trim());
      setLink("");
      await refresh();
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setLinkBusy(false);
    }
  }
  function newChat() {
    activeRequest.current?.abort();
    setBusy(false);
    setTurns([]);
    setBoardTurn(null);
    setChatId(null);
    setRetryRequest(null);
    sessionStorage.removeItem(`knot.chat.${courseId}`);
  }
  function chooseSegment(s) {
    setSource(s);
    if (s?.location.kind === "video") {
      pending.current = s.location.start_ms;
      if (player.current?.readyState >= 1)
        player.current.currentTime = pending.current / 1000;
    }
    void api
      .activity(courseId, {
        material_id: selected.id,
        ...(s ? { segment_id: s.id } : {}),
      })
      .catch(() => setError("Çalışma konumu kaydedilemedi."));
  }
  const canSend =
    !busy &&
    !chatLoading &&
    Boolean(question.trim()) &&
    !(scopeMode === "selected" && !selectedMaterials.length) &&
    !(scopeMode === "active" && !selected) &&
    materials.some((m) => m.status === "READY");
  // Tahtadaki kaynak: kanıtsa materyali o yerde açar, yalnızca zamansa açık videoyu o ana götürür.
  async function openBoardSource(item) {
    if (item.evidence?.material_id) await openEvidence(item.evidence);
    else if (Number.isFinite(item.ms) && videoId && player.current) {
      player.current.currentTime = item.ms / 1000;
      setCurrentMs(item.ms);
    }
    viewerTop.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  function sourceButton(e) {
    const checked = references.some((r) => r.id === e.id);
    return (
      <div key={e.id} className="answer-source-group">
        <button onClick={() => openEvidence(e)} className="answer-source" data-kind={e.kind}>
          <span className="source-badge">
            [{e.n}] {e.kind} · {locationLabel(e.location)}
          </span>
          <strong>{e.title}</strong>
          <span aria-hidden>↗</span>
        </button>
        <label className="reference-check">
          <input
            type="checkbox"
            checked={checked}
            aria-label={`${e.title} ${locationLabel(e.location)} referansını karşılaştır`}
            onChange={(event) => {
              setReferences((rs) =>
                event.target.checked
                  ? [...rs, e].slice(-8)
                  : rs.filter((r) => r.id !== e.id),
              );
              if (event.target.checked && scopeMode === "selected")
                setSelectedMaterials((ids) =>
                  ids.includes(e.material_id) ? ids : [...ids, e.material_id],
                );
              if (
                event.target.checked &&
                scopeMode === "active" &&
                e.material_id !== selected?.id
              ) {
                setScopeMode("selected");
                setSelectedMaterials([
                  ...new Set(
                    [
                      selected?.id,
                      e.material_id,
                      ...references.map((r) => r.material_id),
                    ].filter(Boolean),
                  ),
                ]);
              }
            }}
          />
          Karşılaştırma referansı
        </label>
      </div>
    );
  }

  return (
    <PageFrame max="max-w-[110rem]" className="learning-page">
      <MobileBar />
      <header className="workspace-heading">
        <div>
          <button className="product-link" onClick={() => navigate("/dersler")}>
            ← Derslerin
          </button>
          <h1>{course?.name || "Ders çalışma alanı"}</h1>
          <span className="title-note" aria-hidden>masan hazır</span>
          <p>Materyalini incele. Aynı bağlamda sor, öğren ve uygula.</p>
        </div>
        <div className="product-actions">
          <button
            className="product-link"
            onClick={() =>
              navigate(`/dersler/${courseId}/quiz`, {
                topic: question || turns.at(-1)?.question,
                ...(selected ? { materialId: selected.id, materialTitle: selected.title } : {}),
              })
            }
          >
            Alıştırma yap ↗
          </button>
          <button
            className="workspace-toggle"
            aria-expanded={assistantOpen}
            onClick={() => setAssistantOpen((v) => !v)}
          >
            {assistantOpen ? "Asistanı daralt" : "Asistanı aç"}
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="product-error workspace-error">
          {error}
        </p>
      )}
      <div
        className={`workspace-grid ${assistantOpen ? "" : "assistant-closed"}`}
      >
        <aside className="material-rail" aria-label="Ortak ders materyalleri">
          <div className="section-heading">
            <h2>Kaynaklar</h2>
            <span>{materials.length}</span>
          </div>
          <details className="rail-add" open={materials.length === 0 || undefined}>
          <summary>+ Ekle</summary>
          <div className="upload-tabs" aria-label="Materyal ekleme yöntemi">
            {[
              ["document", "Belge"],
              ["video", "Video"],
              ["link", "Bağlantı"],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={uploadMode === id}
                onClick={() => setUploadMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {uploadMode === "link" ? (
            <form className="product-form link-import" onSubmit={importLink}>
              <label>
                YouTube veya Drive bağlantısı
                <input
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                  maxLength={2048}
                />
              </label>
              <button
                className="workspace-toggle"
                disabled={linkBusy || !link.trim()}
              >
                {linkBusy ? "Video alınıyor…" : "Bağlantıdan ekle"}
              </button>
              <p>
                Drive: bağlantıya sahip herkes erişebilmeli. En fazla {mb(limits.video_bytes)} / 2
                saat.
              </p>
            </form>
          ) : (
            <>
              <button
                className="upload-drop"
                disabled={uploading}
                onClick={() => input.current?.click()}
              >
                <span aria-hidden>＋</span>
                {uploading
                  ? "Materyal ekleniyor…"
                  : uploadMode === "video"
                    ? "Video yükle"
                    : "Belge yükle"}
                <small>
                  {uploadMode === "video"
                    ? `MP4 / WebM · ${mb(limits.video_bytes)}`
                    : `PDF / PPTX / TXT · PPTX ve TXT: ${mb(limits.study_file_bytes)}`}
                </small>
              </button>
              <input
                ref={input}
                type="file"
                className="sr-only"
                aria-label="Ortak ders materyali seç"
                accept={
                  uploadMode === "video" ? ".mp4,.webm" : ".pdf,.pptx,.txt"
                }
                onChange={(e) => {
                  upload(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </>
          )}
          </details>
          <details className="rail-tools">
          <summary>Ara ve kapsam</summary>
          <label className="sr-only" htmlFor="material-filter">
            Materyallerde ara
          </label>
          <input
            id="material-filter"
            className="material-filter"
            value={materialFilter}
            onChange={(e) => setMaterialFilter(e.target.value)}
            placeholder="Kaynak ara…"
          />
          <button
            className="product-link text-xs"
            onClick={() => refresh().catch((e) => setError(videoErrorText(e)))}
          >
            İşleme durumunu yenile
          </button>
          <label className="scope-control">
            Arama kapsamı
            <select
              aria-label="Arama kapsamı"
              value={scopeMode}
              onChange={(e) => {
                const mode = e.target.value;
                setScopeMode(mode);
                setReferences((rs) =>
                  rs.filter(
                    (r) =>
                      mode === "course" ||
                      (mode === "active"
                        ? r.material_id === selected?.id
                        : selectedMaterials.includes(r.material_id)),
                  ),
                );
              }}
            >
              <option value="course">Tüm ders kaynakları</option>
              <option value="active">Yalnız açık materyal</option>
              <option value="selected">Seçtiğim kaynaklar</option>
            </select>
          </label>
          </details>
          {selectedMaterials.length > 0 && (
            <p className="product-note">
              {selectedMaterials.length} kaynak seçili{" "}
              <button
                className="product-link"
                onClick={() => {
                  setSelectedMaterials([]);
                  setReferences([]);
                  setScopeMode("course");
                }}
              >
                Seçimi temizle
              </button>
            </p>
          )}
          {references.length > 0 && (
            <p className="product-note">
              {references.length} açık kaynak referansı{" "}
              <button
                className="product-link"
                onClick={() => setReferences([])}
              >
                Referansları temizle
              </button>
            </p>
          )}
          <div className="material-list">
            {loading && <p role="status">Kaynaklar yükleniyor…</p>}
            {!loading && !materials.length && (
              <p className="product-note">
                İlk kaynağını ekle. Her materyal bu derse bağlı kalır.
              </p>
            )}
            {materials
              .filter((m) =>
                m.title
                  .toLocaleLowerCase("tr")
                  .includes(materialFilter.toLocaleLowerCase("tr")),
              )
              .map((m) => (
                <div key={m.id} className="material-choice">
                  <input
                    type="checkbox"
                    aria-label={`${m.title} kaynağını seç`}
                    disabled={m.status !== "READY"}
                    checked={selectedMaterials.includes(m.id)}
                    onChange={(e) => {
                      setScopeMode("selected");
                      setSelectedMaterials((ids) =>
                        e.target.checked
                          ? [...ids, m.id]
                          : ids.filter((id) => id !== m.id),
                      );
                      setReferences((refs) =>
                        refs.filter((r) => r.material_id !== m.id),
                      );
                    }}
                  />
                  <button
                    key={m.id}
                    onClick={() => select(m)}
                    className={`material-item ${m.id === selected?.id ? "active" : ""}`}
                    data-kind={m.kind}
                    data-type={m.type || m.documentType || ""}
                  >
                    <span className="source-badge">{m.kind}</span>
                    <strong>{m.title}</strong>
                    <small>
                      {m.status === "READY"
                        ? "Hazır"
                        : ["FAILED", "failed"].includes(m.status)
                          ? "İşlenemedi"
                          : m.status === "UNAVAILABLE"
                            ? "Servise ulaşılamıyor"
                            : "İşleniyor"}
                      {m.page_count
                        ? ` · ${m.page_count} ${m.kind === "PPTX" ? "slayt" : "sayfa"}`
                        : ""}
                    </small>
                  </button>
                </div>
              ))}
          </div>
        </aside>
        <section
          className="material-viewer"
          aria-label="Ortak materyal görüntüleyici"
        >
          <header>
            <span className="product-eyebrow">
              {selected?.kind || "Çalışma alanı"}
            </span>
            <h2>{selected?.title || "Kaynağın burada açılacak"}</h2>
          </header>
          {selected && selected.status === "READY" && (
            <div className="viewer-tabs" role="tablist" aria-label="Kaynak görünümü">
              {[
                ["sayfa", videoId ? "Video" : "Sayfa"],
                ["metin", "Metin"],
                ["bolumler", `Bölümler${segments.length > 1 ? " " + segments.length : ""}`],
                ["ozet", "Özet"],
              ].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} data-on={tab === id} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {tab === "sayfa" && selected && (() => {
            const seen = new Set();
            const marks = turns
              .flatMap((t) => t.evidence || [])
              .filter((e) => e.material_id === selected.id && (e.location?.kind === "page" || e.location?.kind === "slide"))
              .filter((e) => { const k = locationLabel(e.location); if (seen.has(k)) return false; seen.add(k); return true; });
            if (!marks.length) return null;
            return (
              <nav className="bookmark-rail" aria-label="Cevaplarda kullanılan sayfalar">
                <span className="bookmark-label">ŞERİTLER</span>
                {marks.map((e, i) => (
                  <button key={e.id} type="button" className="bookmark" data-i={i % 4} onClick={() => openEvidence(e)}>
                    {locationLabel(e.location)}
                  </button>
                ))}
              </nav>
            );
          })()}
          {boardTurn && (
            <section className="workspace-board" aria-label="Tahtada anlatım">
              <div className="workspace-board-head">
                <div>
                  <span className="product-eyebrow">Tahtada anlatım</span>
                  <p>{boardTurn.question || "Önceki soru"}</p>
                </div>
                <button className="product-link" onClick={() => setBoardTurn(null)}>
                  Tahtayı kapat
                </button>
              </div>
              <StepBoard
                steps={boardTurn.steps}
                evidence={boardTurn.evidence || []}
                onSource={openBoardSource}
              />
            </section>
          )}
          <div ref={viewerTop} />
          {!selected && (
            <WorkspaceStart
              materials={materials}
              lastId={lastMaterial(courseId)}
              onOpen={(m) => select(m)}
            />
          )}
          {tab === "sayfa" &&
            selected?.status === "READY" &&
            ["PDF", "PPTX"].includes(selected.kind) && (
              <DocumentCanvas
                onShowText={() => setTab("metin")}
                key={selected.id}
                courseId={courseId}
                material={selected}
                source={source}
                segments={segments}
                onSource={chooseSegment}
                onViewportChange={viewportChanged}
              />
            )}
          {tab === "sayfa" && videoId && selected?.status === "READY" && (
            <div className="video-view">
              {url?.id === videoId ? (
                <video
                  key={videoId}
                  ref={player}
                  src={url.value}
                  controls
                  aria-label="Ortak ders videosu"
                  onLoadedMetadata={(e) => {
                    if (pending.current !== null || watch.progress) {
                      e.currentTarget.currentTime =
                        (pending.current ?? watch.progress?.position_ms ?? 0) /
                        1000;
                      initialSeek.current = true;
                    }
                  }}
                  onTimeUpdate={(e) => {
                    watch.observe();
                    setCurrentMs(
                      Math.round(e.currentTarget.currentTime * 1000),
                    );
                  }}
                  onPlay={watch.observe}
                  onPlaying={watch.observe}
                  onPause={watch.flush}
                  onEnded={watch.flush}
                  onSeeking={watch.reset}
                  onSeeked={watch.seeked}
                  onRateChange={watch.reset}
                  onWaiting={watch.reset}
                />
              ) : (
                <p role="status">Video açılıyor…</p>
              )}
              <VideoProgressPanel
                progress={
                  watch.progress?.video_id === videoId ? watch.progress : null
                }
                currentMs={currentMs}
                saving={watch.saving || watch.pending}
                error={watch.error}
                onRetry={watch.retry}
                onResume={(ms) => {
                  if (player.current) {
                    player.current.currentTime = ms / 1000;
                    setCurrentMs(ms);
                  }
                }}
              />
            </div>
          )}
          {tab === "metin" && source && (
            <details
              className="source-transcript"
              open
            >
              <summary>
                {videoId ? "Transkript" : "Çıkarılan kaynak metni"} ·{" "}
                {locationLabel(source.location)}
              </summary>
              <p
                onMouseUp={() => {
                  if (selected?.kind === "TXT") return;
                  const text = window.getSelection()?.toString().trim();
                  if (
                    !text ||
                    text.length > 1500 ||
                    !source.text.includes(text)
                  )
                    return;
                  const location = source.location;
                  setViewport((v) => ({
                    ...v,
                    ...(videoId
                      ? {
                          kind: "video",
                          timestamp_ms: Math.round(
                            (player.current?.currentTime || 0) * 1000,
                          ),
                        }
                      : location.kind === "page"
                        ? { kind: "page", page: location.page }
                        : { kind: "slide", slide: location.slide }),
                    selected_text: text,
                  }));
                }}
              >
                {source.text}
              </p>
              {selected?.kind !== "TXT" && (
                <p className="viewer-note">
                  Bu metinden bir ifade seçerek soruna bağlayabilirsin.
                  {viewport?.selected_text && (
                    <>
                      {" "}
                      Seçili: “{viewport.selected_text.slice(0, 90)}”{" "}
                      <button
                        className="product-link"
                        onClick={() =>
                          setViewport((v) => ({
                            ...v,
                            selected_text: undefined,
                          }))
                        }
                      >
                        Metin seçimini temizle
                      </button>
                    </>
                  )}
                </p>
              )}
            </details>
          )}
          {tab === "bolumler" && selected && selected.status === "READY" && (
            <MaterialFind
              courseId={courseId}
              material={selected}
              labelOf={locationLabel}
              onOpenSource={(src) =>
                openEvidence({ material_id: selected.id, id: src.id })
              }
            />
          )}
          {tab === "ozet" && selected && selected.status === "READY" && (
            <MaterialSummary
              courseId={courseId}
              material={selected}
              labelOf={locationLabel}
              onOpenSource={(src) =>
                openEvidence({ material_id: selected.id, id: src.id })
              }
            />
          )}
          {tab === "bolumler" && segments.length > 1 && (
            <details className="source-sections" open>
              <summary>
                Kaynak bölümleri <span>{segments.length}</span>
              </summary>
              <div>
                {segments.map((s) => (
                  <button
                    key={s.id}
                    className={s.id === source?.id ? "active" : ""}
                    onClick={() => chooseSegment(s)}
                  >
                    <span className="source-badge">
                      {locationLabel(s.location)}
                    </span>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          {selected && (
            <details className="viewer-more">
            <summary aria-label="Diğer işlemler">⋯ İşlemler</summary>
            <footer className="viewer-actions">
              {selected.can_manage && (
                <button
                  className="product-link"
                  onClick={() => setRenaming(selected)}
                >
                  Yeniden adlandır
                </button>
              )}
              {selected.retryable && (
                <button
                  className="product-link"
                  disabled={uploading}
                  onClick={async () => {
                    setUploading(true);
                    try {
                      if (selected.kind === "PDF")
                        await api.retry(selected.source_id);
                      else await api.retryVideo(courseId, selected.source_id);
                      await refresh();
                    } catch (e) {
                      setError(videoErrorText(e));
                    } finally {
                      setUploading(false);
                    }
                  }}
                >
                  İşlemeyi yeniden dene
                </button>
              )}
              {["PPTX", "TXT", "PDF"].includes(selected.kind) && (
                <button
                  className="product-link"
                  onClick={async () => {
                    try {
                      const blob =
                        selected.kind === "PDF"
                          ? await api.file(selected.source_id)
                          : await api.knowledgeFile(courseId, selected.id);
                      const u = URL.createObjectURL(blob),
                        a = document.createElement("a");
                      a.href = u;
                      a.download = selected.filename || selected.title;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(u), 60000);
                    } catch (e) {
                      setError(videoErrorText(e));
                    }
                  }}
                >
                  Özgün dosyayı indir
                </button>
              )}
              {selected.can_manage !== false &&
                (confirmDelete ? (
                  <>
                    <p>
                      Materyal, kaynakları ve bunlara bağlı yanıt içerikleri
                      kalıcı olarak kaldırılsın mı?
                    </p>
                    <button
                      disabled={uploading}
                      className="product-link"
                      onClick={remove}
                    >
                      Kalıcı olarak kaldır
                    </button>
                    <button onClick={() => setConfirmDelete(false)}>
                      Vazgeç
                    </button>
                  </>
                ) : (
                  <button
                    className="product-link"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Materyali kaldır
                  </button>
                ))}
            </footer>
            </details>
          )}
        </section>
        {assistantOpen && (
          <section
            className="learning-assistant"
            aria-label="Ortak öğrenme asistanı"
          >
            <header>
              <div>
                <span className="product-eyebrow">K-NOT öğretici asistan</span>
                <h2>Birlikte anlayalım.</h2>
              </div>
              <button
                className="product-link"
                onClick={newChat}
                disabled={busy || chatLoading}
              >
                + Yeni konuşma
              </button>
            </header>
            <label className="chat-history-label">
              Konuşma geçmişi
              <select
                aria-label="Konuşma geçmişi"
                value={chatId || ""}
                disabled={busy || chatLoading}
                onChange={(e) =>
                  e.target.value ? openChat(e.target.value) : newChat()
                }
              >
                <option value="">Yeni konuşma</option>
                {chats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="chat-messages scroll-quiet"
              ref={chatScroll}
              aria-live="polite"
            >
              {chatLoading && <p role="status">Konuşma açılıyor…</p>}
              {!turns.length && !chatLoading && (
                <div className="assistant-welcome">
                  <span className="assistant-symbol" aria-hidden>
                    ✳
                  </span>
                  <h3>Okurken aklına takılanı sor.</h3>
                  <p>
                    Seçili materyali, sayfayı veya video anını soruna
                    bağlayabilirim. Yanıtın kaynağına tek tıkla dönebilirsin.
                  </p>
                  <div>
                    {[
                      "Bu bölümü adım adım açıkla",
                      "Bir örnek göster",
                      "Kaynakları karşılaştır",
                    ].map((q) => (
                      <button key={q} onClick={() => setQuestion(q)}>
                        {q} ↗
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((t, i) => {
                const evidence = t.evidence || [],
                  used = t.retrieval?.used_source_ids || [],
                  primary = evidence.filter((e) => used.includes(e.id)),
                  shown = (primary.length ? primary : evidence).slice(0, 2),
                  rest = evidence.filter(
                    (e) => !shown.some((s) => s.id === e.id),
                  );
                return (
                  <article
                    key={i}
                    className="chat-turn"
                    aria-label={`Ders yanıtı ${i + 1}`}
                  >
                    <div className="user-message">
                      <span>Sen</span>
                      <p>{t.question || "Önceki soru"}</p>
                    </div>
                    <div className="assistant-message" data-tone={stampFor(t)?.tone || "none"}>
                      <div className="message-head">
                      <span className="message-author">✳ K-NOT</span>
                      {stampFor(t) && (
                        <span className="catalog-stamp" data-tone={stampFor(t).tone}>{stampFor(t).text}</span>
                      )}
                      </div>
                      {modeLabel(t.response_mode) && (
                        <span className="answer-mode" data-mode={t.response_mode}>
                          {modeLabel(t.response_mode)}
                        </span>
                      )}
                      <div className="message-tools">
                        <Voice key={`voice-${i}`} text={t.answer || ""} autoPlay={t === freshAnswer} />
                        {hasSteps(t) && (
                          <button
                            className="product-link"
                            aria-pressed={boardTurn === t}
                            onClick={() => setBoardTurn(t)}
                          >
                            Tahtada anlat
                          </button>
                        )}
                        <button
                          className="product-link"
                          onClick={() =>
                            navigator.clipboard
                              .writeText(t.answer || "")
                              .catch(() => setError("Yanıt kopyalanamadı."))
                          }
                        >
                          Kopyala
                        </button>
                      </div>
                      {isExcerpt(t) ? (
                        <QuoteBlock
                          text={t.answer}
                          label={"KAYNAKTAN ALINTI" + ((primary[0] || evidence[0]) ? " · " + locationLabel((primary[0] || evidence[0]).location) : "")}
                        />
                      ) : (
                        <RichText className="answer-text" text={t.answer} />
                      )}
                      <ClaimSupport claims={t.claims} />
                      {t.visual_analysis?.status === "IMAGE_PROVIDED" && (
                        <p className="product-note">
                          Özgün kaynak görüntüsü yerel modele gönderildi ·
                          Görsel yorum doğrulanmadı
                          {t.visual_analysis.region ? " · Seçili bölge" : ""}
                        </p>
                      )}
                      <p className="answer-status">{statusLabel(t)}</p>
                      {t.generation_detail && (
                        <p className="answer-status-detail">
                          Ayrıntı: <code>{t.generation_detail}</code>
                        </p>
                      )}
                      {(t.video_learning || []).map((l) => {
                        const e = evidence.find((e) => e.id === l.source_id);
                        return (
                          <p key={l.source_id} className="viewer-note">
                            {e ? locationLabel(e.location) + " · " : ""}
                            {watchLabel[l.state]}
                          </p>
                        );
                      })}
                      {t.status === "GUIDANCE" && (
                        <Btn disabled={busy} onClick={() => ask(null, t)}>
                          Şimdi açıkla
                        </Btn>
                      )}
                      {(t.conflicts || []).map((c, n) => (
                        <p key={n} className="product-note">
                          Olası kaynak uyuşmazlığı · kesinleştirilmedi.{" "}
                          {c.message}
                        </p>
                      ))}
                      {evidence.length > 0 && (
                        <div
                          className="answer-sources"
                          aria-label="Ortak yanıt kaynakları"
                        >
                          <p className="product-eyebrow">
                            {primary.length
                              ? "Yanıtta kullanılan kaynaklar"
                              : "Bulunan kaynaklar"}
                          </p>
                          {shown.map(sourceButton)}
                          {rest.length > 0 && (
                            <details>
                              <summary>{rest.length} diğer kaynak</summary>
                              {rest.map(sourceButton)}
                            </details>
                          )}
                          {t.retrieval && (
                            <details className="retrieval-detail">
                              <summary>Arama kapsamı</summary>
                              <p>
                                {t.retrieval.searched.length} hazır materyalde
                                arandı · {evidence.length} kaynak bulundu ·{" "}
                                {used.length} kaynak modelin doğrulanabilen
                                atıflarında kullanıldı.
                              </p>
                              {t.retrieval.searched.map((m) => (
                                <p key={m.id}>
                                  {m.kind} · {m.title}
                                </p>
                              ))}
                            </details>
                          )}
                        </div>
                      )}
                      {evidence.length > 0 && (
                        <div className="followup-actions">
                          <button
                            disabled={busy}
                            onClick={() => ask(null, t, "detailed")}
                          >
                            Ayrıntılı açıkla
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => ask(null, t, "short")}
                          >
                            Kısaca açıkla
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => ask(null, t, "example")}
                          >
                            Örnek göster
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => ask(null, t, "step_by_step")}
                          >
                            Adım adım
                          </button>
                          <button
                            onClick={() =>
                              navigate(`/dersler/${courseId}/quiz`, {
                                topic: t.question,
                                ...(selected ? { materialId: selected.id, materialTitle: selected.title } : {}),
                              })
                            }
                          >
                            Alıştırma yap ↗
                          </button>
                        </div>
                      )}
                      {t.note && (
                        <details className="answer-note">
                          <summary>Yanıt hakkında</summary>
                          <p>{t.note}</p>
                        </details>
                      )}
                    </div>
                  </article>
                );
              })}
              {busy && (
                <p role="status" className="assistant-thinking">
                  Kaynaklar inceleniyor…
                </p>
              )}
            </div>
            <form onSubmit={ask} className="chat-composer">
              {retryRequest && (
                <button
                  type="button"
                  disabled={busy}
                  className="product-link"
                  onClick={() => ask(null, null, "default", retryRequest)}
                >
                  Son soruyu yeniden dene
                </button>
              )}
              <label htmlFor="unified-question" className="sr-only">
                Ders kaynaklarına sorun
              </label>
              <textarea
                id="unified-question"
                value={question}
                maxLength={2000}
                rows={3}
                onChange={(e) => setQuestion(e.target.value)}
                aria-describedby="composer-hint"
                onKeyDown={(e) => {
                  if (!isSubmitKey(e)) return;
                  e.preventDefault();
                  if (canSend) void ask(e);
                }}
                placeholder={
                  selected
                    ? `${selected.kind === "VIDEO" ? "Bu anda" : "Bu bölümde"} anlamadığın ne var?`
                    : "Dersin hakkında bir soru sor…"
                }
              />
              <small id="composer-hint" className="composer-hint">
                Enter gönderir · Shift+Enter yeni satır
              </small>
              <div>
                <span>
                  {selected
                    ? "Bağlam: " +
                      selected.title +
                      (viewport?.page
                        ? " · Sayfa " + viewport.page
                        : viewport?.slide
                          ? " · Slayt " + viewport.slide
                          : videoId
                            ? " · " + videoTime(currentMs / 1000)
                            : "") +
                      (viewport?.region ? " · Bölge seçili" : "")
                    : "Dersin hazır kaynakları"}
                </span>
                <Btn type="submit" disabled={!canSend}>
                  {busy ? "İnceleniyor…" : "Gönder ↑"}
                </Btn>
              </div>
            </form>
          </section>
        )}
      </div>
      {renaming && (
        <MaterialRename
          courseId={courseId}
          material={renaming}
          onClose={() => setRenaming(null)}
          onSaved={(m) => {
            setSelected((s) => (s?.id === m.id ? { ...s, title: m.title } : s));
            setRenaming(null);
            void refresh();
          }}
        />
      )}
    </PageFrame>
  );
}
