import { Btn } from "./ui";
import { recommendedMaterial } from "../lib/last-material";

const KIND = { PDF: "PDF", PPTX: "Sunum", TXT: "Metin", VIDEO: "Video" };

// Shown when nothing is open: where to begin, instead of leaving the choice to the student.
export default function WorkspaceStart({ materials, lastId, onOpen }) {
  const { material, resumed, others } = recommendedMaterial(materials, lastId);
  if (!material)
    return (
      <div className="viewer-empty workspace-start">
        <span aria-hidden>▤</span>
        <h3>Önce bir materyal ekle</h3>
        <p>
          Soldan PDF, sunum, metin ya da video ekle. Hazır olunca burada açılır; yanıtlardaki
          kaynak bağlantıları da ilgili sayfa, slayt ve zaman aralığını burada gösterir.
        </p>
      </div>
    );
  return (
    <div className="viewer-empty workspace-start">
      <span aria-hidden>▤</span>
      <h3>Buradan başla</h3>
      <p>
        {resumed ? "En son bu materyaldeydin:" : "Önerilen ilk materyal:"}{" "}
        <strong>{material.title}</strong> <span className="source-badge">{KIND[material.kind] || material.kind}</span>
      </p>
      <Btn onClick={() => onOpen(material)}>Birlikte öğren</Btn>
      {others.length > 0 && (
        <div className="start-others">
          <p className="product-note">Diğer materyaller</p>
          <ul>
            {others.map((m) => (
              <li key={m.id}>
                <button type="button" className="product-link" onClick={() => onOpen(m)}>
                  {m.title}
                </button>
                <span className="source-badge"> {KIND[m.kind] || m.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
