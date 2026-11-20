import { buildCoverage, pageOf } from "../../src/kapsam/coverage";

const pdf = (id: string, pages: number | null) => ({
  id, source_id: id.replace("pdf_", ""), kind: "PDF", title: id, page_count: pages,
});

test("pageOf: PDF sayfa, PPTX slayt; video ve metin konumu sayfa değildir", () => {
  expect(pageOf("PDF", { kind: "page", page: 4 })).toBe(4);
  expect(pageOf("PPTX", { kind: "slide", slide: 2 })).toBe(2);
  expect(pageOf("PDF", { kind: "video", start_ms: 0, end_ms: 5 })).toBeNull();
  expect(pageOf("TXT", { kind: "text", section: 1 })).toBeNull();
  expect(pageOf("PDF", { page: 0 })).toBeNull();
  expect(pageOf("PDF", undefined)).toBeNull();
});

test("sayfalar yalnızca kayıtlı olaylara göre işaretlenir, dokunulmayanlar listelenir", () => {
  const r = buildCoverage([pdf("pdf_a", 6)], {
    asked: [{ material_id: "pdf_a", page: 2 }, { material_id: "pdf_a", page: 2 }, { material_id: "pdf_a", page: 5 }],
    practiced: [{ material_id: "pdf_a", page: 5 }, { material_id: "pdf_a", page: 3 }],
  });
  const m = r.materials[0];
  expect(m.page_count).toBe(6);
  expect(m.touched_count).toBe(3);
  expect(m.untouched_pages).toEqual([1, 4, 6]);
  expect(m.pages.find((p) => p.page === 2)).toEqual({ page: 2, asked: true, studied: false, practiced: false });
  expect(m.pages.find((p) => p.page === 5)).toEqual({ page: 5, asked: true, studied: false, practiced: true });
  expect(m.pages.find((p) => p.page === 3)).toMatchObject({ asked: false, practiced: true });
  expect(r.recorded).toEqual({ asked: true, studied: false, practiced: true });
});

test("başka materyalin olayı karışmaz; video atlanır; sayfa sayısı dışındaki sayfa sayılmaz", () => {
  const r = buildCoverage(
    [pdf("pdf_a", 3), pdf("pdf_b", 3), { id: "video_v", source_id: "v", kind: "VIDEO", title: "v", page_count: null }],
    { asked: [{ material_id: "pdf_b", page: 1 }, { material_id: "pdf_a", page: 99 }], practiced: [] },
  );
  expect(r.materials.map((m) => m.material_id)).toEqual(["pdf_a", "pdf_b"]);
  expect(r.materials[0].touched_count).toBe(0);
  expect(r.materials[1].untouched_pages).toEqual([2, 3]);
});

test("sayfa sayısı bilinmiyorsa ve olay yoksa materyal haritaya girmez", () => {
  expect(buildCoverage([pdf("pdf_a", null)], { asked: [], practiced: [] }).materials).toEqual([]);
});

test("300 sayfalık materyal tek geçişte kurulur", () => {
  const r = buildCoverage([pdf("pdf_a", 300)], { asked: [{ material_id: "pdf_a", page: 300 }], practiced: [] });
  expect(r.materials[0].pages).toHaveLength(300);
  expect(r.materials[0].untouched_pages).toHaveLength(299);
});
