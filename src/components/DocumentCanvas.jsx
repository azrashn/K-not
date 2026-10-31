import { useEffect, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";
export default function DocumentCanvas({
  courseId,
  material,
  source,
  segments,
  onSource,
  onViewportChange,
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
    [drag, setDrag] = useState(null);
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
        <div>
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
        {loading && (
          <div role="status" className="render-skeleton">
            {label} görüntüsü hazırlanıyor…
          </div>
        )}
        {error && (
          <p role="alert" className="product-error">
            Görüntü açılamadı: {error} Özgün dosyayı indirerek de
            inceleyebilirsin.
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
      <p className="viewer-note">
        Özgün{" "}
        {material.kind === "PPTX" ? "slayt düzeninden" : "PDF sayfasından"}{" "}
        oluşturulan görüntü. Görsel soru veya bölge seçimi bu görüntüyü yerel
        modele bağlar; model yorumu doğrulanmış bilgi değildir.
      </p>
    </section>
  );
}
