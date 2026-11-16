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

function Inline({ text }) {
  return parseInline(text).map((p, i) => {
    if (p.type === "code") return <code key={i} className="rich-inline-code">{p.text}</code>;
    if (p.type === "math")
      return (
        <span key={i} className="math" role="math" aria-label={p.tex}>
          <Formula nodes={parseMath(p.tex)} />
        </span>
      );
    return p.text;
  });
}

// Inline version for places that cannot hold paragraphs (headings, option labels).
export function RichInline({ text }) {
  return <Inline text={text} />;
}

// Renders answer / question text with code blocks, inline code and simple formulas.
export default function RichText({ text, className = "" }) {
  return (
    <div className={`rich-text ${className}`.trim()}>
      {parseBlocks(text).map((b, i) =>
        b.type === "code" ? (
          <pre key={i} className="rich-code" tabIndex={0} aria-label={b.lang ? `${b.lang} kod` : "Kod"}>
            <code>{b.text}</code>
          </pre>
        ) : (
          <p key={i}><Inline text={b.text} /></p>
        ),
      )}
    </div>
  );
}
