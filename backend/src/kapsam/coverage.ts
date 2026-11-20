/** Kapsam haritası: yalnızca kayıtlı veriden sayfa sayımı. Tahmin, puan ya da yüzde üretmez. */

export type Touch = { asked: boolean; practiced: boolean };
export type CoverageMaterial = {
  id: string;
  source_id: string;
  kind: string;
  title: string;
  page_count: number | null;
};

/** Konum kaydı (PDF `page`, PPTX `slide`) -> sayfa numarası. Video ve metin konumlarında sayfa yoktur. */
export function pageOf(kind: string, location: any): number | null {
  const n = kind === "PDF" ? location?.page : kind === "PPTX" ? location?.slide : null;
  return Number.isSafeInteger(n) && n >= 1 && n <= 100000 ? n : null;
}

export type Events = {
  /** Sohbet yanıtlarının kaynak gösterdiği (materyal, sayfa) çiftleri. */
  asked: { material_id: string; page: number }[];
  /** Kullanıcının istediği alıştırma sorularının kaynak (materyal, sayfa) çiftleri. */
  practiced: { material_id: string; page: number }[];
};

export function buildCoverage(materials: CoverageMaterial[], events: Events) {
  const byMaterial = new Map<string, Map<number, Touch>>();
  const mark = (id: string, page: number, key: keyof Touch) => {
    const pages = byMaterial.get(id) ?? new Map<number, Touch>();
    const t = pages.get(page) ?? { asked: false, practiced: false };
    t[key] = true;
    pages.set(page, t);
    byMaterial.set(id, pages);
  };
  for (const e of events.asked) mark(e.material_id, e.page, "asked");
  for (const e of events.practiced) mark(e.material_id, e.page, "practiced");
  const out = [];
  for (const m of materials) {
    if (m.kind !== "PDF" && m.kind !== "PPTX") continue;
    const touches = byMaterial.get(m.id) ?? new Map<number, Touch>();
    const pageCount = m.page_count && m.page_count > 0 ? m.page_count : Math.max(0, ...touches.keys());
    if (!pageCount) continue;
    const pages = [];
    const untouched: number[] = [];
    let touched = 0;
    for (let page = 1; page <= pageCount; page++) {
      const t = touches.get(page);
      // `studied` (sayfa açıldı) bugün hiçbir yerde kaydedilmiyor: sayılmaz, hep false.
      pages.push({ page, asked: !!t?.asked, studied: false, practiced: !!t?.practiced });
      if (t) touched++;
      else untouched.push(page);
    }
    out.push({
      material_id: m.id,
      source_id: m.source_id,
      kind: m.kind,
      title: m.title,
      page_count: pageCount,
      touched_count: touched,
      pages,
      untouched_pages: untouched,
    });
  }
  return {
    materials: out,
    recorded: { asked: true, studied: false, practiced: true },
  };
}
