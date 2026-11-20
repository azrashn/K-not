# Unified course knowledge — implementation journal

31 October 2026, starting at feature/video-integration / 4843afa.

## Phase 3A findings (before implementation)

PDF: DocumentsController → hashing temporary upload → Document/MySQL →
JobsService → knot_ingest page-aware extraction/chunks → configured E5/Chroma.
RagService.authorizedScope checks membership, visibility, READY and deletion;
Python performs metadata filtering and source quote checks. SourceViewer opens
real pages. This path is preserved, not replaced or re-embedded on each query.

Video: VideosController → private Video record → MomentSearch ASR/CLIP/E5 and
separate Qdrant. VideoProgress intervals persist in MySQL; VideoLearningService
compares a retrieved span with trusted intervals. New unified retrieval must
reuse transcript/timestamp artifacts and the progress classifier. Original
engine image vectors cannot be mixed with text vectors of another dimension.

PPTX/TXT: no working ingestion, slide-aware source model, retrieval or viewer
exists at baseline. Sample screens are not evidence of support.

Legacy QA is split: /courses/:id/answers (PDF) versus video-scoped answers.
No cross-material topic map or conversation isolation contract exists. The
previous narrow algorithm-name guard is not a general source quality system.

## Selected design

One additive course knowledge service in existing Nest/Python processes.
Existing PDF/video records remain authoritative adapters. New standalone
PPTX/TXT records keep extracted segments. Durable normalized text segments live
in a separate, fingerprinted Chroma collection using the existing embedder;
video frame vectors remain in their existing engine. Physical collections need
not be identical for the product to share one authorized retrieval/synthesis.

Source identity includes kind, authoritative material id, extraction version,
location and text hash. Per-request authorized manifests prevent stale/deleted
or foreign material from entering retrieval. Synchronization is incremental;
no new external service/model is required. Semantic ranking is complemented by
lexical signals and bounded cross-material evidence selection.

Watch state describes only a cited video interval. A useful PDF/PPTX can still
support an answer while the video is unwatched. Activity is not mastery.
Topic similarity and suspected conflicts are estimates, never a truth verdict.
Generative explanations remain explicitly unverified.

Implementation/tests and remaining work are recorded in IMPLEMENTATION_STATUS.md
and AI_EVALUATION_RESULTS.md. The following is the delivered local scope.

## Phase records

- 3A: source audit above, existing baseline rechecked (tests, branch, running services).
- 3B: StudyMaterial + additive migrations, original PPTX/TXT storage, typed
  normalized source projections and version identities. MATERIAL_DATA_MODEL.md.
  No destructive conversion of existing Document/Video tables. A persistent
  concept graph is not implemented.
- 3C: authenticated course knowledge/search/answers APIs, incremental E5/Chroma,
  dense/lexical gate, bounded evidence and structured source-number generation.
  Real same-question PDF/PPTX/VIDEO citations verified. This is unified text
  evidence over multiple media, not a complete visual understanding index.
- 3D: estimated cross-material term associations and small ranking bonus;
  near-identical opposite-negation warning. General semantic relationships,
  prerequisites and truth checking remain partial, not production-proven.
- 3E: per-video-source authoritative interval comparison; mixed document/video
  answers are not blocked by unwatched video. Real player observations persist.
  Bounded single-turn follow-up context is owner/course scoped and revalidated.
- 3F: default Course button opens LearningWorkspace at /ogrenme. Material list,
  viewer, shared assistant, real source navigation, private uploads/removal,
  original file download and responsive layout. Historical narrow QA routes
  remain for compatibility; they are not used by this shared retrieval service.
- 4: conditional LOCAL browser Turkish voice, start/pause/resume callbacks tested.
  Physical audio quality and a portable/offline standalone TTS engine are unmeasured.
- 5: source-bound literal cloze and review navigation, explicitly not a full
  conceptual quiz/assessment module or persistent attempt store.
- 6: real small A/B/C timing, source identity and restart/index reuse measurements;
  annotated semantic accuracy/faithfulness/recall and causal learning evaluation
  are still unmeasured. See the test results rather than feature slogans.
- 7: advanced frame/region/OCR learning remains pending. Existing extraction and
  source frame functionality is preserved in its original video UI/engine.

No third-party code or dependencies were installed for this phase. Existing
pinned pypdf, Chroma, E5 and the already installed isolated 2B model were reused;
original upstream licenses/notices were not edited. New fixture text is ours.
OpenTutor and DocsGPT source/configuration/services were left unchanged.
