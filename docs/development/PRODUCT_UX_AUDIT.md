# Product UX audit — d2d6c3d baseline

Implementation outcome: see PRODUCT_TEST_REPORT.md and PRODUCT_LOCAL_SETUP.md.
The baseline findings below are historical, not the current feature status.

Current: real Home/Courses/Quiz/Analytics, original PDF/PPTX visual viewer,
separate source/chat scrolling, collapsible assistant, visible local voice
controls, saved user/course conversations and quiz attempts, source-linked
review loop. Explicit personal-course deletion was tested in Edge against only
its own disposable test data. Pre-existing demo courses are preserved.

Partial: original visuals do not imply visual AI recognition; model MCQ quality,
short/open assessment and topic mastery remain limited. In-place replacement,
successful-source reprocess, streaming and measured TTS quality are remaining
work. The planned teaching board is documented separately, not implemented.

31 October 2026. Repository verified on feature/video-integration. Existing
user-owned .agents/.codex/AGENTS files remain untouched. Reference images guide
hierarchy and the learning loop; they are not layouts to copy pixel for pixel.

## Findings before redesign

- Home.jsx: SampleNotice and hardcoded course/exam/activity; no real dashboard.
- Courses.jsx / CoursesController: read-only membership list, no creation/edit/
  delete/archive. Repeated test courses are real records, not disposable placeholders.
  They must not be automatically removed. Ready counts cover PDF only.
- CourseDetail: real PDF management and working video route, but fragmented entry.
- LearningWorkspace: shared real retrieval and media observations work. Long
  source/transcript lists overwhelm the viewer, chat grows as cards, no bounded
  scrolling/collapse. One input hides upload distinctions and link import.
- PDF: source snippets + download; no original page viewer in the shared surface.
- PPTX: actual slide-aware text/notes + original file; no visual rendering.
- Conversation: 128/10min RAM receipts and frontend turns, lost after restart/reload.
- Quiz: source cloze in workspace; main Quiz screen uses sample state.
- Analytics: sample data; not backed by saved attempts or real learning activity.
- Voice: real local browser speech, but controls too low and no visible stop action.
- Access: course/member/private-owner checks exist and must remain authoritative.
- Navigation: existing routes work, but mock course shortcuts do not represent a
  continuous real user workflow. Real data should drive next actions.

## Implementation direction

Retain Nest/MySQL, Python/Chroma, MomentSearch and React19/Tailwind4. Add only
additive persistence and a small isolated office-renderer tool. Personal-course
ownership and per-user archive protect legacy shared/demo courses. No automated
demo cleanup. Delete must be explicit, retryable and not affect other owners.

Use a neutral academic surface, Geist headings, a cobalt action accent, compact
source badges, and distinct scrollable material/assistant surfaces. Keep original
material central. Expose searched/found/used sources separately. Saved chat,
assessment and observed activity feed real Home/Analytics and resume navigation.

## Baseline verification

Code/route audit completed before design edits. Latest prior evidence: 724
regressions + PDF browser16 steps in AI_EVALUATION_RESULTS.md. These numbers
are historical until rerun in this phase. Browser audit screenshots and final
new-user workflow results will be stored under ignored data/product-tests;
no student source screenshots or account secrets are committed.

## Renderer decision and license

LibreOffice is absent on the host. Use an isolated Docker tool built from
official Debian repositories; no global Office/Python/Node installation.
LibreOffice headless PDF conversion preserves original slide composition;
it is not OCR or visual understanding. Font/animation/media differences remain
possible. See [LibreOffice CLI](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html)
and [licenses](https://www.libreoffice.org/licenses/). LibreOffice MPL2/LGPL3+
and Debian font/package notices remain in the image. Existing Poppler renders
PDF pages. No third-party application code is copied and no paid API is enabled.
