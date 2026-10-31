import { ApiError, notFound } from "../common/errors";

export interface ScopeInput {
  mode: "course" | "active" | "selected";
  material_ids?: string[];
}
export interface ViewportInput {
  kind: "page" | "slide" | "video";
  page?: number;
  slide?: number;
  timestamp_ms?: number;
  selected_text?: string;
  region?: { x: number; y: number; width: number; height: number };
}
export function resolveScope<T extends { id: string; status: string }>(
  materials: T[],
  active?: string,
  scope?: ScopeInput,
): T[] {
  if (active && !materials.some((m) => m.id === active))
    throw notFound("Active material");
  const mode = scope?.mode || "course";
  const ids =
    mode === "active"
      ? [active]
      : mode === "selected"
        ? scope?.material_ids
        : undefined;
  if (ids && (!ids.length || ids.some((id) => !id)))
    throw new ApiError(
      "VALIDATION_ERROR",
      "Arama için en az bir kaynak seçin.",
    );
  if (mode === "selected" && !ids?.length)
    throw new ApiError("VALIDATION_ERROR", "Seçili kaynak kapsamı boş olamaz.");
  if (ids?.some((id) => !materials.some((m) => m.id === id)))
    throw notFound("Selected material");
  if (ids?.some((id) => materials.find((m) => m.id === id)?.status !== "READY"))
    throw new ApiError(
      "DOCUMENT_NOT_READY",
      "Seçilen kaynak henüz hazır değil.",
    );
  return materials.filter(
    (m) => m.status === "READY" && (!ids || ids.includes(m.id)),
  );
}
export function validateViewport(
  m: { kind: string; row: any } | undefined,
  v?: ViewportInput,
) {
  if (!v) return;
  if (!m)
    throw new ApiError(
      "VALIDATION_ERROR",
      "Görünüm bağlamı için aktif materyal gereklidir.",
    );
  const valid =
    m.kind === "PDF"
      ? v.kind === "page" &&
        Number.isInteger(v.page) &&
        v.page! >= 1 &&
        v.page! <= m.row.pageCount
      : m.kind === "PPTX"
        ? v.kind === "slide" &&
          Number.isInteger(v.slide) &&
          v.slide! >= 1 &&
          v.slide! <=
            Math.max(...m.row.segments.map((s: any) => s.location?.slide || 1))
        : m.kind === "VIDEO"
          ? v.kind === "video" &&
            Number.isSafeInteger(v.timestamp_ms) &&
            v.timestamp_ms! >= 0 &&
            (!m.row.durationMs || v.timestamp_ms! <= m.row.durationMs)
          : false;
  if (!valid)
    throw new ApiError(
      "VALIDATION_ERROR",
      "Açık sayfa, slayt veya zaman materyalle eşleşmiyor.",
    );
  if (
    v.region &&
    (v.region.width <= 0 ||
      v.region.height <= 0 ||
      v.region.x < 0 ||
      v.region.y < 0 ||
      v.region.x + v.region.width > 1.001 ||
      v.region.y + v.region.height > 1.001)
  )
    throw new ApiError(
      "VALIDATION_ERROR",
      "Görsel bölge görüntünün içinde olmalıdır.",
    );
}
export function inViewport(location: any, v: ViewportInput) {
  return v.kind === "page"
    ? location.kind === "page" && location.page === v.page
    : v.kind === "slide"
      ? location.kind === "slide" && location.slide === v.slide
      : location.kind === "video" &&
        location.start_ms <= v.timestamp_ms! &&
        v.timestamp_ms! < location.end_ms;
}
