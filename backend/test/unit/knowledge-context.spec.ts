import {
  resolveScope,
  validateViewport,
  inViewport,
} from "../../src/knowledge/context";
const materials = [
  { id: "pdf_a", status: "READY" },
  { id: "file_b", status: "READY" },
  { id: "video_c", status: "FAILED" },
];
test("active view does not constrain the default course search", () => {
  expect(resolveScope(materials, "pdf_a").map((m) => m.id)).toEqual([
    "pdf_a",
    "file_b",
  ]);
});
test("single and selected scopes are explicit and cannot include inaccessible IDs", () => {
  expect(resolveScope(materials, "pdf_a", { mode: "active" })).toHaveLength(1);
  expect(
    resolveScope(materials, "pdf_a", {
      mode: "selected",
      material_ids: ["file_b"],
    }),
  ).toEqual([materials[1]]);
  expect(() =>
    resolveScope(materials, undefined, { mode: "selected", material_ids: [] }),
  ).toThrow();
  expect(() =>
    resolveScope(materials, "pdf_a", {
      mode: "selected",
      material_ids: ["foreign"],
    }),
  ).toThrow();
  expect(() =>
    resolveScope(materials, "pdf_a", {
      mode: "selected",
      material_ids: ["video_c"],
    }),
  ).toThrow();
});
test("viewport page/slide/time and region belong to the actual material", () => {
  const pdf = { kind: "PDF", row: { pageCount: 5 } };
  validateViewport(pdf, { kind: "page", page: 4 });
  expect(() => validateViewport(pdf, { kind: "page", page: 6 })).toThrow();
  expect(() => validateViewport(pdf, { kind: "slide", slide: 4 })).toThrow();
  expect(() =>
    validateViewport(pdf, {
      kind: "page",
      page: 4,
      region: { x: 0.8, y: 0.2, width: 0.5, height: 0.3 },
    }),
  ).toThrow();
  expect(inViewport({ kind: "page", page: 4 }, { kind: "page", page: 4 })).toBe(
    true,
  );
  expect(
    inViewport(
      { kind: "video", start_ms: 100, end_ms: 200 },
      { kind: "video", timestamp_ms: 200 },
    ),
  ).toBe(false);
});
