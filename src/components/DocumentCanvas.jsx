import { useEffect, useRef, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";
import { highlightBoxes } from "../lib/quote-match";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

/**
 * `highlight` ({ page, quote }): the sentence a question rests on. On that page the page's text layer (word
 * boxes from the server) is matched with the quote and the words are marked like a highlighter; the view
 * scrolls to them. When the page image cannot be shown the extracted text is opened instead (onShowText),
 * where the same sentence is marked.
 */
export default function DocumentCanvas({
  onShowText,
  courseId,
  material,
  source,
  segments,
  onSource,
  onViewportChange,
  marks,
  tools,
  highlight = null,
}) {
  const [page, setPage] = useState(
      () => source?.location.page || source?.location.slide || 1,
    ),
    [zoom, setZoom] = useState(100),
    [url, setUrl] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [region, setRegion] = useState(null),
    [selecting, setSelecting] = useState(false),
    [drag, setDrag] = useState(null),
    // The marked quote on the page: { page, boxes, exact } or { page, missing: true }.
    [hit, setHit] = useState(null);
  const firstMark = useRef(null);
  const wantsMark = Boolean(highlight?.quote) && highlight.page === page;
  const count =
      material.page_count ||
      Math.max(
        1,
        ...segments.map((s) => s.location.page || s.location.slide || 1),
      ),
    label = material.kind === "PPTX" ? "Slayt" : "Sayfa";
  useEffect(() => {
    onViewportChange?.({
      ...(material.kind === "PPTX"
        ? { kind: "slide", slide: page }
        : { kind: "page", page }),
      ...(region ? { region } : {}),
    });
  }, [page, material.id, material.kind, onViewportChange, region]);
  useEffect(() => {
    const n = source?.location.page || source?.location.slide;
    if (n) {
      setPage(n);
      setRegion(null);
    }
  }, [source?.location.page, source?.location.slide, material.id]);
  useEffect(() => {
    const abort = new AbortController();
    let objectUrl;
    setLoading(true);
    setError("");
    setUrl(null);
    api
      .knowledgeVisual(courseId, material.id, page, abort.signal)
      .then((blob) => {
        if (!abort.signal.aborted) {
          objectUrl = URL.createObjectURL(blob);
          setUrl({ page, value: objectUrl });
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(videoErrorText(e));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courseId, material.id, page]);
  // The page's text layer, once the image is shown, only on the page the quote is on.
  useEffect(() => {
    if (!wantsMark || url?.page !== page) return;
    const abort = new AbortController();
    const quote = highlight.quote;
    Promise.resolve(api.knowledgeVisualText(courseId, material.id, page, abort.signal))
      .then((layer) => {
        if (abort.signal.aborted) return;
        const found = highlightBoxes(layer?.lines, quote);
        setHit(found ? { page, quote, ...found } : { page, quote, missing: true });
      })
      .catch((e) => {
        if (e?.name !== "AbortError" && !abort.signal.aborted) setHit({ page, quote, missing: true });
      });
    return () => abort.abort();
  }, [wantsMark, url?.page, page, courseId, material.id, highlight?.quote]); // eslint-disable-line react-hooks/exhaustive-deps
  // A result is shown only for the page and quote it was made for (no reset needed when either changes).
  const shown = wantsMark && hit?.page === page && hit.quote === highlight.quote ? hit : null;
  useEffect(() => {
    if (shown?.boxes) firstMark.current?.scrollIntoView?.({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [shown]);
  // No page image: the extracted text shows the marked sentence instead.
  useEffect(() => {
    if (error && wantsMark) onShowText?.();
  }, [error, wantsMark]); // eslint-disable-line react-hooks/exhaustive-deps
  function go(n) {
    setRegion(null);
    setDrag(null);
    const next = Math.min(count, Math.max(1, n));
    setPage(next);
    const s = segments.find(
      (s) => (s.location.page || s.location.slide) === next,
    );
    onSource(s || null);
  }
  function point(e) {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  }
  function rectangle(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
  }
  const box = drag ? rectangle(drag.start, drag.end) : region;
  return (
    <section className="document-view" aria-label="Özgün materyal görünümü">
      <div className="document-toolbar">
        <div>
          <button
            aria-label={`Önceki ${label.toLocaleLowerCase("tr")}`}
            onClick={() => go(page - 1)}
            disabled={page <= 1}
          >
            ←
          </button>
          <label>
            {label}
            <input
              aria-label={`${label} numarası`}
              type="number"
              min="1"
              max={count}
              value={page}
              onChange={(e) => go(Number(e.target.value) || 1)}
            />
            <span>/ {count}</span>
          </label>
          <button
            aria-label={`Sonraki ${label.toLocaleLowerCase("tr")}`}
            onClick={() => go(page + 1)}
            disabled={page >= count}
          >
            →
          </button>
        </div>
        {marks}
        <div>
          {tools}
          <button
            onClick={() => setZoom((z) => Math.max(50, z - 25))}
            aria-label="Uzaklaştır"
          >
            −
          </button>
          <span className="font-mono text-xs">%{zoom}</span>
          <button
            onClick={() => setZoom((z) => Math.min(200, z + 25))}
            aria-label="Yakınlaştır"
          >
            +
          </button>
          <button onClick={() => setZoom(100)}>Sığdır</button>
          <button
            aria-pressed={selecting}
            onClick={() => setSelecting((v) => !v)}
          >
            Bölge seç
          </button>
          {region && (
            <button
              onClick={() => {
                setRegion(null);
                setSelecting(false);
              }}
            >
              Bölgeyi temizle
            </button>
          )}
        </div>
      </div>
      <div className="document-canvas">
        {shown?.boxes && (
          <p className="viewer-note" role="status">
            {shown.exact
              ? "Sorunun dayandığı cümle sayfada işaretlendi."
              : "Alıntı birebir bulunamadı; en yakın cümle işaretlendi."}
          </p>
        )}
        {shown?.missing && (
          <p className="viewer-note" role="status">
            Sorunun dayandığı cümle bu sayfanın görüntüsünde işaretlenemedi.{" "}
            {onShowText && (
              <button type="button" className="product-link" onClick={onShowText}>
                Metinde işaretli göster →
              </button>
            )}
          </p>
        )}
        {loading && (
          <div role="status" className="render-skeleton">
            {label} görüntüsü hazırlanıyor…
          </div>
        )}
        {error && (
          <p role="alert" className="product-error">
            Görüntü açılamadı: {error} Özgün dosyayı indirerek de
            inceleyebilirsin.{" "}
            {onShowText && (
              <button type="button" className="product-link" onClick={onShowText}>
                Çıkarılan metni göster →
              </button>
            )}
          </p>
        )}
        {url?.page === page && (
          <div
            className={`image-region-stage ${selecting ? "selecting" : ""}`}
            style={{ width: `${zoom}%` }}
            onPointerDown={(e) => {
              if (!selecting) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              setDrag({ start: p, end: p });
            }}
            onPointerMove={(e) => {
              const p = point(e);
              if (drag) setDrag((d) => ({ ...d, end: p }));
            }}
            onPointerUp={(e) => {
              if (!drag) return;
              const b = rectangle(drag.start, point(e));
              setRegion(b.width >= 0.01 && b.height >= 0.01 ? b : null);
              setDrag(null);
              setSelecting(false);
            }}
          >
            <img
              draggable={false}
              src={url.value}
              alt={`${material.title} · ${label} ${page}`}
              style={{ width: "100%" }}
            />
            {shown?.boxes && (
              <div className="page-text-layer" aria-hidden="true">
                {shown.boxes.map((b, i) => (
                  <span
                    key={i}
                    ref={i === 0 ? firstMark : undefined}
                    className="page-highlight"
                    data-strength={shown.exact ? undefined : "partial"}
                    style={{
                      left: `${b.x * 100}%`,
                      top: `${b.y * 100}%`,
                      width: `${b.width * 100}%`,
                      height: `${b.height * 100}%`,
                    }}
                  />
                ))}
              </div>
            )}
            {box && (
              <span
                className="image-region-box"
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
