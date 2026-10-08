# Architecture Decision Record (WBS-1)

**Review:** 2026-10-07, by the project lead.
- **Approved:** A1, A2, A3, A4, A5, A6, A8.
- **Approved conditionally:** A7 and A9, with the refinements below (all incorporated).

**Status values:**
- `ACCEPTED`: in force.
- `ACCEPTED (conditional)`: in force, with listed obligations.
- `PROVISIONAL`: in force until validated.
- `DEFERRED`: not in Phase 1.

## 1. Decision log

| ID | Decision | Status | Approval | Details |
| --- | --- | --- | --- | --- |
| ADR-001 | Browser → NestJS → Python; Python, ChromaDB, MySQL and `/internal/*` routes are private; no service credentials in the browser | ACCEPTED | proposal D1 | [system-overview.md §3](system-overview.md#3-architecture) |
| ADR-002 | Admin-seeded shared courses with memberships (`STUDENT`/`INSTRUCTOR`); no course-management UI | ACCEPTED | A1 | [data-model.md](data-model.md) |
| ADR-003 | Visibility `PRIVATE`/`COURSE`; only instructors upload COURSE materials; student uploads are PRIVATE; no visibility change in Phase 1 | ACCEPTED | A2 | [api-contracts.md §5](api-contracts.md#5-authorized-scope-derivation) |
| ADR-004 | Phase 1 accepts **PDF only** (`%PDF-` magic check, ≤ 30 MB, ≤ 400 pages). The frontend `accept` attribute must change (WBS-5). | ACCEPTED | A3 | [api-contracts.md §3.2](api-contracts.md#32-documents) |
| ADR-005 | Source viewer shows **extracted page text** (`pages.v1` artifact) with code-point offsets; original PDF available for download. Layout is not reproduced; no layout coordinates are ever produced. | ACCEPTED | A4 | [document-contract.md §7, §10](document-contract.md#7-pageartifact) |
| ADR-006 | **C-1:** the Chroma collection stamp carries the full `EmbeddingConfiguration` and fingerprint; the WBS-3 reader verifies it; `/ready` reports it. Additive. | ACCEPTED, **not yet implemented** (§2) | A5 | §2 |
| ADR-007 | `ChromaChunkWriter` (write path) is owned by WBS-2; the reader `ChromaChunkIndex` stays with WBS-3; contract files are shared | ACCEPTED | A6 | [module-boundaries.md §3](module-boundaries.md#3-shared-contract-code-wbs-1-custodian) |
| ADR-008 | Reindex = delete-before-replace; the document is out of scope until READY; documented consequences; throttled bulk reindex. Version-filtered "keep old live" reindex DEFERRED. | ACCEPTED (conditional) | A7 | [document-lifecycle.md §7](document-lifecycle.md#7-reindexing-same-embedding-configuration) |
| ADR-009 | Ingestion is a separate package in the same Python deployable, with a **bounded in-process worker** and authenticated, sequenced, idempotent callbacks. MySQL is authoritative; sweeper for stalls; fencing via `activeJobId`. **Bounded MVP solution, not a durable queue.** | ACCEPTED (conditional) | A9 | [document-lifecycle.md §4](document-lifecycle.md#4-in-process-worker-reliability) |
| ADR-010 | Embedding model `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, 384-d, no prefixes, normalized, cosine; revision unpinned | **PROVISIONAL** | A8 | §3 |
| ADR-011 | MySQL is authoritative for identity, access and status; ChromaDB is a derived, rebuildable index; storage holds originals and page artifacts | ACCEPTED | proposal D3 | [data-model.md §1](data-model.md#1-where-data-lives) |
| ADR-012 | Titles and filenames shown to users come from MySQL (NestJS `documents` map); the Chroma `document_title` copy may lag; no rename in Phase 1 | ACCEPTED | proposal I7 | [api-contracts.md §3.4](api-contracts.md#34-answers) |
| ADR-013 | Two version levels: `IndexVersion` (collection + embedding configuration) and `indexing_version` (extraction/chunker); existing field names kept | ACCEPTED | proposal D4 | [document-contract.md §5](document-contract.md#5-two-version-levels) |
| ADR-014 | Duplicate detection with a nullable `activeContentHash` and `UNIQUE(courseId, ownerId, activeContentHash)`; set to NULL on soft delete; the constraint, not a pre-check, resolves races | ACCEPTED | review item 4 | [data-model.md §4](data-model.md#4-duplicate-uploads-with-soft-deletion) |
| ADR-015 | Embedding change = blue/green collections; the old collection is untouched until the new one is verified and activated, then kept for rollback | ACCEPTED | review item 1 | [document-lifecycle.md §8](document-lifecycle.md#8-embedding-model-change-bluegreen-migration) |
| ADR-016 | Offsets are Unicode code points over the NFC document text = pages joined by `"\n\n"`; pages are 1-based physical indices | ACCEPTED | review item 3 | [document-contract.md §1](document-contract.md#1-conventions-apply-to-every-contract) |
| ADR-017 | One error envelope (WBS-3 `ErrorResponse` shape) for all APIs; public codes are mapped from Python codes | ACCEPTED | proposal I11 | [api-contracts.md §7](api-contracts.md#7-error-codes) |
| ADR-018 | Every chunk is tagged `x_job_id` (existing `x_` extension); read-back verification before `SUCCEEDED` | ACCEPTED | review item 2 | [document-lifecycle.md §4.4](document-lifecycle.md#44-defences-against-duplicate-execution-layered) |
| ADR-019 | Canonical document role = WBS-3 `DocumentType` (`slide/notes/textbook/past_exam/other`); file format = `mime_type`; frontend labels mapped by WBS-5 | ACCEPTED | proposal I1 | [document-contract.md §9](document-contract.md#9-public-document-status-indexingstatus-as-seen-by-the-frontend) |
| ADR-020 | Status updates by polling (3 s) in Phase 1; no WebSockets | ACCEPTED | — | [api-contracts.md §1](api-contracts.md#1-common-rules) |

**Superseded guidance:** where `docs/rag-integration.md` (WBS-2/WBS-4 sections and its
suggested Prisma models) differs from this folder, this folder wins. That file now links
here.

## 2. C-1 — additive WBS-3 change (approved A5; specification only)

C-1 is **not** implemented on the WBS-1 branch. It is delivered as its own PR on a WBS-3
branch, reviewed by WBS-2 (writer side) and WBS-3 (reader side).

| Part | Change | Owner |
| --- | --- | --- |
| Embedding config | Add an `EmbeddingConfiguration` value object (backend, model, revision, dimension, query_prefix, document_prefix, normalize, distance) with `fingerprint()` exactly as in [document-contract.md §4](document-contract.md#4-embeddingconfiguration); built from existing `Settings` fields | WBS-3 |
| Writer stamp | `ChromaChunkWriter.ensure_collection()` writes the existing keys plus `embedding_backend`, `embedding_revision` (`""` for none), `embedding_query_prefix`, `embedding_document_prefix`, `embedding_normalize`, `embedding_fingerprint`, `index_version_id` (optional argument) | WBS-2 |
| Reader check | `ChromaChunkIndex._check_compatibility()`: if `embedding_fingerprint` is present it must equal the reader's, else `ConfigurationError`. If absent (legacy collection): keep today's model + dimension check and log `rag.index.legacy_stamp`. | WBS-3 |
| Readiness | `GET /ready` adds `"index": {"collection", "embedding_fingerprint", "index_version_id"}`; existing fields unchanged | WBS-3 |

**Required tests:**
1. Stamp round-trip.
2. A mismatch in revision, prefix or normalization raises `ConfigurationError`. Today it
   passes silently.
3. A legacy collection with only model and dimension is still readable.
4. The fingerprint is stable across processes and equals the documented example.
5. `/ready` exposes the fingerprint.
6. All existing WBS-3 tests pass. API schemas are unchanged.

**Compatibility:** collection metadata readers ignore unknown keys, so existing collections
and clients keep working.

## 3. ADR-010 — embedding model selection procedure (pre-registered)

**Status: PROVISIONAL.**
- Hugging Face access was verified in a separate team environment.
- The model has **not** been benchmarked on K-not data, and no benchmark is run in WBS-1.

The procedure below is fixed **before** any results are seen:

1. **Candidates:** `ai-service/evaluation/embedding_candidates.json`: MiniLM-L12-multi
   (current), mpnet-base-multi, multilingual-e5-small/base (with `query: `/`passage: `),
   bge-m3, and a Turkish BERT control.
2. **Data:**
   - Primary: the locked `challenge.v1` set (41 questions: Turkish 20, English 12,
     mixed 9; commit `7bc6bb0` on `feature/rag-core-pipeline`).
   - Secondary: `eval.v2`.
   - No rule or threshold is tuned on `challenge.v1`.
3. **Harness:** the existing `python -m knot_rag.evaluation.compare_embeddings`. It records
   the resolved model commit, so the revision gets pinned.
4. **Hard requirements:**
   - Zero scope leakage.
   - License allows academic use.
   - Model RAM ≤ 2 GB and CPU query latency p95 ≤ 200 ms on a 4-core machine without a GPU.
5. **Primary metric:** in-scope retrieval success (gold passage in top-8) on `challenge.v1`,
   reported separately for Turkish, English, mixed and paraphrase questions. The model must
   beat the hashing baseline on the mixed and paraphrase categories.
6. **Secondary metrics:** MRR, Recall@1/3, top-1-score separation of out-of-scope questions
   (the Dijkstra and near-topic items).
7. **Tie rule:** within 0.03 on the primary metric, choose the smaller and faster model.
8. **Recording:**
   - Fill `EmbeddingConfiguration` (with the pinned `revision`) in a new `IndexVersion`.
   - Update this ADR to `ACCEPTED` with the measured numbers.
   - If the model differs from the provisional one, migrate via ADR-015.

## 4. Validation record

Run on `feature/wbs-1-architecture` on 2026-10-08. Result: **60 checks passed, 0 failed.**

| Check | Result |
| --- | --- |
| 14 tagged contract examples (13 types) are valid JSON | pass |
| `DocumentMetadata`, `IndexedChunk`, `RetrieveRequest`, `RetrievedEvidence`, `Citation`, `GroundedAnswer`, `ErrorResponse` examples parse with the **existing** WBS-3 Pydantic models | pass |
| `ChromaMetadata` example equals `IndexedChunk.to_chroma_metadata()`; every WBS-3 `META_*` key is present; `x_job_id` uses the existing `x_` prefix | pass |
| PageArtifact: pages 1..n without gaps, lengths, `"\n\n"` separator rule, NFC | pass |
| `chunk.text == document_text[char_start:char_end]`; page range matches offsets | pass |
| Citation highlight equals the quote in chunk, document and page-relative (95–112, page 3) coordinates | pass |
| Documented label `Slayt · s.2–3` equals WBS-3 `citation_label()` output | pass |
| `EmbeddingConfiguration` fields; fingerprint recomputed; consistent in job request and `SUCCEEDED` event | pass |
| Job request `document` validates as WBS-3 `DocumentMetadata` | pass |
| `IngestionEvent` (2 examples) fields and enums; `DocumentDto` status mapping | pass |
| Enums consistent across documents (`DocumentStatus`, `JobStatus`); every ingestion error code in the handoff is defined in the lifecycle table; every public code used in §3 is declared; every WBS-3 `ErrorCode` has a public mapping | pass |
| Referenced existing WBS-3 env vars exist in `config.py`; claim "`ChromaChunkWriter.upsert` embeds internally" verified against the code | pass |
| All relative links and anchors in `docs/architecture/*` and `docs/rag-integration.md` resolve | pass |
| 6 Mermaid blocks use known diagram types (syntax not rendered) | pass |
| Existing `ai-service` test suite; no code changed on this branch | 170 passed |

- **Validator sensitivity:** a negative test with four injected faults (a shifted offset, a
  broken anchor, an undefined error code, and the consequent offset mismatch) failed exactly
  those 4 checks.
- **Not committed:** the validator is a session script, because WBS-1 commits documentation
  only. WBS-10 should add it as a CI contract test.

## 5. Risks

| # | Risk | Impact | Mitigation / owner |
| --- | --- | --- | --- |
| R1 | Embedding model not validated (ADR-010) | Retrieval quality unknown; Turkish/mixed questions may underperform | Run the pre-registered procedure before the integration milestone (WBS-3/8) |
| R2 | In-process worker loses queued jobs on restart | Up to ~5 min + backoff delay; re-embedding cost | Sweeper + idempotent jobs; replace with a persistent queue after the MVP (ADR-009) |
| R3 | Reindex makes documents temporarily unavailable; a failed reindex leaves no chunks | Q&A gaps during reindex | Throttling, retries, stored excerpts (ADR-008) |
| R4 | C-1 not yet implemented: revision/prefix drift between writer and reader goes undetected | Silently degraded retrieval | Implement C-1 before WBS-2 indexes real data; until then the guard compares the model name only |
| R5 | PDF extraction quality (Turkish characters, ligatures, columns, hyphenation) | Wrong offsets or retrieval misses | Determinism rules, Turkish fixture tests (T2), extractor pinned (WBS-2) |
| R6 | Two embedding models in memory during migration; CPU embedding throughput unmeasured | Out-of-memory, slow indexing | Concurrency 1, batch size configurable; measure in WBS-2 tests |
| R7 | Offsets are code points; JavaScript uses UTF-16 | Highlight shifts on non-BMP characters | Code-point slicing documented (document-contract §10); WBS-5 test with `𝑛` |
| R8 | Local storage and single-node Chroma | Single host; no redundancy | Acceptable for MVP; `Storage` interface allows object storage later |
| R9 | Stored answers keep excerpts of deleted documents | Privacy | Unresolved U6 |
| R10 | LLM provider not chosen | Answer quality unmeasured | Unresolved U2 |
| R11 | Frontend changes (types, `accept`, citations, page viewer) not yet done | Integration slip | WBS-5 tasks listed in §6 |

## 6. Unresolved team decisions

| # | Decision | Recommendation | Blocking? |
| --- | --- | --- | --- |
| U1 | Authentication mechanism (JWT details, registration vs. seed only) | E-mail + password, JWT bearer, accounts seeded for the demo | Not for WBS-2; blocks WBS-4/5 |
| U2 | LLM provider (hosted API vs. local) and credentials | Decide with a data-protection note for student documents | Not for WBS-2 |
| U3 | Final embedding model + revision (ADR-010) | Run the procedure in §3 | Not for WBS-2 code (config-driven); blocks "accepted" quality claims |
| U4 | PDF extraction library and chunk parameters within the bounds | WBS-2 proposes, records an ADR entry | Inside WBS-2 |
| U5 | Deployment topology (docker-compose: MySQL, Chroma, ai-service, NestJS, shared volume) | WBS-9 | Not for WBS-2 development |
| U6 | Redaction of stored answer excerpts after document deletion | Redact on delete for PRIVATE documents | No |
| U7 | Upload limits (30 MB / 400 pages) | Confirm with real course PDFs | No |
| U8 | Whether students may later share documents with the course | DEFERRED to Phase 2 (needs moderation) | No |

**WBS-5 (frontend) follow-ups implied by these contracts** (no frontend code was changed in
WBS-1):
- Upload `accept=".pdf"`.
- `document_type` labels (adds "Kitap"/"Belge").
- Material `id` = `document_id`.
- Citation `seg` → `chunk_id` + `highlight`.
- Page viewer backed by `GET /documents/:id/pages/:page`.
- Status polling.
