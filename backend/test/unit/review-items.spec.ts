import { buildReview, locatorOf, type ReviewAttemptRow } from "../../src/review/review-items";

const titles = new Map([["pdf_a", "Chapter_3"], ["video_v", "Ders 1"]]);
const t = (n: number) => new Date(2026, 10, 22, 10, n);
const src = (material_id: string, kind: string, location: any) => ({ id: "s".repeat(64), material_id, title: "x", kind, location });
function row(quizId: string, outcome: string, n: number, over: any = {}, response = "0"): ReviewAttemptRow {
  return {
    quizId, response, outcome, createdAt: t(n),
    quiz: {
      id: quizId, topic: "konu", kind: "MULTIPLE_CHOICE", purpose: "PRACTICE", materialId: "pdf_a",
      data: { question: "Soru?", options: ["a", "b", "c"], expected: 2, source: src("pdf_a", "PDF", { kind: "page", page: 4 }) },
      ...over,
    },
  };
}

test("yalnızca kesin yanlışlar girer; yansıtma ve belirsiz cevaplar girmez", () => {
  const r = buildReview(
    [row("q1", "REVIEW_SOURCE", 1), row("q2", "CORRECT", 1), row("q3", "REVIEW_REQUIRED", 1), row("q4", "REFLECTION_SAVED", 1)],
    titles,
  );
  expect(r.groups.flatMap((g) => g.items.map((i) => i.quiz_id))).toEqual(["q1"]);
  expect(r.counts).toEqual({ open: 1, last_correct: 0 });
  expect(r.mastery_estimated).toBe(false);
});

test("aynı soru tekrar yanlışsa yinelenmez; wrong_count artar", () => {
  const r = buildReview([row("q1", "REVIEW_SOURCE", 1), row("q1", "REVIEW_SOURCE", 2)], titles);
  const items = r.groups.flatMap((g) => g.items);
  expect(items).toHaveLength(1);
  expect(items[0].wrong_count).toBe(2);
  expect(items[0].status).toBe("OPEN");
});

test("sonra doğru çözülen soru silinmez: LAST_CORRECT", () => {
  const r = buildReview([row("q1", "REVIEW_SOURCE", 1), row("q1", "CORRECT", 2)], titles);
  const it = r.groups[0].items[0];
  expect(it.status).toBe("LAST_CORRECT");
  expect(it.your_answer).toBe("a");
  expect(it.correct_answer).toBe("c");
  expect(r.counts).toEqual({ open: 0, last_correct: 1 });
});

test("kaynak sayfaya göre gruplanır ve sayfa sırasına dizilir", () => {
  const at = (p: number) => ({ data: { question: "q", options: ["a", "b"], expected: 1, source: src("pdf_a", "PDF", { kind: "page", page: p }) } });
  const r = buildReview(
    [row("q1", "REVIEW_SOURCE", 1, at(9)), row("q2", "REVIEW_SOURCE", 2, at(4)), row("q3", "REVIEW_SOURCE", 3, at(4))],
    titles,
  );
  expect(r.groups.map((g) => [g.locator, g.items.length])).toEqual([[{ type: "page", page: 4 }, 2], [{ type: "page", page: 9 }, 1]]);
});

test("alıntısı olmayan soruda kaynak ve bağlantı yoktur; sayfa uydurulmaz", () => {
  const r = buildReview([row("q1", "REVIEW_SOURCE", 1, { data: { question: "q", options: ["a", "b"], expected: 1 } })], titles);
  expect(r.groups).toEqual([]);
  expect(r.unlinked).toHaveLength(1);
  expect(r.unlinked[0].source).toBeNull();
  expect(r.unlinked[0].locator).toBeNull();
});

test("materyal başka sorunun kaynağıyla uyuşmuyorsa ya da dersten kalktıysa soru gösterilmez/bağlanmaz", () => {
  const mismatch = row("q1", "REVIEW_SOURCE", 1, { data: { question: "q", options: ["a"], expected: 0, source: src("pdf_zzz", "PDF", { page: 1 }) } });
  expect(buildReview([mismatch], titles).unlinked[0].source).toBeNull();
  const gone = row("q2", "REVIEW_SOURCE", 1, { materialId: "pdf_silinmis" });
  const r = buildReview([gone], titles);
  expect(r.groups).toEqual([]);
  expect(r.unlinked).toEqual([]);
});

test("video kaynağı zaman olarak, PDF/PPTX sayfa olarak, diğerleri konumsuz", () => {
  expect(locatorOf("VIDEO", { start_ms: 65000 })).toEqual({ type: "time", start_ms: 65000 });
  expect(locatorOf("PPTX", { slide: 3 })).toEqual({ type: "page", page: 3 });
  expect(locatorOf("PDF", { page: 0 })).toBeNull();
  expect(locatorOf("PDF", { start_ms: 5 })).toBeNull();
  expect(locatorOf("TEXT", { page: 2 })).toBeNull();
});

test("açık uçlu soruda seçenek yoksa metin cevap olduğu gibi gösterilir", () => {
  const r = buildReview(
    [row("q1", "REVIEW_SOURCE", 1, { kind: "FILL_BLANK", data: { question: "q", expected: "entropi", source: src("pdf_a", "PDF", { page: 2 }) } }, "gain")],
    titles,
  );
  const it = r.groups[0].items[0];
  expect([it.your_answer, it.correct_answer]).toEqual(["gain", "entropi"]);
});
