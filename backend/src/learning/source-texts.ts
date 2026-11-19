// Ported by hand from origin/feature/quiz-quality-overhaul (Fatih).
import type { AuthUser } from "../common/request-context";
import type { KnowledgeService } from "../knowledge/knowledge.service";
import { pickQuizMaterials } from "./quiz-sources";

export type SourceText = { title: string; text: string };

/** Text of the ready materials in scope (bounded), documents first: transcripts only count when the
 *  scope has no ready document or names a video (pickQuizMaterials). Used to pick answerable topics.
 *  An unreadable material only contributes nothing. `documentsOnly` says transcripts were left out. */
export async function loadSourceTexts(
  knowledge: KnowledgeService,
  u: AuthUser,
  c: string,
  scope: any,
): Promise<{ texts: SourceText[]; documentsOnly: boolean }> {
  const pick = pickQuizMaterials(await knowledge.materials(u, c), { scope });
  const texts: SourceText[] = [];
  for (const m of pick.materials.slice(0, 8)) {
    try {
      const p = await knowledge.preview(u, c, m.id);
      for (const seg of (p.segments || []).slice(0, 400)) if (seg.text?.trim()) texts.push({ title: m.title, text: String(seg.text).slice(0, 2000) });
    } catch {
      /* an unreadable material only gives no topics */
    }
  }
  return { texts, documentsOnly: pick.documentsOnly };
}
