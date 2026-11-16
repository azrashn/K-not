import { useRef, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";

// Search inside the open material. Hits keep their page / slide / time and open that section.
export default function MaterialFind({ courseId, material, labelOf, onOpenSource }) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState({ status: "idle" });
  const latest = useRef(0);
  // Results belong to one material; switching materials never shows the previous search.
  const state = saved.materialId === material.id ? saved : { status: "idle" };

  async function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    const epoch = ++latest.current;
    setSaved({ status: "loading", materialId: material.id });
    try {
      const result = await api.materialFind(courseId, material.id, q);
      if (epoch === latest.current) setSaved({ status: "ready", materialId: material.id, q, result });
    } catch (err) {
      if (epoch === latest.current) setSaved({ status: "error", materialId: material.id, message: videoErrorText(err) });
    }
  }

  return (
    <section className="material-find" aria-label="Belge arama">
      <form onSubmit={search} className="material-find-form">
        <input
          aria-label="Belge içinde ara"
          value={query}
          maxLength={100}
          placeholder="Bu materyalde ara…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" className="product-link" disabled={query.trim().length < 2 || state.status === "loading"}>
          Ara
        </button>
      </form>
      {state.status === "error" && <p role="alert" className="product-error">{state.message}</p>}
      {state.status === "ready" && state.result.hits.length === 0 && (
        <p role="status" className="product-note">“{state.q}” bu materyalde bulunamadı.</p>
      )}
      {state.status === "ready" && state.result.hits.length > 0 && (
        <>
          <p role="status" className="product-note">{state.result.hits.length} bölümde bulundu</p>
          <ul className="material-find-hits">
            {state.result.hits.map((h) => (
              <li key={h.segment_id}>
                <button type="button" onClick={() => onOpenSource({ id: h.segment_id, location: h.location })}>
                  <span className="source-badge">{labelOf ? labelOf(h.location) : "Bölüm"}{h.count > 1 ? ` · ${h.count}×` : ""}</span>
                  <span>
                    {h.snippet.slice(0, h.match_start)}
                    <mark>{h.snippet.slice(h.match_start, h.match_end)}</mark>
                    {h.snippet.slice(h.match_end)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
