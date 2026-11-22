import { useEffect, useMemo, useRef } from "react";
import { matchQuote } from "../lib/quote-match";

/** Source text with the quoted sentence marked (<mark>) and scrolled into view. Without a match, the text
 *  as is. An inexact match (the closest sentence) is marked as partial, so it is not shown as the quote. */
export default function MarkedText({ text, quote }) {
  const found = useMemo(() => (quote ? matchQuote(text, quote) : null), [text, quote]);
  const ref = useRef(null);
  useEffect(() => {
    if (!found) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    ref.current?.scrollIntoView?.({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [found]);
  if (!found) return text;
  return (
    <>
      {text.slice(0, found.start)}
      <mark
        ref={ref}
        className="evidence"
        data-strength={found.exact ? undefined : "partial"}
        title={found.exact ? "Sorunun dayandığı cümle" : "Alıntı birebir bulunamadı; en yakın cümle"}
      >
        {text.slice(found.start, found.end)}
      </mark>
      {text.slice(found.end)}
    </>
  );
}
