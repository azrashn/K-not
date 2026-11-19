// Ported by hand from origin/feature/quiz-quality-overhaul (Fatih).
import type { AuthUser } from "../common/request-context";
import type { KnowledgeService } from "../knowledge/knowledge.service";

export type SourceText = { title: string; text: string };

/** Text of the ready materials in scope (bounded). Used to pick answerable topics and to see
 *  whether the sources contain code. An unreadable material only contributes nothing. */
export async function loadSourceTexts(
  knowledge: KnowledgeService,
  u: AuthUser,
  c: string,
  scope: any,
): Promise<SourceText[]> {
  const materials = (await knowledge.materials(u, c)).filter((m: any) => m.status === "READY");
  const ids = scope?.mode === "selected" && Array.isArray(scope.material_ids) ? new Set<string>(scope.material_ids) : null;
  const out: SourceText[] = [];
  for (const m of materials.filter((m: any) => !ids || ids.has(m.id)).slice(0, 8)) {
    try {
      const p = await knowledge.preview(u, c, m.id);
      for (const seg of (p.segments || []).slice(0, 400)) if (seg.text?.trim()) out.push({ title: m.title, text: String(seg.text).slice(0, 2000) });
    } catch {
      /* an unreadable material only gives no topics */
    }
  }
  return out;
}
