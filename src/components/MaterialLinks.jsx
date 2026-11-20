import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FilmStrip, FileText } from "@phosphor-icons/react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";

// "Where was this explained?" Both directions share one panel:
//   mode="video": a page/slide is open -> video moments that sound alike.
//   mode="page":  a video is open      -> pages/slides that match what is being said.
// A match is an ESTIMATE from text similarity, never proof; it is worded and shown that way.
const COPY = {
  video: {
    button: "Videoda anlatılışı",
    region: "Videoda benzer anlatımlar",
    empty: "Bu sayfa için videoda belirgin bir benzer anlatım bulunamadı.",
    open: "Videoda aç",
    Icon: FilmStrip,
  },
  page: {
    button: "Bu anın slaydı",
    region: "Bu ana benzer sayfalar",
    empty: "Bu an için belgelerde belirgin bir benzer sayfa bulunamadı.",
    open: "Sayfayı aç",
    Icon: FileText,
  },
};

export const clock = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const place = (l) => (l.kind === "video" ? clock(l.start_ms) : l.kind === "slide" ? `Slayt ${l.slide}` : `Sayfa ${l.page}`);

export default function MaterialLinks({ mode, courseId, materialId, page, getTimeMs, onOpen }) {
  const copy = COPY[mode];
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: "idle" });
  const button = useRef(null);
  const root = useRef(null);
  const panel = useRef(null);
  const regionId = useId();
  const requestKey = useRef(0);

  const load = useCallback(() => {
    const abort = new AbortController();
    const key = ++requestKey.current;
    setState({ status: "loading" });
    const position = mode === "video" ? { page } : { timeMs: getTimeMs?.() ?? 0 };
    api
      .materialLinks(courseId, materialId, position, abort.signal)
      .then((r) => {
        if (key === requestKey.current) setState({ status: "ready", links: (r?.links || []).slice(0, 3), preparing: Boolean(r?.preparing) });
      })
      .catch((e) => {
        if (key === requestKey.current && e?.name !== "AbortError") setState({ status: "error", message: videoErrorText(e) });
      });
    return () => abort.abort();
  }, [mode, courseId, materialId, page, getTimeMs]);

  // Open panel: fetch now, and again if the page changes while it is open.
  useEffect(() => {
    if (!open) return undefined;
    return load();
  }, [open, load]);

  // A different material never inherits the previous panel.
  useEffect(() => {
    setOpen(false);
    setState({ status: "idle" });
  }, [materialId]);

  function close(returnFocus) {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }

  // The panel is placed against the window, not against its (narrow, clipping) toolbar: it opens under the
  // button, never wider than the screen, and never cut off at either edge.
  const [place_, setPlace] = useState(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return undefined;
    }
    const measure = () => {
      const rect = button.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const width = Math.min(352, window.innerWidth - 2 * margin);
      const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
      setPlace({ position: "fixed", top: Math.round(rect.bottom + 6), left: Math.round(left), width, right: "auto" });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      // the panel lives in <body> (see below), so it is "outside" the root element but is not an outside click
      if (root.current && !root.current.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      className="material-links"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="board-control"
        aria-expanded={open}
        aria-controls={open ? regionId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <copy.Icon size={14} weight="bold" aria-hidden="true" />
        {copy.button}
      </button>
      {open && createPortal(
        <div id={regionId} ref={panel} role="region" aria-label={copy.region} className="material-links-panel" style={place_ || undefined}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(true); } }}>
          <p className="material-links-head">Benzer anlatım · tahmini eşleşme</p>
          {state.status === "loading" && (
            <ul className="material-links-list" aria-busy="true" aria-label="Yükleniyor">
              {[0, 1, 2].map((i) => (
                <li key={i} className="material-links-skeleton" aria-hidden="true" />
              ))}
            </ul>
          )}
          {state.status === "error" && (
            <p role="alert" className="material-links-note">
              Eşleşmeler alınamadı. {state.message}{" "}
              <button type="button" className="product-link" onClick={load}>
                Yeniden dene
              </button>
            </p>
          )}
          {state.status === "ready" && state.links.length === 0 && !state.preparing && (
            <p role="status" className="material-links-note">
              {copy.empty}
            </p>
          )}
          {state.status === "ready" && state.preparing && (
            <p role="status" className="material-links-note">
              Videodaki ekran yazısı ilk kez okunuyor; bu birkaç dakika sürebilir.{" "}
              <button type="button" className="product-link" onClick={load}>
                Yeniden dene
              </button>
            </p>
          )}
          {state.status === "ready" && state.links.length > 0 && (
            <ul className="material-links-list">
              {state.links.map((l) => (
                <li key={l.source_id || `${l.material_id}-${place(l.location)}`}>
                  <button
                    type="button"
                    className="material-links-row"
                    onClick={() => {
                      setOpen(false);
                      onOpen(l);
                    }}
                  >
                    <span className="material-links-title" title={l.title}>
                      {l.title}
                    </span>
                    <span className="material-links-place">{place(l.location)}</span>
                    <span className="material-links-basis">
                      {l.basis === "screen" ? "Ekranda benzer yazı" : "Benzer konuşma"}
                    </span>
                    {(l.shared_terms || []).length > 0 && (
                      <span className="material-links-terms" aria-label="Ortak terimler">
                        {l.shared_terms.map((t) => (
                          <span key={t} className="board-badge">
                            {t}
                          </span>
                        ))}
                      </span>
                    )}
                    <span className="material-links-open">{copy.open} →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
