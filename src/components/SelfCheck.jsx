import { useEffect, useId, useRef, useState } from "react";
import { api } from "../api/endpoints";
import { videoErrorText } from "../lib/video";

const MAX_CHARS = 4000;
// Etiket yalnızca kayıtlı kaynakla karşılaştırmanın sonucudur; not ya da puan değildir.
const LABELS = {
  IN_SOURCE: { text: "Kaynakta var", tone: "ok", count: "kaynakta var" },
  PARTIAL: { text: "Kısmen", tone: "warn", count: "kısmen" },
  NOT_IN_SOURCE: { text: "Kaynakta yok", tone: "none", count: "kaynakta yok" },
  CONFLICTS: { text: "Kaynakla çelişiyor", tone: "no", count: "çelişiyor" },
  UNCHECKED: { text: "Karşılaştırılamadı", tone: "none", count: "karşılaştırılamadı" },
};
const ORDER = ["IN_SOURCE", "PARTIAL", "NOT_IN_SOURCE", "CONFLICTS", "UNCHECKED"];
const SKIP_REASONS = { QUESTION: "soru", OPINION: "görüş", TOO_SHORT: "çok kısa" };

const clock = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const place = (l = {}) =>
  l.page != null ? `Sayfa ${l.page}` : l.slide != null ? `Slayt ${l.slide}` : l.start_ms != null ? clock(l.start_ms) : "";

const ROLE_TR = {
  client: "istemci", server: "sunucu", sender: "gönderici", receiver: "alıcı", source: "kaynak",
  destination: "hedef", parent: "üst düğüm", child: "alt düğüm", producer: "üretici", consumer: "tüketici",
  caller: "çağıran", callee: "çağrılan", master: "ana", slave: "bağımlı",
};
const role = (r) => ROLE_TR[r] || r;

function conflictNote(c) {
  if (!c) return "";
  if (c.kind === "NUMBER") return `Sayı farklı: sen ${c.claim.join(", ")} yazdın, kaynakta ${c.source.join(", ")} geçiyor.`;
  if (c.kind === "ANTONYM") return `Kaynakta zıt ifade var: sen “${c.claim[0]}” yazdın, kaynakta “${c.source[0]}” geçiyor.`;
  if (c.kind === "DIRECTION")
    return `Kaynakta yön ters: kaynakta ${role(c.source[0])} → ${role(c.source[1])}, sen ${role(c.claim[0])} → ${role(c.claim[1])} yazdın.`;
  if (c.kind === "COMPARISON") return "Kaynakta karşılaştırma ters yazılmış.";
  return c.claim_negated
    ? "Senin cümlen olumsuz, kaynaktaki cümle olumlu."
    : "Senin cümlen olumlu, kaynaktaki cümle olumsuz.";
}

