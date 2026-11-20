import { ApiError } from "../common/errors";
import { AuthUser } from "../common/request-context";
import { KnowledgeService } from "../knowledge/knowledge.service";

export type QuizScopeRequest = {
  topic: string;
  scope?: any;
  watched_only?: boolean;
  material_id?: string;
};

// ── document-first source choice ────────────────────────────────────────────────
// A video's text is its automatic transcript, which carries recognition errors ("Ceva object oriented")
// into the questions. Documents (PDF, DOCX, TXT, slides, typed notes) come first; a transcript is used only
// when the scope has no ready document or the student chose the video on purpose.

/** Material ids are "pdf_…", "file_…" or "video_…" (KnowledgeService.materials). */
export const isTranscriptId = (id: unknown): boolean => typeof id === "string" && id.startsWith("video_");
const isTranscript = (m: { kind?: string; id?: string }) => m.kind === "VIDEO" || isTranscriptId(m.id);

export const DOCUMENTS_ONLY_MISSING =
  "Bu konu ders belgelerinde bulunamadı. Videodan soru hazırlamak için Gelişmiş ayarlardan videoyu seçin.";
/** Exam note when the course also has videos whose transcripts were left out. */
export const DOCUMENTS_ONLY_NOTE = "Sorular ders belgelerinden hazırlandı; otomatik video transkriptleri kullanılmadı.";

/** The student asked for video text: watched-only practice, a video as the active material, or a
 *  selected scope that names a video. */
export function videoChosen(b: { scope?: any; watched_only?: boolean; material_id?: string }): boolean {
  if (b.watched_only) return true;
  if (isTranscriptId(b.material_id)) return true;
  return b.scope?.mode === "selected" && Array.isArray(b.scope.material_ids) && b.scope.material_ids.some(isTranscriptId);
}

/**
 * The ready materials a quiz or exam may draw from, document first. `documentsOnly` is true when
 * transcripts were left out because ready documents exist in the scope.
 */
export function pickQuizMaterials<T extends { id: string; status: string; kind?: string }>(
  materials: T[],
  b: { scope?: any; watched_only?: boolean; material_id?: string },
): { materials: T[]; documentsOnly: boolean } {
  const ids = b.scope?.mode === "selected" && Array.isArray(b.scope.material_ids) ? new Set<string>(b.scope.material_ids) : null;
  const ready = materials.filter((m) => m.status === "READY" && (!ids || ids.has(m.id)));
  if (videoChosen(b)) return { materials: ready, documentsOnly: false };
  const documents = ready.filter((m) => !isTranscript(m));
  if (!documents.length) return { materials: ready, documentsOnly: false };
  return { materials: documents, documentsOnly: documents.length < ready.length };
}

/** Source excerpts a quiz question may be written from (at most 4), shared by both engines.
 *  Documents win over transcripts (see above). Throws VALIDATION_ERROR when nothing suitable exists,
 *  before any model is called. */
export async function findQuizSources(
  knowledge: KnowledgeService,
  u: AuthUser,
  c: string,
  b: QuizScopeRequest,
): Promise<any[]> {
  const retrieve = (scope: any) =>
    knowledge.ask(u, c, {
      question: b.topic,
      retrieve_only: true,
      scope,
      watched_only: Boolean(b.watched_only),
      ...(b.material_id
        ? { strategy: "single", active_material_id: b.material_id }
        : {}),
    });
  const found = await retrieve(b.scope);
  let evidence: any[] = found.evidence.filter(
    (e: any) =>
      !b.watched_only ||
      found.video_learning.some(
        (l: any) => l.source_id === e.id && l.state === "WATCHED",
      ),
  );
  if (!videoChosen(b) && evidence.length) {
    const documents = evidence.filter((e) => !isTranscript(e));
    if (documents.length) evidence = documents;
    else {
      // Only transcripts matched. When the scope has ready documents, ask those alone (the transcripts
      // may have filled the ranking); when the course has nothing but videos, the transcripts stay.
      const pick = pickQuizMaterials(await knowledge.materials(u, c), b);
      if (pick.documentsOnly) {
        const again = await retrieve({ mode: "selected", material_ids: pick.materials.map((m: any) => m.id) });
        evidence = again.evidence.filter((e: any) => !isTranscript(e));
        if (!evidence.length) throw new ApiError("VALIDATION_ERROR", DOCUMENTS_ONLY_MISSING);
      }
    }
  }
  const candidates = evidence.slice(0, 4);
  // A selected ready material can be relevant across languages even when the
  // text retrieval's lexical guard finds no anchor. The source-fact planner
  // still rejects unrelated topics; never bypass watched-only restrictions.
  // A selected scope that names a video is an explicit choice, so its transcript may be read here.
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
