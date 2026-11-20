import { V2_PIPELINE } from "./quiz-failures";

/** The question as a student sees it before answering. Never leaks a complete source excerpt,
 *  answer key or option rationale. Shared by the legacy and v2 engines. */
export function publicQuiz(row: any) {
  const d = row.data,
    s = d.source;
  return {
    id: row.id,
    topic: row.topic,
    kind: row.kind,
    question: d.question,
    options: d.options,
    // A paraphrased objective can disclose the answer despite lexical checks.
    // Keep detailed objectives server-side until the student has answered.
    objective: null,
    note: d.note,
    experimental: d.experimental,
    assessment: d.assessment,
    question_style: d.question_style || "CONCEPTUAL",
    scope: d.scope,
    watched_only: d.watched_only || false,
    quality_state: qualityState(d.quality),
    source: s
      ? {
          id: s.id,
          material_id: s.material_id,
          title: s.title,
          kind: s.kind,
          location: s.location,
        }
      : null,
  };
}

/** Stored quizzes keep the label of the engine that wrote them. */
export function qualityState(quality: any): string {
  if (quality?.pipeline_version === V2_PIPELINE && quality?.deterministic_validation === true)
    return "SOURCE_CHECKED";
  if (quality?.option_audit_version === 3 && quality?.deterministic_source_validation)
    return "SOURCE_RECALL_CHECKED";
  if (quality?.option_audit_version === 2) return "MODEL_REVIEWED_UNVERIFIED";
  return "LEGACY_NOT_REVIEWED";
}
