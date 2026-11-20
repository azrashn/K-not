import { useState } from "react";
import { videoErrorText, videoTime } from "../lib/video";

// Automatic speech-to-text sometimes mixes in characters of other alphabets (Chinese, Cyrillic, Korean...) when
// the audio does not match the language it was told to expect. Such a line is not shown as if it were what the
// speaker said: a short notice stands in for it, the raw text stays one click away, and the line can still be
// played and fixed.
const FOREIGN = /[Ѐ-ӿ֐-ۿऀ-෿぀-ヿ㐀-鿿가-힯]/g;
export const looksGarbled = (text) => (String(text || "").match(FOREIGN) || []).length >= 2;

// One transcript line: seek on click, fix on demand. A fix never overwrites the engine's text; the
// original stays available, and the fix can be undone.
export default function TranscriptChunk({ chunk, active, onSeek, onSave, onRevert }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(chunk.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const garbled = !chunk.corrected && !showRaw && looksGarbled(chunk.text);

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      setEditing(false);
    } catch (e) {
      setError(videoErrorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`transcript-chunk${active ? " active" : ""}`} data-corrected={chunk.corrected ? "true" : undefined}>
      <button type="button" className="transcript-seek" onClick={onSeek}>
        <span className="font-mono text-xs text-accent">{videoTime(chunk.start_seconds)}</span>
        {garbled ? (
          <span className="mt-1 block text-sm leading-relaxed transcript-garbled">
            Bu bölümün otomatik metni güvenilir görünmüyor (başka alfabelerden karakterler karışmış).
          </span>
        ) : (
          <span className="mt-1 block text-sm leading-relaxed">{chunk.text}</span>
        )}
      </button>
      {garbled && (
        <div className="transcript-actions">
          <button type="button" className="product-link" onClick={() => setShowRaw(true)}>Yine de göster</button>
        </div>
      )}
      {chunk.corrected && (
        <details className="transcript-original">
          <summary><span className="source-badge">Düzeltildi</span> özgün metin</summary>
          <p>{chunk.original_text}</p>
        </details>
      )}
      {editing ? (
        <form
          className="transcript-edit"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => onSave(chunk.index, text));
          }}
        >
          <label>
            Düzeltilmiş metin
            <textarea aria-label="Düzeltilmiş metin" rows={3} value={text} maxLength={3000} disabled={busy} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="transcript-actions">
            <button type="submit" className="product-link" disabled={busy || !text.trim()}>Kaydet</button>
            <button type="button" className="product-link" disabled={busy} onClick={() => { setEditing(false); setText(chunk.text); }}>Vazgeç</button>
          </div>
        </form>
      ) : (
        <div className="transcript-actions">
          <button type="button" className="product-link" onClick={() => { setText(chunk.text); setEditing(true); }}>Düzelt</button>
          {chunk.corrected && (
            <button type="button" className="product-link" disabled={busy} onClick={() => run(() => onRevert(chunk.index))}>Düzeltmeyi geri al</button>
          )}
        </div>
      )}
      {error && <p role="alert" className="product-error">{error}</p>}
    </div>
  );
}
