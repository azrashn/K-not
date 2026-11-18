import { ApiError } from "../common/errors";
import { AuthUser } from "../common/request-context";
import { KnowledgeService } from "../knowledge/knowledge.service";

export type QuizScopeRequest = {
  topic: string;
  scope?: any;
  watched_only?: boolean;
  material_id?: string;
};

/** Source excerpts a quiz question may be written from (at most 4), shared by both engines.
 *  Throws VALIDATION_ERROR when nothing suitable exists, before any model is called. */
export async function findQuizSources(
  knowledge: KnowledgeService,
  u: AuthUser,
  c: string,
  b: QuizScopeRequest,
): Promise<any[]> {
  const found = await knowledge.ask(u, c, {
    question: b.topic,
    retrieve_only: true,
    scope: b.scope,
    watched_only: Boolean(b.watched_only),
    ...(b.material_id
      ? { strategy: "single", active_material_id: b.material_id }
      : {}),
  });
  const candidates = found.evidence
    .filter(
      (e: any) =>
        !b.watched_only ||
        found.video_learning.some(
          (l: any) => l.source_id === e.id && l.state === "WATCHED",
        ),
    )
    .slice(0, 4);
  // A selected ready material can be relevant across languages even when the
  // text retrieval's lexical guard finds no anchor. The source-fact planner
  // still rejects unrelated topics; never bypass watched-only restrictions.
  if (!candidates.length && !b.watched_only &&
      b.scope?.mode === "selected" && b.scope.material_ids?.length) {
    const materials = await knowledge.materials(u, c);
    for (const id of b.scope.material_ids.slice(0, 4)) {
      const m = materials.find((m: any) => m.id === id && m.status === "READY");
      if (!m) continue;
      const preview = await knowledge.preview(u, c, id);
      for (const segment of preview.segments) {
        if (!segment.text?.trim()) continue;
        candidates.push({...segment, material_id:m.id, version:m.version,
                         title:m.title, kind:m.kind});
        if (candidates.length >= 4) break;
      }
      if (candidates.length >= 4) break;
    }
  }
  if (!candidates[0])
    throw new ApiError(
      "VALIDATION_ERROR",
      b.watched_only
        ? "Bu konuda tamamen izlenmiş video bölümü bulunamadı. Son oynatma konumu tek başına izleme kanıtı değildir."
        : "Bu konuda soru hazırlamaya uygun kaynak bulunamadı.",
    );
  return candidates;
}
