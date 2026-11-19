import { parseBlocks, parseInline, parseMath } from "../lib/rich-text";

function Formula({ nodes }) {
  return nodes.map((n, i) => {
    if (n.t === "text") return n.v;
    if (n.t === "sup") return <sup key={i}><Formula nodes={n.v} /></sup>;
    if (n.t === "sub") return <sub key={i}><Formula nodes={n.v} /></sub>;
    if (n.t === "sqrt")
      return (
        <span key={i} className="math-sqrt">√<span className="math-radicand"><Formula nodes={n.v} /></span></span>
      );
    return (
      <span key={i} className="math-frac">
        <span><Formula nodes={n.n} /></span>
        <span><Formula nodes={n.d} /></span>
      </span>
    );
  });
}

// "[3]" gibi kaynak işaretleri onCite verilmişse tıklanabilir düğme olur.
function withCites(text, onCite) {
  if (!onCite) return text;
  return String(text).split(/(\[\d{1,2}\])/).map((part, i) => {
    const m = /^\[(\d{1,2})\]$/.exec(part);
    if (!m) return part;
    return (
      <button key={`c${i}`} type="button" className="cite-link" onClick={() => onCite(Number(m[1]))} aria-label={`Kaynak ${m[1]}'e git`}>
        [{m[1]}]
      </button>
    );
  });
}

function Inline({ text, onCite }) {
  return parseInline(text).map((p, i) => {
    if (p.type === "code") return <code key={i} className="rich-inline-code">{p.text}</code>;
    if (p.type === "math")
      return (
        <span key={i} className="math" role="math" aria-label={p.tex}>
          <Formula nodes={parseMath(p.tex)} />
        </span>
      );
    return <span key={i}>{withCites(p.text, onCite)}</span>;
  });
}

// Inline version for places that cannot hold paragraphs (headings, option labels).
export function RichInline({ text }) {
  return <Inline text={text} />;
}

// Renders answer / question text with code blocks, inline code and simple formulas.
export default function RichText({ text, className = "", onCite }) {
  return (
    <div className={`rich-text ${className}`.trim()}>
      {parseBlocks(text).map((b, i) =>
        b.type === "code" ? (
          <pre key={i} className="rich-code" tabIndex={0} aria-label={b.lang ? `${b.lang} kod` : "Kod"}>
            <code>{b.text}</code>
          </pre>
        ) : (
          <p key={i}><Inline text={b.text} onCite={onCite} /></p>
        ),
      )}
    </div>
  );
}
