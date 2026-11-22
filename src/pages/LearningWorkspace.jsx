import Voice from "../components/Voice";
import { loadLocalVoice } from "../lib/local-voice";
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
import MaterialLinks from "../components/MaterialLinks";
import SelfCheck from "../components/SelfCheck";
import { ClipboardText } from "@phosphor-icons/react";
import WorkspaceStart from "../components/WorkspaceStart";
import RichText from "../components/RichText";
import MarkedText from "../components/MarkedText";
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
function CopyButton({ text, onError }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="tool-btn"
      aria-label={done ? "Kopyalandı" : "Yanıtı kopyala"}
      title={done ? "Kopyalandı" : "Kopyala"}
      onClick={() =>
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          })
          .catch(onError)
      }
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden focusable="false">
        {done ? (
          <path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.5 3.5v-.2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </>
        )}
      </svg>
    </button>
  );
}

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

// Öneri düğmesi etiketi tek başına soru olmaz: arama bir konu ister. Açık materyalin adı (ve sayfa) soruya eklenir.
function suggestionQuestions(selected, viewport) {
  const title = (selected?.title || "").replace(/\.[a-z0-9]{2,4}$/i, "").trim();
  const page = viewport?.page ?? viewport?.location?.page;
  const where = title ? `${title}${page ? `, sayfa ${page}` : ""}` : "";
  const about = where ? ` (${where})` : "";
  return [
    { label: "Bu bölümü adım adım açıkla", text: `Bu bölümü adım adım açıkla${about}` },
    { label: "Bir örnek göster", text: `Bu bölümdeki konu için bir örnek göster${about}` },
    { label: "Kaynakları karşılaştır", text: `Bu konu hakkında kaynakları karşılaştır${about}` },
  ];
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
    [selfCheckOpen, setSelfCheckOpen] = useState(false),
    [materialFilter, setMaterialFilter] = useState("");
  const selfCheckButton = useRef(null);
  useEffect(() => {
    if (selfCheckOpen) document.querySelector("#self-check-panel textarea")?.focus();
  }, [selfCheckOpen]);
  const [uploadMode, setUploadMode] = useState("document"),
    [link, setLink] = useState(""),
    [linkBusy, setLinkBusy] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [retryRequest, setRetryRequest] = useState(null);
  // Tahtada anlatılan cevap (steps taşıyorsa); yoksa çalışma alanı eskisi gibi.
  const [boardTurn, setBoardTurn] = useState(null);
  // Orta alanda tahta mı yazılı anlatım mı görünsün (öğrenci istediği an yazılı metne dönebilir).
  const [textView, setTextView] = useState(false);
  useEffect(() => {
    if (boardTurn) setTextView(false);
  }, [boardTurn]);
  const boardVisible = !!boardTurn && !textView;
  // Yerel ses kuruluysa tahtadaki hoca anlatır; o yanıt sohbette ayrıca otomatik okunmaz (iki ses üst üste binmez).
  const [boardSpeaks, setBoardSpeaks] = useState(false);
  useEffect(() => {
    let alive = true;
    loadLocalVoice().then((s) => {
      if (alive) setBoardSpeaks(s.available);
    });
    return () => {
      alive = false;
    };
  }, []);
  const viewerTop = useRef(null);
  useEffect(() => {
    const close = (e) => {
      document.querySelectorAll(".viewer-more[open], .voice-settings[open]").forEach((d) => {
        if (!d.contains(e.target)) d.removeAttribute("open");
      });
    };
    const esc = (e) => {
      if (e.key === "Escape") document.querySelectorAll(".viewer-more[open], .voice-settings[open]").forEach((d) => d.removeAttribute("open"));
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  // Başlıkta, o an ekranda görünen cevabın sorusu ve araçları durur.
  const [activeTurn, setActiveTurn] = useState(0);
  const [toolbarEl, setToolbarEl] = useState(null);
  const autoSpoken = useRef(new Set());
  useEffect(() => {
    setActiveTurn(Math.max(0, turns.length - 1));
  }, [turns.length]);
  function onChatScroll(e) {
    const box = e.currentTarget;
    const line = box.getBoundingClientRect().top + 48;
    let idx = 0;
    box.querySelectorAll(".chat-turn").forEach((a, i) => {
      if (a.getBoundingClientRect().top <= line) idx = i;
    });
    setActiveTurn((cur) => (cur === idx ? cur : idx));
  }
  const centerRef = useRef(null), sideRef = useRef(null), askRef = useRef(null);
  const [railOpen, setRailOpen] = useState(() => {
    try { return localStorage.getItem("knot-ws-rail") !== "0"; } catch { return true; }
  });
  function toggleRail() {
    setRailOpen((v) => {
      try { localStorage.setItem("knot-ws-rail", v ? "0" : "1"); } catch { /* yok say */ }
      return !v;
    });
  }
  const readLS = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } };
  const [cols, setCols] = useState(() => { const v = readLS("knot-ws-cols"); return v && v.c > 0 && v.s > 0 ? v : null; });
  const [askH, setAskH] = useState(() => { const v = readLS("knot-ws-ask"); return v > 0 ? v : null; });
  function resizeCols(next) {
    setCols(next);
    writeLS("knot-ws-cols", next);
  }
  function dragCols(e) {
    if (!centerRef.current || !sideRef.current) return;
    e.preventDefault();
    const c0 = centerRef.current.getBoundingClientRect().width, s0 = sideRef.current.getBoundingClientRect().width, x0 = e.clientX;
    const total = c0 + s0, min = 300;
    let latest = null;
    const move = (ev) => {
      const c = Math.min(total - min, Math.max(min, c0 + ev.clientX - x0));
      latest = { c, s: total - c };
      setCols(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest) writeLS("knot-ws-cols", latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function keyCols(e) {
    const d = e.key === "ArrowLeft" ? -32 : e.key === "ArrowRight" ? 32 : 0;
    if (!d || !centerRef.current || !sideRef.current) return;
    e.preventDefault();
    const c0 = centerRef.current.getBoundingClientRect().width, s0 = sideRef.current.getBoundingClientRect().width;
    const total = c0 + s0, c = Math.min(total - 300, Math.max(300, c0 + d));
    resizeCols({ c, s: total - c });
  }
  function dragAsk(e) {
    if (!askRef.current) return;
    e.preventDefault();
    const h0 = askRef.current.getBoundingClientRect().height, y0 = e.clientY;
    let latest = null;
    const move = (ev) => {
      latest = Math.round(Math.min(520, Math.max(120, h0 - (ev.clientY - y0))));
      setAskH(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest) writeLS("knot-ws-ask", latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
  function keyAsk(e) {
    const d = e.key === "ArrowUp" ? 32 : e.key === "ArrowDown" ? -32 : 0;
    if (!d || !askRef.current) return;
    e.preventDefault();
    const h = Math.round(Math.min(520, Math.max(120, askRef.current.getBoundingClientRect().height + d)));
    setAskH(h);
    writeLS("knot-ws-ask", h);
  }
  function resetSizes() {
    setCols(null);
    setAskH(null);
    try { localStorage.removeItem("knot-ws-cols"); localStorage.removeItem("knot-ws-ask"); } catch { /* yok say */ }
  }

  // En son tahtada anlatılabilen cevap ("Tahtada göster" düğmesi bunu açar).
  const lastBoardable = [...turns].reverse().find((t) => hasSteps(t)) || null;
  const shownTurn = boardVisible ? boardTurn : turns[Math.min(activeTurn, turns.length - 1)] || null;
  function showOnBoard() {
    const target = shownTurn && hasSteps(shownTurn) ? shownTurn : boardTurn || lastBoardable;
    if (!target) return;
    setBoardTurn(target);
    setTextView(false);
  }
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
  // Opening a page/video from a similar-explanation link changes only what is shown. The
  // conversation, references and scope stay as they are; the student is told and can go back.
  const [linkNotice, setLinkNotice] = useState(null);
  useEffect(() => {
    setLinkNotice((n) => (n && n.openedId === selected?.id ? n : null));
  }, [selected?.id]);
  // A newly shown material opens on its page; a source opened from a question for a material without a page
  // view (a text file) asks for its text instead, because that is where the sentence is marked.
  const nextTab = useRef(null);
  useEffect(() => {
    setTab(nextTab.current ?? "sayfa");
    nextTab.current = null;
  }, [selected?.id]);
  // The sentence a question rests on, opened from "İlgili kaynağı aç": marked on the page and in the text.
  const [highlight, setHighlight] = useState(null);
  // The question the source was opened from ("/dersler/c/sinavlar?exam=…&mode=solve&q=2"), for "← Soruya dön".
  const [returnTo, setReturnTo] = useState(null);
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
    if (next.openSource) void openEvidence(next.openSource, next.returnTo);
    else if (next.openPage?.materialId) {
      const m = materials.find((m) => m.id === next.openPage.materialId);
      if (m) void select(m, { page: next.openPage.page });
    }
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
    setHighlight(null);
    previewRequest.current?.abort();
    const abort = new AbortController();
    previewRequest.current = abort;
    if (selected?.id !== material.id) {
      setUrl(null);
      initialSeek.current = false;
      // Set here, not in an effect on the selection: an effect could run after openEvidence switched to
      // "metin" (when the preview arrives before React renders the selection) and undo it.
      setTab("sayfa");
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
      // `target.page`: Kapsam haritasından gelen sayfa (segment kimliği yok); o sayfanın ilk parçası açılır.
      const actual = target
        ? target.id
          ? result.segments.find((s) => s.id === target.id)
          : result.segments.find((s) => (s.location?.page ?? s.location?.slide) === target.page)
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
  async function openEvidence(e, from = null) {
    // Only a quiz or exam page of this app is a place to return to.
    if (typeof from === "string" && /^\/(dersler\/[^/?#]+\/(quiz|sinavlar)|quiz)(\?|$)/.test(from)) setReturnTo(from);
    try {
      const actual = await api.knowledgeSource(courseId, e.material_id, e.id);
      const material = materials.find((m) => m.id === e.material_id);
      if (!material) throw new Error("Material missing");
      nextTab.current = e.quote && !["PDF", "PPTX", "VIDEO"].includes(material.kind) ? "metin" : null;
      await select(material, actual);
      if (e.quote) {
        const loc = actual?.location || {};
        setHighlight({ materialId: material.id, segmentId: actual?.id ?? e.id, quote: e.quote, page: loc.page || loc.slide || null });
        // A material without a page view (text file, document) shows the marked sentence in its text.
        if (!["PDF", "PPTX", "VIDEO"].includes(material.kind)) setTab("metin");
      }
    } catch {
      setError(
        "Bu kaynak kaldırılmış veya güncellenmiş olabilir. Soruyu yeniden gönder.",
      );
      await refresh();
    }
  }
  const readTime = useCallback(
    () => Math.round((player.current?.currentTime || 0) * 1000),
    [],
  );
  async function openLink(link) {
    const material = materials.find((m) => m.id === link.material_id);
    if (!material) {
      setError("Bu kaynak kaldırılmış olabilir. Sayfayı yenileyip yeniden dene.");
      return;
    }
    const from = selected;
    const fromSource = source;
    await select(material, { id: link.source_id, location: link.location });
    setTab("sayfa");
    setLinkNotice({
      openedId: material.id,
      text: `${material.title} açıldı`,
      back: from
        ? {
            label: from.kind === "VIDEO" ? "Videoya dön" : "Belgeye dön",
            go: () => select(from, from.kind === "VIDEO" ? undefined : fromSource ? { id: fromSource.id, location: fromSource.location } : undefined),
          }
        : null,
    });
  }
  const readyOf = (kinds) => materials.some((m) => m.status === "READY" && kinds.includes(m.kind));
  const hasReadyVideo = readyOf(["VIDEO"]);
  const hasReadyDocument = readyOf(["PDF", "PPTX"]);
  const shownPage = viewport?.kind === "page" ? viewport.page : viewport?.kind === "slide" ? viewport.slide : null;
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
  // Birden çok dosya seçilirse sırayla yüklenir; her biri ayrı iş olarak kuyruğa girer.
  async function uploadMany(files) {
    for (const file of files) await upload(file);
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
  const hasReadyMaterial = materials.some((m) => m.status === "READY");
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
          {returnTo ? (
            // Opened from a question ("İlgili kaynağı aç"): back to that question, with its answer.
            // The intent tells the page it is a way back: if the address lost the set or exam, the tab's
            // record of the last one open is used, also when every question is already answered.
            <button className="product-link" onClick={() => navigate(returnTo, { returnToQuestion: true })}>
              ← Soruya dön
            </button>
          ) : (
            <button className="product-link" onClick={() => navigate("/dersler")}>
              ← Derslerin
            </button>
          )}
          <h1>{course?.name || "Ders çalışma alanı"}</h1>
          {hasReadyMaterial && <span className="title-note" aria-hidden>masan hazır</span>}
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
          <button className="product-link" onClick={() => navigate(`/dersler/${courseId}`)}>
            Kapsam haritası ↗
          </button>
          <button
            type="button"
            className="workspace-toggle self-check-open"
            aria-expanded={selfCheckOpen}
            aria-controls="self-check-panel"
            ref={selfCheckButton}
            onClick={() => setSelfCheckOpen((v) => !v)}
          >
            <ClipboardText size={14} weight="bold" aria-hidden="true" />
            Beni kontrol et
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
      {/* Metin, panel kapalıyken de korunur (bileşen takılı kalır, yalnızca gizlenir). */}
      <section
        id="self-check-panel"
        className="self-check-panel"
        aria-label="Beni kontrol et"
        hidden={!selfCheckOpen}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setSelfCheckOpen(false);
            selfCheckButton.current?.focus();
          }
        }}
      >
        <div className="self-check-head">
          <h2>Beni kontrol et</h2>
          <button type="button" className="product-link" onClick={() => { setSelfCheckOpen(false); selfCheckButton.current?.focus(); }}>
            Kapat
          </button>
        </div>
        <p className="product-note">
          Konuyu kendi cümlelerinle yaz. Her iddia ders materyallerinle karşılaştırılır; puan verilmez.
        </p>
        <SelfCheck
          courseId={courseId}
          onOpenSource={(e) => {
            // Metin ve sonuç korunur; panel kapanır ki açılan kaynak görünsün.
            setSelfCheckOpen(false);
            return openEvidence(e);
          }}
        />
      </section>
      {error && (
        <p role="alert" className="product-error workspace-error">
          {error}
        </p>
      )}
      <div
        className={`workspace-grid ${assistantOpen ? "" : "assistant-closed"} ${railOpen ? "" : "rail-collapsed"}`}
        style={{
          ...(cols && assistantOpen ? { "--col-center": `${cols.c}fr`, "--col-side": `${cols.s}fr` } : {}),
          ...(railOpen ? {} : { "--rail-w": "46px" }),
        }}
      >
        <aside className="material-rail" aria-label="Ortak ders materyalleri" data-collapsed={railOpen ? undefined : "true"}>
          {!railOpen ? (
            <button type="button" className="rail-expand" onClick={toggleRail} aria-expanded="false" title="Kaynakları aç">
              <span aria-hidden>›</span>
              <span className="rail-expand-label">Kaynaklar · {materials.length}</span>
            </button>
          ) : (
          <>
          <div className="section-heading">
            <h2>Kaynaklar</h2>
            <span>{materials.length}</span>
            <button type="button" className="rail-collapse" onClick={toggleRail} aria-expanded="true" title="Kaynakları kapat" aria-label="Kaynakları kapat">
              ‹
            </button>
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
                multiple={uploadMode !== "video"}
                aria-label="Ortak ders materyali seç"
                accept={
                  uploadMode === "video" ? ".mp4,.webm" : ".pdf,.pptx,.txt"
                }
                onChange={(e) => {
                  void uploadMany(Array.from(e.target.files || []));
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
          </>
          )}
        </aside>
        {assistantOpen && (
          <section
            ref={centerRef}
            className="learning-assistant"
            aria-label="Ortak öğrenme asistanı"
          >
            <header>
              <div className="assistant-top">
                <span className="product-eyebrow">K-NOT öğretici asistan</span>
                <div className="assistant-actions">
                  {boardVisible ? (
                    <button className="board-show" data-variant="text" onClick={() => setTextView(true)}>
                      Yazılı metne dön
                    </button>
                  ) : (
                    <button
                      className="board-show"
                      disabled={!(boardTurn || lastBoardable)}
                      title={boardTurn || lastBoardable ? "Cevabı tahtada anlat" : "Tahtada anlatılabilir bir cevap yok"}
                      onClick={showOnBoard}
                    >
                      Tahtada göster
                    </button>
                  )}
                </div>
              </div>
              {boardVisible && <div key="board-tools" className="assistant-tools board-tools" ref={setToolbarEl} />}
              {!boardVisible && shownTurn && (
                <div key="voice-tools" className="assistant-tools">
                  <Voice
                    key={`voice-${turns.indexOf(shownTurn)}`}
                    text={shownTurn.answer || ""}
                    autoPlay={shownTurn === freshAnswer && !autoSpoken.current.has(shownTurn) && !(boardSpeaks && hasSteps(shownTurn))}
                    onAutoPlay={() => autoSpoken.current.add(shownTurn)}
                  />
                  <CopyButton text={shownTurn.answer || ""} onError={() => setError("Yanıt kopyalanamadı.")} />
                </div>
              )}
              {shownTurn && (
                <div className="active-question" key={`q-${turns.indexOf(shownTurn)}`} title={shownTurn.question || "Önceki soru"}>
                  <span>SEN</span>
                  <p>{shownTurn.question || "Önceki soru"}</p>
                </div>
              )}
            </header>
            {boardVisible && (
              <section className="workspace-board center-board" aria-label="Tahtada anlatım">
                <div className="workspace-board-head">
                  <div>
                    <span className="product-eyebrow">Tahtada anlatım</span>
                    <p>{boardTurn.question || "Önceki soru"}</p>
                  </div>
                </div>
                <StepBoard
                  steps={boardTurn.steps}
                  evidence={boardTurn.evidence || []}
                  onSource={openBoardSource}
                  toolbarTarget={toolbarEl}
                />
              </section>
            )}
            <div
              className="chat-messages scroll-quiet"
              hidden={boardVisible}
              onScroll={onChatScroll}
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
                    {suggestionQuestions(selected, viewport).map(({ label, text }) => (
                      <button
                        key={label}
                        disabled={!hasReadyMaterial}
                        title={hasReadyMaterial ? undefined : "Önce bir materyal ekle"}
                        onClick={() => setQuestion(text)}
                      >
                        {label} ↗
                      </button>
                    ))}
                    {!hasReadyMaterial && <small>Önce bir materyal ekle.</small>}
                  </div>
                </div>
              )}
              {turns.map((t, i) => {
                const evidence = t.evidence || [],
                  used = t.retrieval?.used_source_ids || [],
                  // Metinde [n] ile anılan kaynaklar da "kullanılan" sayılır (model atıfı doğrulanamasa bile).
                  citedNumbers = new Set(
                    [...String(t.answer || "").matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])),
                  ),
                  primary = evidence.filter(
                    (e) => used.includes(e.id) || citedNumbers.has(Number(e.n)),
                  ),
                  shown = primary.length ? primary : evidence,
                  rest = evidence.filter(
                    (e) => !shown.some((s) => s.id === e.id),
                  );
                return (
                  <article
                    key={i}
                    className="chat-turn"
                    data-last={i === turns.length - 1 ? "true" : undefined}
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
                      {isExcerpt(t) ? (
                        <QuoteBlock
                          text={t.answer}
                          label={"KAYNAKTAN ALINTI" + ((primary[0] || evidence[0]) ? " · " + locationLabel((primary[0] || evidence[0]).location) : "")}
                        />
                      ) : (
                        <RichText
                          className="answer-text"
                          text={t.answer}
                          onCite={(n) => {
                            const e = evidence.find((x) => Number(x.n) === n);
                            if (e) void openEvidence(e);
                          }}
                        />
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
          </section>
        )}
        {assistantOpen && (
          <div
            className="col-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Anlatım ve kaynak genişliğini ayarla"
            tabIndex={0}
            title="Sürükle · çift tıkla sıfırla"
            onPointerDown={dragCols}
            onKeyDown={keyCols}
            onDoubleClick={resetSizes}
          />
        )}
        <div className="workspace-side" ref={sideRef}>
        <section
          className="material-viewer"
          data-kind={selected?.kind}
          aria-label="Ortak materyal görüntüleyici"
        >
          <div className="viewer-top">
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
          {selected && (
            <details className="viewer-more">
            <summary aria-label="Diğer işlemler" title="Diğer işlemler">⋮</summary>
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
          </div>
          <div className="viewer-body">
          <div ref={viewerTop} />
          {linkNotice && (
            <p role="status" className="material-links-notice">
              <span>{linkNotice.text}</span>
              {linkNotice.back && (
                <>
                  {" · "}
                  <button
                    type="button"
                    className="product-link"
                    onClick={() => {
                      const back = linkNotice.back;
                      setLinkNotice(null);
                      void back.go();
                    }}
                  >
                    {linkNotice.back.label}
                  </button>
                </>
              )}
              <button type="button" className="product-link" aria-label="Bildirimi kapat" onClick={() => setLinkNotice(null)}>
                ×
              </button>
            </p>
          )}
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
                tools={
                  hasReadyVideo && shownPage ? (
                    <MaterialLinks
                      mode="video"
                      courseId={courseId}
                      materialId={selected.id}
                      page={shownPage}
                      onOpen={openLink}
                    />
                  ) : null
                }
                highlight={highlight?.materialId === selected.id && highlight.page ? { page: highlight.page, quote: highlight.quote } : null}
                marks={tab === "sayfa" && selected && (() => {
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
              {hasReadyDocument && url?.id === videoId && (
                <MaterialLinks
                  mode="page"
                  courseId={courseId}
                  materialId={selected.id}
                  getTimeMs={readTime}
                  onOpen={openLink}
                />
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
                <MarkedText
                  text={source.text}
                  quote={highlight?.materialId === selected?.id && highlight.segmentId === source.id ? highlight.quote : null}
                />
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
          </div>
        </section>
          {assistantOpen && (
            <div
              className="row-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Kaynak ve soru alanı yüksekliğini ayarla"
              tabIndex={0}
              title="Sürükle · çift tıkla sıfırla"
              onPointerDown={dragAsk}
              onKeyDown={keyAsk}
              onDoubleClick={resetSizes}
            />
          )}
          {assistantOpen && (
            <section className="ask-panel" ref={askRef} style={askH ? { height: askH } : undefined} aria-label="Soru sor ve konuşma geçmişi">
              <div className="ask-head">
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
                <button className="product-link" onClick={newChat} disabled={busy || chatLoading}>
                  + Yeni konuşma
                </button>
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
              <div className="composer-row">
                <div className="composer-field">
              <textarea
                  id="unified-question"
                  value={question}
                  maxLength={2000}
                  rows={2}
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
                  <button
                  type="submit"
                  className="send-arrow"
                  disabled={!canSend}
                  aria-label={busy ? "İnceleniyor…" : "Gönder"}
                  title={busy ? "İnceleniyor…" : "Gönder (Enter)"}
                >
                  {busy ? (
                    <span aria-hidden>…</span>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                </div>
              </div>
              <div className="composer-meta">
                <small id="composer-hint" className="composer-hint">
                  Enter gönderir · Shift+Enter yeni satır
                </small>
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
              </div>
            </form>
            </section>
          )}
        </div>
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
