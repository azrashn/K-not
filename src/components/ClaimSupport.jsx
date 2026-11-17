// Per-claim source check shown under a generated answer. It is a word-level comparison with the
// cited passages (words, numbers, negation), never a proof that the answer is true.
const SUPPORT_LABELS = {
  SUPPORTED: "Kaynakla örtüşüyor",
  PARTIAL: "Kısmen örtüşüyor",
  UNSUPPORTED: "Kaynakta karşılığı zayıf",
};
const REASONS = {
  NEGATION_MISMATCH: "Olumlu/olumsuz anlamı kaynaktakiyle uyuşmuyor.",
  LOW_COVERAGE: "İfadenin çoğu kaynakta geçmiyor.",
  NUMBER_NOT_IN_SOURCE: "Sayı kaynakta yok.",
  TERMS_NOT_IN_SOURCE: "Bazı terimler kaynakta yok.",
  TOO_SHORT_TO_CHECK: "Kontrol edilemeyecek kadar kısa.",
};

export default function ClaimSupport({ claims }) {
  const checked = (claims || []).filter((c) => c.support);
  if (!checked.length) return null;
  const ok = checked.filter((c) => c.support.label === "SUPPORTED").length;
  const weak = checked.filter((c) => c.support.label === "UNSUPPORTED").length;
  const partial = checked.length - ok - weak;
  // "0/3" gibi bir sayı, kısmen örtüşen iddiaları yok sayıp yanıtın yanlış olduğunu düşündürürdü:
  // gerçek dağılımı yaz.
  const parts = [
    ok > 0 && `${ok} örtüşüyor`,
    partial > 0 && `${partial} kısmen örtüşüyor`,
    weak > 0 && `${weak} kaynakta zayıf`,
  ].filter(Boolean);
  return (
    <details className="claim-support" open={ok < checked.length}>
      <summary>
        Kaynak kontrolü: {checked.length} iddia — {parts.join(", ")}
      </summary>
      {weak > 0 && (
        <p role="note" className="claim-support-warning">
          Bazı iddialar kaynak metinle zayıf örtüşüyor. Kaynağı açıp kontrol et.
        </p>
      )}
      <ol>
        {checked.map((c, i) => (
          <li key={i} data-support={c.support.label}>
            <span className="source-badge">{SUPPORT_LABELS[c.support.label] || c.support.label}</span>{" "}
            <span>{c.text}</span>
            {c.support.label !== "SUPPORTED" && (
              <small>
                {REASONS[c.support.reason] || ""}
                {c.support.missing_terms?.length > 0 && ` Kaynakta olmayan: ${c.support.missing_terms.join(", ")}.`}
                {c.support.unmatched_numbers?.length > 0 && ` Kaynakta olmayan sayı: ${c.support.unmatched_numbers.join(", ")}.`}
              </small>
            )}
          </li>
        ))}
      </ol>
      <p className="product-note">
        Bu, sözcük düzeyinde bir kontroldür; cevabın doğruluğunu kanıtlamaz.
      </p>
    </details>
  );
}
