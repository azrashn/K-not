// Yanlış defteri: kayıtlı cevap denemelerinden türetilir; ayrı tablo yoktur.
// Yalnızca kayıtlı veri gösterilir: tahmin, puan ya da hazırlık yüzdesi üretilmez.
// "Yanlış" = cevap anahtarıyla uyuşmayan kesin denemeler (outcome REVIEW_SOURCE). Farklı sözcüklerle verilmiş
// kısa cevaplar (REVIEW_REQUIRED) otomatik yanlış sayılmaz, bu yüzden deftere girmez.

export type ReviewAttemptRow = {
  quizId: string;
  response: string;
  outcome: string;
  createdAt: Date;
  quiz: {
    id: string;
    topic: string;
    kind: string;
    purpose: string;
    materialId: string;
    data: any;
  };
};

export type ReviewSource = {
  id: string;
  material_id: string;
  title: string | null;
  kind: string;
  location: any;
};

export type ReviewLocator = { type: "page"; page: number } | { type: "time"; start_ms: number } | null;

export type ReviewItem = {
  quiz_id: string;
  purpose: string;
  topic: string;
  kind: string;
  question: string;
  your_answer: string | null;
  correct_answer: string | null;
  /** OPEN: son deneme yanlış. LAST_CORRECT: önce yanlıştı, son denemede cevap anahtarıyla eşleşti. */
  status: "OPEN" | "LAST_CORRECT";
  wrong_count: number;
  last_answered_at: Date;
  source: ReviewSource | null;
  locator: ReviewLocator;
};

export type ReviewGroup = {
  key: string;
  material_id: string;
  title: string | null;
  kind: string;
  locator: ReviewLocator;
  items: ReviewItem[];
};

const WRONG = "REVIEW_SOURCE";
const RIGHT = "CORRECT";

/** Konum kaydı -> sayfa (PDF `page`, PPTX `slide`) ya da zaman (video `start_ms`). Uydurma konum vermez. */
export function locatorOf(kind: string, location: any): ReviewLocator {
  const page = kind === "PDF" ? location?.page : kind === "PPTX" ? location?.slide : null;
  if (Number.isSafeInteger(page) && page >= 1 && page <= 100000) return { type: "page", page };
  const t = location?.start_ms;
  if (kind === "VIDEO" && Number.isSafeInteger(t) && t >= 0) return { type: "time", start_ms: t };
  return null;
}

function optionText(data: any, raw: unknown): string | null {
  if (!Array.isArray(data?.options)) return typeof raw === "string" && raw ? raw : null;
  const i = Number(raw);
  return Number.isInteger(i) && data.options[i] != null ? String(data.options[i]) : null;
}

function sourceOf(row: ReviewAttemptRow, titles: Map<string, string>): ReviewSource | null {
  const s = row.quiz.data?.source;
  if (!s || typeof s.id !== "string" || typeof s.material_id !== "string" || !s.location) return null;
  if (s.material_id !== row.quiz.materialId) return null;
  return {
    id: s.id,
    material_id: s.material_id,
    title: titles.get(s.material_id) ?? s.title ?? null,
    kind: String(s.kind),
    location: s.location,
  };
}

/**
 * @param attempts   bir kullanıcının bir dersteki tüm denemeleri (sıra önemli değil)
 * @param titles     dersin mevcut materyalleri (id -> başlık); listede olmayan materyalin soruları gösterilmez
 */
export function buildReview(attempts: ReviewAttemptRow[], titles: Map<string, string>) {
  const byQuiz = new Map<string, ReviewAttemptRow[]>();
  for (const a of [...attempts].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    if (!titles.has(a.quiz.materialId)) continue;
    (byQuiz.get(a.quizId) ?? byQuiz.set(a.quizId, []).get(a.quizId)!).push(a);
  }
  const items: ReviewItem[] = [];
  for (const list of byQuiz.values()) {
    const wrongs = list.filter((a) => a.outcome === WRONG);
    if (!wrongs.length) continue;
    const last = list[list.length - 1];
    if (last.outcome !== WRONG && last.outcome !== RIGHT) continue; // son deneme belirsizse (ör. yansıtma) yargı verilmez
    const shown = last.outcome === WRONG ? last : wrongs[wrongs.length - 1];
    const d = last.quiz.data ?? {};
    const source = sourceOf(last, titles);
    items.push({
      quiz_id: last.quizId,
      purpose: last.quiz.purpose,
      topic: last.quiz.topic,
      kind: last.quiz.kind,
      question: String(d.question ?? ""),
      your_answer: optionText(d, shown.response),
      correct_answer: optionText(d, d.expected),
      status: last.outcome === WRONG ? "OPEN" : "LAST_CORRECT",
      wrong_count: wrongs.length,
      last_answered_at: last.createdAt,
      source,
      locator: source ? locatorOf(source.kind, source.location) : null,
    });
  }
  items.sort((a, b) => b.last_answered_at.getTime() - a.last_answered_at.getTime());

  const groups = new Map<string, ReviewGroup>();
  const unlinked: ReviewItem[] = [];
  for (const it of items) {
    if (!it.source) {
      unlinked.push(it);
      continue;
    }
    const loc = it.locator;
    const key = `${it.source.material_id}:${loc ? (loc.type === "page" ? `p${loc.page}` : `t${loc.start_ms}`) : "-"}`;
    const g = groups.get(key) ?? { key, material_id: it.source.material_id, title: it.source.title, kind: it.source.kind, locator: loc, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const rank = (l: ReviewLocator) => (l ? (l.type === "page" ? l.page : l.start_ms) : Number.MAX_SAFE_INTEGER);
  const ordered = [...groups.values()].sort(
    (a, b) => (a.title ?? "").localeCompare(b.title ?? "", "tr") || rank(a.locator) - rank(b.locator),
  );
  return {
    groups: ordered,
    unlinked,
    counts: {
      open: items.filter((i) => i.status === "OPEN").length,
      last_correct: items.filter((i) => i.status === "LAST_CORRECT").length,
    },
    mastery_estimated: false,
  };
}
