// Per-claim source check shown under a generated answer. It is a word-level comparison with the
// cited passages (words, numbers, negation), never a proof that the answer is true.
// A translated answer cannot be compared word by word; its acronyms, original terms kept in parentheses
// and numbers are compared instead.
const SUPPORT_LABELS = {
  SUPPORTED: "Kaynakla örtüşüyor",
  ANCHORED: "Terimleri kaynakta var",
  PARTIAL: "Kısmen örtüşüyor",
  UNSUPPORTED: "Kaynakta karşılığı zayıf",
  UNCHECKED: "Çeviri",
};
const REASONS = {
  NEGATION_MISMATCH: "Olumlu/olumsuz anlamı kaynaktakiyle uyuşmuyor.",
  LOW_COVERAGE: "İfadenin çoğu kaynakta geçmiyor.",
  NUMBER_NOT_IN_SOURCE: "Sayı kaynakta yok.",
  TERMS_NOT_IN_SOURCE: "Bazı terimler kaynakta yok.",
  TOO_SHORT_TO_CHECK: "Kontrol edilemeyecek kadar kısa.",
};
// Only these need the student's attention; the box opens by itself for them.
const NEEDS_LOOK = new Set(["PARTIAL", "UNSUPPORTED"]);

export default function ClaimSupport({ claims }) {
  const checked = (claims || []).filter((c) => c.support);
  if (!checked.length) return null;
  const count = (label) => checked.filter((c) => c.support.label === label).length;
  const ok = count("SUPPORTED");
  const anchored = count("ANCHORED");
  const partial = count("PARTIAL");
  const weak = count("UNSUPPORTED");
  const unchecked = count("UNCHECKED");
  const translated = anchored + unchecked > 0 || checked.some((c) => c.support.reason === "DIFFERENT_LANGUAGE");
  // Gerçek dağılım; "0/3" gibi bir sayı kısmen örtüşenleri ve çevirileri yok sayıp yanlış izlenim verirdi.
  const parts = [
    ok > 0 && `${ok} örtüşüyor`,
    anchored > 0 && `${anchored} teknik terimi kaynakta geçiyor`,
    partial > 0 && `${partial} kısmen örtüşüyor`,
    weak > 0 && `${weak} kaynakta zayıf`,
    unchecked > 0 && `${unchecked} çeviri`,
  ].filter(Boolean);
  const attention = partial + weak > 0;
  return (
    <details className="claim-support" open={attention}>
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
            {NEEDS_LOOK.has(c.support.label) && (
              <small>
                {REASONS[c.support.reason] || ""}
                {c.support.missing_terms?.length > 0 && ` Kaynakta olmayan: ${c.support.missing_terms.join(", ")}.`}
                {c.support.unmatched_numbers?.length > 0 && ` Kaynakta olmayan sayı: ${c.support.unmatched_numbers.join(", ")}.`}
              </small>
            )}
            {c.support.label === "ANCHORED" && c.support.matched_terms?.length > 0 && (
              <small>Kaynakta geçen: {c.support.matched_terms.join(", ")}</small>
            )}
          </li>
        ))}
      </ol>
      {translated && (
        <p className="product-note">
          Yanıt kaynaktan çevrildiği için kelime kelime karşılaştırılamaz; kısaltmalar, parantez içindeki
          özgün terimler ve sayılar kaynakla karşılaştırıldı.
        </p>
      )}
      <p className="product-note">
        Bu, sözcük düzeyinde bir kontroldür; cevabın doğruluğunu kanıtlamaz.
      </p>
    </details>
  );
}