// Web'de ara: yalnızca öğrenci isterse, tek iddia için. Ders kaynağından ayrı gösterilir ve özete karışmaz.
function WebCheck({ courseId, claim }) {
  const [state, setState] = useState({ status: "idle" });
  const abort = useRef(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ status: "loading" });
    try {
      const r = await api.selfCheckWeb(courseId, claim, controller.signal);
      if (!controller.signal.aborted) setState({ status: "ready", result: r });
    } catch (e) {
      if (e?.name !== "AbortError" && !controller.signal.aborted) setState({ status: "error", message: videoErrorText(e) });
    }
  }
  const r = state.status === "ready" ? state.result : null;
  return (
    <div className="self-check-web">
      {(state.status === "idle" || state.status === "error") && (
        <button type="button" className="board-control" onClick={run}>
          Web'de ara
        </button>
      )}
      {state.status === "idle" && <small>Yalnızca bu cümle Vikipedi'ye gönderilir.</small>}
      {state.status === "loading" && <span role="status">Vikipedi'de aranıyor…</span>}
      {state.status === "error" && <span role="alert" className="product-error">{state.message}</span>}
      {r?.status === "UNAVAILABLE" && <span role="status">Web araması şu anda yapılamadı.</span>}
      {r?.status === "NOT_FOUND" && <span role="status">Web'de de bulunamadı. Yanlış demek değil.</span>}
      {r?.status === "FOUND" && (
        <div role="status">
          <span className="board-badge" data-source="web">Web'de bulundu</span>{" "}
          <small>Ders kaynağın değil; doğru olduğunu kanıtlamaz.</small>
          {r.sources.map((s) => (
            <blockquote key={s.url}>
              “{s.quote}”{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="product-link">
                {s.title} · {s.site}
              </a>
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
}

// "Beni kontrol et": öğrencinin kendi cümleleri iddialara bölünür ve her biri ders materyalleriyle
// karşılaştırılır. Sonuç bir not değil, kayıtlı kaynakla sözcük/sayı karşılaştırmasıdır; doğruluk kanıtı sayılmaz.
export default function SelfCheck({ courseId, onOpenSource }) {
  const [text, setText] = useState("");
  const [state, setState] = useState({ status: "idle" });
  const area = useRef(null);
  const abort = useRef(null);
  const areaId = useId();
  const hintId = useId();

  useEffect(() => () => abort.current?.abort(), []);
  // Başka bir derse geçilirse önceki dersin sonucu gösterilmez.
  useEffect(() => {
    abort.current?.abort();
    setState({ status: "idle" });
  }, [courseId]);

  const empty = !text.trim();
  const loading = state.status === "loading";

  async function run() {
    if (empty || loading) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const sent = text;
    setState({ status: "loading" });
    try {
      const result = await api.selfCheck(courseId, { text: sent }, controller.signal);
      if (!controller.signal.aborted) setState({ status: "ready", result, sent });
    } catch (e) {
      if (e?.name !== "AbortError" && !controller.signal.aborted) {
        setState({ status: "error", message: videoErrorText(e) });
        area.current?.focus();
      }
    }
  }

  // "Kalan N iddiayı kontrol et": aynı metnin sonraki iddiaları; önceki sonuçlar korunur.
  async function more() {
    if (state.status !== "ready" || loading) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const { result: prev, sent } = state;
    setState({ status: "loading", keep: { result: prev, sent } });
    try {
      const next = await api.selfCheck(courseId, { text: sent, offset: prev.next_offset }, controller.signal);
      if (controller.signal.aborted) return;
      const sum = { ...prev.summary };
      for (const k of Object.keys(next.summary)) sum[k] = (sum[k] || 0) + next.summary[k];
      setState({ status: "ready", sent, result: { ...next, claims: [...prev.claims, ...next.claims], skipped: prev.skipped, summary: sum } });
    } catch (e) {
      if (e?.name !== "AbortError" && !controller.signal.aborted) {
        setState({ status: "ready", sent, result: prev, moreError: videoErrorText(e) });
      }
    }
  }

  const shown = state.status === "loading" ? state.keep : state.status === "ready" ? state : null;
  const result = shown ? shown.result : null;
  const summary = result?.summary;
  const parts = summary ? ORDER.filter((k) => summary[k] > 0) : [];
  return (
    <div className="self-check">
      <label htmlFor={areaId} className="self-check-label">
        Konuyu kendi cümlelerinle yaz
      </label>
      <textarea
        id={areaId}
        ref={area}
        className="self-check-area"
        rows={7}
        maxLength={MAX_CHARS}
        value={text}
        aria-describedby={hintId}
        placeholder="Örn. TCP bağlantı kurulumunda üç yollu el sıkışma kullanılır…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            void run();
          }
        }}
      />
      <div className="self-check-bar">
        <span id={hintId} className="self-check-count">
          {text.length}/{MAX_CHARS}
        </span>
        <button type="button" className="board-control" onClick={run} disabled={empty || loading} aria-busy={loading}>
          {loading ? "Kontrol ediliyor…" : "Kontrol et"}
        </button>
      </div>

      {state.status === "error" && (
        <p role="alert" className="product-error">
          {state.message} Yazdığın metin korundu.
        </p>
      )}
      {loading && (
        <p role="status" className="product-note">
          Cümlelerin ders materyalleriyle karşılaştırılıyor…
        </p>
      )}

      {result && (
        <section className="self-check-result" aria-label="Kontrol sonucu">
          {summary.total === 0 ? (
            <p role="status" className="product-note">
              Kontrol edilecek bir iddia bulunamadı. Bilgi veren, tam cümleler yaz; soru ve görüş cümleleri kontrol edilmez.
            </p>
          ) : (
            <p role="status" className="self-check-summary">
              <span>{summary.total} iddia: </span>
              {parts.map((k, i) => (
                <span key={k}>
                  {i > 0 && ", "}
                  <b>{summary[k]}</b> {LABELS[k].count}
                </span>
              ))}
            </p>
          )}
          {shown.sent !== text && (
            <p className="product-note">Metni değiştirdin; bu sonuç önceki metne aittir. Yeniden kontrol et.</p>
          )}
          {summary.total > 0 && (
            <p className="product-note">
              Bu bir not değildir. Sözcük, sayı ve olumsuzluk karşılaştırmasıdır; iddianın doğru olduğunu kanıtlamaz.
            </p>
          )}
          {result.remaining > 0 && (
            <div className="self-check-more">
              <p className="product-note">Metinde {result.remaining} iddia daha var; ilk {result.claims.length} iddia kontrol edildi.</p>
              <button type="button" className="board-control" onClick={more} disabled={loading}>
                {loading ? "Kontrol ediliyor…" : `Kalan ${result.remaining} iddiayı kontrol et`}
              </button>
              {state.moreError && <p role="alert" className="product-error">{state.moreError}</p>}
            </div>
          )}
          {summary.total > 0 && (
            <ol className="self-check-list">
              {result.claims.map((c, i) => {
                const label = LABELS[c.label] || LABELS.UNCHECKED;
                return (
                  <li key={i} data-label={c.label}>
                    <div className="self-check-row">
                      <span className="board-badge self-check-badge" data-tone={label.tone}>
                        {label.text}
                      </span>
                      <span className="self-check-claim">{c.text}</span>
                    </div>
                    {c.translation?.method === "model" && c.translation.text && (
                      <p className="self-check-note">
                        Çeviri üzerinden karşılaştırıldı ({c.translation.to === "en" ? "İngilizce" : "Türkçe"}): “{c.translation.text}”
                      </p>
                    )}
                    {c.translation?.method === "dictionary" && (
                      <p className="self-check-note">Kaynak başka dilde; terimler sözlükle eşlenerek karşılaştırıldı.</p>
                    )}
                    {c.translated && !c.translation && (
                      <p className="self-check-note">
                        Metin ile kaynak farklı dillerde; yalnızca teknik terimler ({c.matched_terms.join(", ")}) karşılaştırıldı.
                      </p>
                    )}
                    {c.label === "NOT_IN_SOURCE" && (
                      <>
                        <p className="self-check-note">Bu iddia için materyallerinde kanıt bulunamadı. Yanlış demek değil.</p>
                        <WebCheck courseId={courseId} claim={c.text} />
                      </>
                    )}
                    {c.label === "CONFLICTS" && <p className="self-check-note">{conflictNote(c.conflict)}</p>}
                    {c.label === "PARTIAL" && (c.missing_terms.length > 0 || c.unmatched_numbers.length > 0) && (
                      <p className="self-check-note">
                        {c.missing_terms.length > 0 && `Kaynakta bulunamayan: ${c.missing_terms.join(", ")}. `}
                        {c.unmatched_numbers.length > 0 && `Kaynakta olmayan sayı: ${c.unmatched_numbers.join(", ")}.`}
                      </p>
                    )}
                    {c.label === "UNCHECKED" && (
                      <>
                        <p className="self-check-note">Bu cümle materyallerinle karşılaştırılamadı (kaynak başka dilde ya da çeviri yapılamadı). Yanlış demek değil.</p>
                        <WebCheck courseId={courseId} claim={c.text} />
                      </>
                    )}
                    {c.partly_unchecked && (
                      <p className="self-check-note">Karşılaştırılabilen kısımlar kaynakta var; bir kısmı karşılaştırılamadı.</p>
                    )}
                    {c.parts?.length > 1 && (
                      <ul className="self-check-parts" aria-label="İddianın parçaları">
                        {c.parts.map((p, k) => {
                          const pl = LABELS[p.label] || LABELS.UNCHECKED;
                          return (
                            <li key={k}>
                              <span className="board-badge self-check-badge" data-tone={pl.tone}>{pl.text}</span>
                              <span>{p.text}</span>
                              {p.label === "CONFLICTS" && <small> {conflictNote(p.conflict)}</small>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {c.meaning_warning && (
                      <p className="self-check-note self-check-meaning" role="note">
                        Anlam farklı olabilir, kaynağa bak: “{c.meaning_warning.quote}”
                      </p>
                    )}
                    {c.sources.map((s) => (
                      <div key={s.source_id} className="self-check-source">
                        <blockquote>“{s.quote}”</blockquote>
                        <button
                          type="button"
                          className="product-link"
                          onClick={() => onOpenSource({ material_id: s.material_id, id: s.source_id })}
                        >
                          Kaynağa git · {s.title}
                          {place(s.location) ? ` · ${place(s.location)}` : ""}
                        </button>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>
          )}
          {result.skipped.length > 0 && (
            <details className="self-check-skipped">
              <summary>Kontrol edilmeyen {result.skipped.length} cümle</summary>
              <ul>
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {s.text} <span className="board-badge">{SKIP_REASONS[s.reason] || s.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
