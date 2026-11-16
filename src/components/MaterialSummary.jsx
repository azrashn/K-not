import { useRef, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";

const FOCI = [
  { id: "summary", label: "Özet" },
  { id: "concepts", label: "Anahtar kavramlar" },
];

// Source-bound summary of one material. Each item shows the exact quote it was verified against;
// nothing is shown that the server could not match to the cited source.
export default function MaterialSummary({ courseId, material, labelOf, onOpenSource }) {
  const [saved, setSaved] = useState({ status: "idle" });
  const latest = useRef(0);
  // A result belongs to one material; switching materials never shows the previous summary.
  const state = saved.materialId === material.id ? saved : { status: "idle" };

  async function run(focus) {
    const epoch = ++latest.current;
    const materialId = material.id;
    setSaved({ status: "loading", focus, materialId });
    try {
      const result = await api.materialSummary(courseId, materialId, focus);
      if (epoch === latest.current) setSaved({ status: "ready", focus, materialId, result });
    } catch (e) {
      if (epoch === latest.current) setSaved({ status: "error", focus, materialId, message: videoErrorText(e) });
    }
  }

  return (
    <section className="material-summary product-panel" aria-label="Kaynaklı özet">
      <div className="flex gap-2 flex-wrap items-center">
        {FOCI.map((f) => (
          <button
            key={f.id}
            type="button"
            className="source-badge"
            disabled={state.status === "loading"}
            aria-pressed={state.focus === f.id && state.status !== "idle"}
            onClick={() => run(f.id)}
          >
            {f.label} hazırla
          </button>
        ))}
      </div>
      <p className="product-note">
        Her madde yalnızca kaynakta birebir bulunan bir alıntıyla gösterilir. Bu, materyalin tüm
        konularını kapsadığı anlamına gelmez.
      </p>
      {state.status === "loading" && <p role="status">Kaynaklar okunuyor ve doğrulanıyor…</p>}
      {state.status === "error" && (
        <p role="alert" className="product-error">{state.message}</p>
      )}
      {state.status === "ready" && (
        <ol className="grid gap-3 mt-3 list-none p-0">
          {state.result.items.map((item, i) => (
            <li key={i} className="border border-[var(--line,#d4d4d8)] rounded-md p-3">
              {item.term ? (
                <>
                  <strong>{item.term}</strong>
                  <p>{item.explanation}</p>
                </>
              ) : (
                <p>{item.text}</p>
              )}
              <blockquote className="text-sm opacity-80 border-l-2 pl-3 my-2">“{item.quote}”</blockquote>
              <button
                type="button"
                className="product-link"
                onClick={() => onOpenSource({ id: item.source.id, location: item.source.location })}
              >
                Kaynağa git
                {labelOf && item.source.location ? ` · ${labelOf(item.source.location)}` : ""}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
