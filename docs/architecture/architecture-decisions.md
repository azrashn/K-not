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
| ADR-006 | **C-1:** the Chroma collection stamp carries the full `EmbeddingConfiguration` and fingerprint; the WBS-3 reader verifies it; `/ready` reports it. Additive. | ACCEPTED, **implemented** on `feature/document-ingestion` (§2) | A5 | §2 |
| ADR-007 | `ChromaChunkWriter` (write path) is owned by WBS-2; the reader `ChromaChunkIndex` stays with WBS-3; contract files are shared | ACCEPTED | A6 | [module-boundaries.md §3](module-boundaries.md#3-shared-contract-code-wbs-1-custodian) |
| ADR-008 | Reindex = delete-before-replace; the document is out of scope until READY; documented consequences; throttled bulk reindex. Version-filtered "keep old live" reindex DEFERRED. | ACCEPTED (conditional) | A7 | [document-lifecycle.md §7](document-lifecycle.md#7-reindexing-same-embedding-configuration) |
| ADR-009 | Ingestion is a separate package in the same Python deployable, with a **bounded in-process worker** and authenticated, sequenced, idempotent callbacks. MySQL is authoritative; sweeper for stalls; fencing via `activeJobId`. **Bounded MVP solution, not a durable queue.** | ACCEPTED (conditional) | A9 | [document-lifecycle.md §4](document-lifecycle.md#4-in-process-worker-reliability) |
| ADR-010 | **MVP embedding model: `intfloat/multilingual-e5-small`**, revision `614241f622f53c4eeff9890bdc4f31cfecc418b3`, 384-d, `query: `/`passage: ` prefixes, normalized, cosine (selected by the §3 procedure on 2026-10-08; replaces the unvalidated MiniLM-L12 default) | **ACCEPTED (provisional for the MVP)** | A8 | §3 |
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
| ADR-021 | PDF extraction with **pypdf 6.17.0** (BSD), pinned exactly; startup refuses another version, because extracted text is part of `indexing_version` `c1` | ACCEPTED (WBS-2) | U4 | §7 |
| ADR-022 | `c1` text rules: NFC, explicit ligatures, whitespace rules, lowercase-continuation de-hyphenation; **no header/footer removal** | ACCEPTED (WBS-2) | U4 | §7 |
| ADR-023 | `c1` chunking: prose packed to ≤ 1,200 characters (splits leave ≥ 800), hard max 1,500, minimum 20; overlap ≤ 150 characters from a sentence/line start for prose, **none for slides** | ACCEPTED (WBS-2) | U4 | §7 |
| ADR-024 | `section_title` = first line of the slide page (≤ 300 characters); prose chunks have none in `c1` | ACCEPTED (WBS-2) | U4 | §7 |

**Superseded guidance:** where `docs/rag-integration.md` (WBS-2/WBS-4 sections and its
suggested Prisma models) differs from this folder, this folder wins. That file now links
here.

## 2. C-1 — additive WBS-3 change (approved A5; specification only)

C-1 is **not** implemented on the WBS-1 branch. It was delivered as its own commit at the
start of `feature/document-ingestion` (WBS-2), for review by WBS-2 (writer side) and WBS-3
(reader side). Implementation: `knot_rag/schemas/embedding.py` (configuration, fingerprint,
stamp), `ChromaChunkWriter`/`ChromaChunkIndex` (`retrieval/chroma_index.py`), `GET /ready`
(`index` object, plus `stamp: "full" | "legacy"`). Tests: `tests/integration/test_c1_stamp.py`.

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

### 3.1 Result (2026-10-08)

Full report: [rag-evaluation.md §4.7](../rag-evaluation.md#47-adr-010-real-model-evaluation-on-challengev1-2026-10-08).
Candidates run: hashing control, MiniLM-L12-multi (provisional default) and e5-small. The
other candidates were not run.

| | Hashing | MiniLM `e8f8c21…` | **e5-small `614241f…`** |
| --- | --- | --- | --- |
| R@8 (primary), overall / TR / EN / mixed | 0.76 / 1.00 / 0.50 / 0.57 | 0.91 / 0.81 / 1.00 / 1.00 | **0.94 / 1.00 / 0.90 / 0.86** |
| R@8, paraphrase (n = 7) | 0.86 | 0.86 (does not beat hashing) | **1.00** |
| R@1 / R@3 / R@5 / MRR | 0.42 / 0.67 / 0.73 / 0.54 | 0.52 / 0.76 / 0.82 / 0.65 | **0.58 / 0.85 / 0.91 / 0.72** |
| Leakage · p95 latency · max RSS | 0 · 0.4 ms · 0.1 GB | 0 · 19.5 ms · 1.8 GB | 0 · 19.8 ms · 1.4 GB |

**Decision:** e5-small is the MVP embedding model.
- It is the only real candidate that passes every hard requirement and both "beats hashing"
  gates; MiniLM ties hashing on paraphrase.
- It leads on the primary metric overall, on Turkish (the primary course language) and on
  paraphrase.
- The tie rule does not reverse this: the two models are the same size class (384-d, about
  118 M parameters) with equal latency.

**MVP configuration** (`EmbeddingConfiguration`, fingerprint
`sha256:7858637ffe512d13b894af08f99e75f8f42be36c457e2e02192bacdfd6671616`):

```json
{"backend": "sentence_transformers", "model": "intfloat/multilingual-e5-small",
 "revision": "614241f622f53c4eeff9890bdc4f31cfecc418b3", "dimension": 384,
 "query_prefix": "query: ", "document_prefix": "passage: ", "normalize": true, "distance": "cosine"}
```

- **Normalization and distance:** checked, not assumed.
  - Stored vectors have L2 norm 1.0, because `SentenceTransformerEmbedder` always encodes with
    `normalize_embeddings=True`.
  - Collections are created with `hnsw:space = cosine`.
  - These are the only values the embedders support (`EmbeddingConfiguration.unsupported_reason`).
- **Prefixes:** `"query: "` and `"passage: "` include the trailing space, as the model card and
  `embedding_candidates.json` specify.
- **Where it is configured:** the deployment values (`.env.example`) and the first
  `IndexVersion` that NestJS seeds (WBS-4).
  - The Python code default in `config.py` stays MiniLM on purpose. Changing it would silently
    change the model and prefixes of any environment that relies on the default.
  - A deployment whose `EMBEDDING_*` disagrees with the ACTIVE `IndexVersion` is refused by
    the C-1 fingerprint check and the `/ready` consistency guard.
- **No index migration is needed:** no production data has been indexed with MiniLM.

**Caveats:**
- n is small: 33 in-scope questions, 7–16 per language.
- Gold labels have not been independently reviewed.
- Weaker on English-only questions: EN R@1 is 0.40, against 0.70 for MiniLM.
- Similarity scores do not separate out-of-scope questions, so `RAG_MIN_SCORE` stays unset.
- LLM answer quality is untested.

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
| R1 | Embedding model validated on only 33 in-scope questions with unreviewed gold labels (ADR-010) | English-only questions are weaker (EN R@1 0.40); similarity cannot reject out-of-scope questions | Independent label review; grow `challenge` with real course PDFs; out-of-scope rejection stays with WBS-3 grounding |
| R2 | In-process worker loses queued jobs on restart | Up to ~5 min + backoff delay; re-embedding cost | Sweeper + idempotent jobs; replace with a persistent queue after the MVP (ADR-009) |
| R3 | Reindex makes documents temporarily unavailable; a failed reindex leaves no chunks | Q&A gaps during reindex | Throttling, retries, stored excerpts (ADR-008) |
| R4 | ~~C-1 not yet implemented~~ **Resolved:** C-1 implemented on `feature/document-ingestion`; drift now raises `ConfigurationError` | — | Legacy (pre-C-1) collections are still read with the model/dimension check only and log `rag.index.legacy_stamp`; re-create them before production use |
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
| U1 | ~~Authentication mechanism~~ **Decided (WBS-4, 2026-10-08):** seed-only accounts; e-mail + password with Argon2id; HS256 access JWT (1 h) as `Authorization: Bearer`; no refresh tokens; login rate limit (§8) | — | Resolved |
| U2 | LLM provider (hosted API vs. local) and credentials | Decide with a data-protection note for student documents | Not for WBS-2 |
| U3 | ~~Final embedding model + revision (ADR-010)~~ **Decided for the MVP:** e5-small `614241f…` (§3.1) | Re-check with real course data and an independent label review | No |
| U4 | ~~PDF extraction library and chunk parameters within the bounds~~ **Decided:** ADR-021 to ADR-024 | — | Resolved |
| U5 | Deployment topology (docker-compose: MySQL, Chroma, ai-service, NestJS, shared volume) | WBS-9 | Not for WBS-2 development |
| U6 | Redaction of stored answer excerpts after document deletion | Redact on delete for PRIVATE documents | **Deferred (WBS-4 decision):** answers are not persisted in WBS-4, so no excerpts of deleted documents are stored. Must be decided before any answer persistence (WBS-8) |
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

## 7. WBS-2 implementation record (`indexing_version` `c1`)

Implemented on `feature/document-ingestion` as `ai-service/src/knot_ingest/`. The decisions
that [wbs2-handoff.md §13](wbs2-handoff.md#13-decisions-left-to-wbs-2-within-the-constraints-above)
leaves to WBS-2 are listed below. Changing any of them requires a new `indexing_version`.

| Decision | `c1` value | Why |
| --- | --- | --- |
| Extraction library | pypdf 6.17.0, `extract_text()` default (plain) mode | BSD licence; pure Python; deterministic |
| Text rules | NFC → ligatures (`ﬀ ﬁ ﬂ ﬃ ﬄ`) → `\r`/tab/NBSP → remove Cc except `\n` → collapse spaces, strip each line → de-hyphenate → at most `\n\n` → NFC | Handoff §5; NBSP is treated as a space |
| Hyphenation | Join `letter-⏎letter` only when the next letter is lowercase (Turkish-aware `str.islower`) | Keeps `Ağaç-⏎Yapısı` and `2-⏎3` |
| Headers/footers | Not removed | Slide titles often repeat; removing them loses content |
| Chunk size | Prose packed greedily to ≤ 1,200 characters; long paragraphs split at the last paragraph/sentence break that leaves ≥ 800 characters, else at whitespace; slides one chunk per page, split only above 1,500 | Handoff §6 |
| Overlap | Prose: ≤ 150 characters, starting at the earliest sentence or line start in the window (else a word start), never beyond 1,500 total. Slides: none | Slide overlap would make a page-4 chunk start on page 2, so the citation label would read `s.2–4` |
| `section_title` | Slides: the first line of the page where the chunk's content starts, if ≤ 300 characters. Prose: omitted | No reliable heading signal in plain extracted text |
| Error code for an unsupported `indexing_version` | HTTP 422 with code `UNSUPPORTED_INDEXING_VERSION` (other 422s use `VALIDATION_ERROR`) | The handoff names the specific code; NestJS treats every 422 as non-retryable |
| Reconcile | Documents with a queued or running local job are treated as live even if missing from `live_document_ids` | Protects documents uploaded after NestJS built the list |

**Verification (2026-10-08):** 117 WBS-2 tests (T1–T17 and the additional failure scenarios)
plus the existing WBS-3 suite: 310 passed. Embeddings in these tests are the deterministic
`HashingEmbedder`; no real embedding model has been run against ingested PDFs yet (ADR-010
remains PROVISIONAL).

## 8. WBS-4 implementation record (`backend/`, 2026-10-08)

Implemented on `feature/backend-api`. The contracts in this folder are unchanged. The
following decisions were taken within them:

| Topic | Decision |
| --- | --- |
| Stack | NestJS 11 (CommonJS; NestJS 12 is ESM-only), TypeScript 5.9, Prisma 7 with the MariaDB driver adapter, MySQL 8.0 |
| Schema | `data-model.md` §5 verbatim, as the initial migration |
| Auth (U1) | Seed-only accounts; Argon2id (19 MiB, t=2, p=1); HS256 JWT (1 h); the user must still exist on every request; login limited to 10 per minute per IP and e-mail |
| Public error envelope | The WBS-3 `ErrorResponse` shape with `schema_version: "api.v1"`. `document-contract.md` §11 fixes only the shape, so this value is a new label for the public API |
| Answer persistence (U6) | None. `GroundedAnswer` is proxied unchanged plus the `documents` map |
| Scope | Derived from MySQL per request (api-contracts §5). Client `document_ids` are intersected. Extra fields such as `scope`, `user_id` or `course_id` are rejected with 422 |
| Leakage defence | Evidence or citations outside the derived scope fail closed with 500 and an `rag.scope_violation_blocked` log entry |
| Job events while `QUEUED` | Accepted, moving the job to RUNNING. A dispatch response can be lost after Python accepted the job; otherwise the job would only recover through a stall |
| Job creation | The document row is locked (`FOR UPDATE`) before the job is inserted, so concurrent creators fail cleanly with 409 instead of deadlocking |
| Admin operations | CLI (`backend/scripts/admin.ts`): reconcile, purge, sweep, index check. Migration and activation are **not implemented** yet |

**Verification:**
- **unit + api:** 118 tests on real MySQL 8, with a fake ai-service double.
- **Real integration:** NestJS → Python WBS-2 → HTTP callbacks → READY → WBS-3 `/answer` and
  `/retrieve` → purge, with the hashing embedder and with the pinned e5-small model. All passed.
- **Python suite:** unchanged, 312 passed.

## 9. WBS-5 implementation record (frontend integration, 2026-10-08)

Implemented on `feature/frontend-integration`. The contracts are unchanged. The implemented backend
(WBS-4) is the source of truth. Deviations from the WBS-1 frontend assumptions:

| Topic | WBS-1 / old frontend | Implemented |
| --- | --- | --- |
| Course identity | Slug (`veri-yapilari`) | cuid from `GET /courses`. Old mock deep links redirect to `#/dersler` |
| Course fields | Exam date, topics, progress | Only `code`, `name`, `term`, `instructor_name`, `my_role` and document counts. The rest stays mock-only (Home) |
| Document types | `slayt`, `not`, `sinav`, `kitap` | API values `slide`, `notes`, `past_exam`, `textbook`, `other`, mapped for display (`src/lib/materials.js`) |
| Citation | `{doc, page, seg, label}` | `document_id`, `chunk_id`, `evidence_id`, physical `location.page_start`, `quote`, `quote_verified`, `highlight` (Unicode code-point offsets) |
| Support strength | Derived in the browser from citations | Taken from the server's `support_status` / `support_label`. A citation never upgrades a claim |
| Logout | — | Client-side only: no endpoint, and the JWT stays valid until it expires (≤ 1 h) |
| Download | Link | Blob fetch with the bearer token, because `/documents/:id/file` needs auth |

**Frontend decisions:**
- **Session:** the JWT lives in `sessionStorage` (`knot.session`) and is expired on a timer or on the first 401.
- **API client:** `src/api/client.js` adds `X-Request-ID`, parses the `api.v1` error envelope and maps network failures to the retryable `NETWORK_ERROR`.
- **Status polling:** every 3 s while any document is processing, with back-off on retryable errors. It is cancelled on unmount.
- **Source viewer:** renders only the real `pages.v1` text. A `<mark>` is drawn only when the code-point range of a verified quote lies on that page; otherwise the evidence excerpt is shown. No PDF coordinates or page blocks are synthesised.
- **Errors vs. insufficient evidence:** service errors (`AI_SERVICE_UNAVAILABLE`, `GENERATION_FAILED`, `PROVIDER_TIMEOUT`, `INDEX_VERSION_MISMATCH`, `RATE_LIMITED`, …) are errors with "Tekrar sor". `INSUFFICIENT_EVIDENCE` is a normal KOPUK answer.
- **Extractive provider:** answers from `extractive_baseline` carry a notice that they are not produced by a generative language model.

**Backend fix found by the E2E:** the generated Prisma client imported `./internal/class.ts`, so
`npm run build && npm start` (compiled `dist/`) failed at startup. Tests were unaffected because
they run under ts-node/jest. The generator now emits extensionless imports
(`importFileExtension = ""`), which resolve in both. No behaviour change: 118 backend tests still pass.

**Verification:**
- **Mocked:** 58 Vitest/Testing Library tests with a fake `fetch`.
- **Real E2E (`npm run test:e2e`):** 15/15 steps. Chromium → `vite preview` → NestJS → MySQL 8, and NestJS → Python ai-service (WBS-2 ingestion, WBS-3 extractive answers, hashing embedder, in-memory Chroma).

## 10. WBS-3 LLM-readiness record (`feature/rag-llm-validation`, 2026-10-08)

**Provider decision: deferred by the project team.** No external LLM provider, external
transmission of course material, LLM judge or budget is approved. Claude Sonnet (Anthropic API)
is a candidate only. The evaluation budget cap is **$0**. Nothing in this record was produced
by a real LLM.

| Topic | Decision |
| --- | --- |
| External calls | Default-deny (`generation/providers/policy.py`). A non-loopback `LLM_BASE_URL` is refused at start-up unless `LLM_ALLOW_EXTERNAL=true`, `LLM_BUDGET_USD > 0` and both `LLM_PRICE_*_PER_MTOK` are set. Loopback endpoints (a local model) need no approval because nothing leaves the server and nothing is billed |
| Budget | Approved providers run behind `BudgetGuardProvider`: a call whose worst-case cost (prompt chars / 2 tokens, plus `max_output_tokens`) would exceed the remaining budget is not made. Spend settles to provider-reported usage. Exhaustion is a non-retried `GENERATION_FAILED` |
| Evaluation runner | `--provider extractive` (offline) is the default; `--provider env` goes through the same policy |
| Judge independence | `SUPPORT_JUDGE=llm` requires a separately injected judge provider; the generator is never its own judge. No judge is configured (team decision: no LLM judge) |
| Prompt | `grounded-answer.v2`: adds an optional `conflicts` list for disagreeing evidence |
| Conflicts | `evidence/conflicts.py`: model-reported conflicts (≥ 2 evidence ids that were shown) and lexical claim conflicts (stem Jaccard ≥ 0.8, different negation or numbers) cap involved claims at GEVEŞEK and block ANSWERED. They can only lower support |
| Support rules | `citation-lexical-v3` = v2 + S8 (no claim term absent from all cited passages). `assessment.unsupported_terms` is additive; NestJS passes answers through and React ignores the field, so both are unchanged |
| Evaluation tools | `evaluation/grounding.py` (constructed-error harness), `evaluation/claim_labels.py` (blind human labelling + claim metrics) |

**Decisions still needed from the team.**
1. Provider, model and data-transmission approval (and whether real student documents may ever
   be sent; retention and zero-retention terms must be checked against the provider's current
   policy). Until then `LLM_ALLOW_EXTERNAL=false`, budget $0.
2. Budget for the first real evaluation. Rough pre-approval estimate for Claude Sonnet at
   $2/$10 per 1M tokens, generator only: 107 questions (eval.v2 + challenge.v1) × ~5K input and
   ~1.5K output tokens ≈ $3 per pass; to be re-estimated with the provider's token counter.
3. **English and mixed-language questions** (rag-evaluation §4.8, finding 4): lexical relevance
   (S7) prevents SIKI for English questions over Turkish material (faithful control en 0/5 and
   0/9). Options: (a) a cross-lingual relevance check using the local multilingual embedding
   model (no external calls; needs calibration on the calibration split and confirmation on
   held-out data); (b) answer in the language of the evidence, with the question's language
   used only for explanations; (c) accept GEVEŞEK for English questions and say so in the UI.
4. Who independently reviews the gold labels (eval.v2, challenge.v1) and labels claims for the
   claim-level metrics; the developer's own labels are not independent.
5. Whether a contradictory-evidence evaluation set (proposed `grounding.v1`, ~30 items incl.
   conflicting passages) should be written and by whom it is reviewed.

**WBS-3 status: not Done.** The provider-independent parts are implemented and tested. Real
generation quality, claim-level hallucination metrics, judge agreement and the full
PDF → e5-small → Chroma → LLM → validation → NestJS → React flow with a real model remain
unvalidated until the decisions above are made.

## 11. Answer-quality record (`feature/rag-answer-quality`, 2026-10-09)

Base: `feature/frontend-integration` @ `68bda0c`, plus the five offline WBS-3 commits of
`feature/rag-llm-validation` cherry-picked (they were not on the base). Still no LLM, no external
calls, budget $0. Contracts: additive only (`insufficient_evidence.reason = NOT_A_QUESTION`);
NestJS passes it through; React shows the reply without a support label.

| Change | Where | Why (measured) |
| --- | --- | --- |
| Question intent: greetings/thanks/acknowledgements answered without retrieval | `query/intent.py`, `pipeline.py` | "Merhaba" matched a PDF sentence and was rated SIKI |
| Hybrid retrieval: lexical channel + RRF, top-2 lexical hits reserved | `retrieval/service.py`, `chroma_index.keyword_search` | e5-small ranked the only `git status` chunk 10th–16th of 45 |
| Slide-aware segmentation, exact-substring quotes | `text.segment_spans` | titles and page numbers were glued into claims |
| Extractive baseline v2 (IDF share, specific term, named-subject abstention, partial fallback) | `generation/providers/mock.py` | one shared word ("Git") qualified a sentence |
| Support `citation-lexical-v4`: S9 (statement), S7+ (specific term, named subject) | `evidence/support.py` | relevance weighed "Git" like "status"; titles could be claims |
| Question stop-words: "işe yarar", "komut", "command", greetings, pronouns | `text.py` | function words counted as topics |

Results: rag-evaluation §4.10. Main trade-off: fewer wrong answers, more abstentions on
cross-lingual questions. Not done (would need an LLM or translation): cross-lingual answering,
reliable partial-answer detection for one missing term out of several.
