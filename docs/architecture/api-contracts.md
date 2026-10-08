# API Contracts

Three boundaries:
1. **Public:** Browser → NestJS (§3).
2. **Private:** NestJS → Python. The existing WBS-3 RAG API (§4) and the new WBS-2 ingestion
   API (§8).
3. **Private callbacks:** Python → NestJS (§9).

Data shapes are defined in [document-contract.md](document-contract.md).

## 1. Common rules

| Topic | Rule |
| --- | --- |
| Format | JSON, UTF-8. Public API field names are `snake_case`, the same as the AI contracts, so payloads pass through without renaming. |
| Errors | Single envelope `{schema_version, error:{code, message, request_id, retryable, details}}` (§7). No stack traces, SQL, or file paths. |
| Correlation | `X-Request-ID` is accepted and echoed by NestJS and forwarded to Python (the existing WBS-3 behaviour). |
| Not-visible resources | Return `404 NOT_FOUND`, not 403, for documents or courses the user may not see, so their existence is not revealed |
| Timeouts | NestJS → `/api/v1/rag/answer`: 35 s (`LLM_TIMEOUT_SECONDS` + 5). → `/retrieve` 10 s. → ingestion endpoints 10 s. Python → NestJS callbacks 5 s. |
| Status updates | The frontend polls `GET /courses/:courseId/documents` every 3 s while any document is not in a terminal state. No WebSockets in Phase 1. |

## 2. Authentication (WBS-4)

- **Mechanism:** e-mail + password with a short-lived JWT in `Authorization: Bearer`.
  Recommended; final mechanism is unresolved U1. Every public route except login requires it.
- **Users and courses:** created by an admin seed script. Admin-seeded courses (ADR-002); no
  self-service course creation.

## 3. Public API (NestJS ↔ browser)

**Roles**
- **Member:** has a `CourseMembership` for the course.
- **Instructor:** membership role `INSTRUCTOR`.
- **Owner:** `Document.ownerId == user.id`.
- **Admin:** `User.role == ADMIN`. May manage everything except reading others' PRIVATE
  documents.

### 3.1 Courses

| Method & path | Auth | Response |
| --- | --- | --- |
| `GET /courses` | Logged in | `CourseDto[]`: courses with a membership |
| `GET /courses/:courseId` | Member | `CourseDto`, or 404 |

```json
{ "id": "cm2k7v0aa000008l4vy000211", "code": "BIL 211", "name": "Veri Yapıları",
  "instructor_name": "Doç. Dr. M. Aydın", "term": "Güz 2026", "my_role": "STUDENT",
  "documents": { "total": 14, "ready": 13, "processing": 1, "failed": 0 } }
```

### 3.2 Documents

| Method & path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `GET /courses/:courseId/documents` | Member | — | `200 DocumentDto[]`: COURSE documents + own PRIVATE, excluding deleted | 404 |
| `POST /courses/:courseId/documents` | Member; `visibility=COURSE` requires Instructor | `multipart/form-data`: `file` (PDF), `document_type`, `title?` (default: filename without extension), `visibility?` (default `PRIVATE`) | `201 DocumentDto` (`UPLOADED`), `notices` may contain `SAME_AS_COURSE_DOCUMENT` | 403 (COURSE without Instructor), 409 `DUPLICATE_DOCUMENT` (`details.existing_document_id`), 413 `PAYLOAD_TOO_LARGE` (> 30 MB), 415 `UNSUPPORTED_MEDIA_TYPE` (not `%PDF-`), 422 `VALIDATION_ERROR` |
| `GET /documents/:documentId` | Can view (§5) | — | `200 DocumentDto` | 404 |
| `POST /documents/:documentId/retry` | Owner; or Instructor/Admin for COURSE | — | `202 DocumentDto` (new job, `UPLOADED`) | 409 `JOB_ALREADY_RUNNING`, 409 `NOT_RETRYABLE` (status ≠ FAILED, or error not retryable → upload a new file), 404 |
| `DELETE /documents/:documentId` | Owner; or Instructor/Admin for COURSE | — | `202` `{ "id": "...", "state": "DELETING" }` | 404 |

`DocumentDto` and the status mapping: [document-contract.md §9](document-contract.md#9-public-document-status-indexingstatus-as-seen-by-the-frontend).
For FAILED documents, `status.error` is
`{ "code": "NO_TEXT_LAYER", "message_tr": "Taranmış sayfalar okunamadı. Metin içeren bir PDF yükleyebilirsin.", "retryable": false }`.
`message_tr` comes from a NestJS lookup table keyed by `code`; Python messages are never
shown to users.

### 3.3 Source viewer

| Method & path | Auth | Response | Errors |
| --- | --- | --- | --- |
| `GET /documents/:documentId/pages/:page?indexing_version=c1` | Can view | `200 PageDto` from the page artifact. Without `indexing_version`, the document's current `indexingVersion` is used. | 404 (document, page, or artifact version not found); 409 `DOCUMENT_NOT_READY` if no artifact exists yet |
| `GET /documents/:documentId/file` | Can view | `200 application/pdf` stream, `Content-Disposition: inline; filename*=UTF-8''…` | 404 |

```json
{ "document_id": "cm2k8x1q0000108l4h7r2c9ab", "indexing_version": "c1", "page": 3, "page_count": 3,
  "char_start": 157, "char_end": 298,
  "text": "AVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır." }
```

Viewing pages of a document that was **deleted** returns 404. Old answers therefore fall back
to the `evidence[].text` excerpt stored in their payload.

### 3.4 Answers

| Method & path | Auth | Request | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST /courses/:courseId/answers` | Member | `{ "question": string ≤ 2000, "document_ids"?: string[] }` | `200 AnswerResponse` | 404; 409 `NO_READY_DOCUMENTS`; 422 `VALIDATION_ERROR`; 429 `RATE_LIMITED` (20/min/user); 502 `GENERATION_FAILED`; 503 `AI_SERVICE_UNAVAILABLE` / `INDEX_VERSION_MISMATCH`; 504 `PROVIDER_TIMEOUT` |

`AnswerResponse` is the WBS-3 `GroundedAnswer` (`rag.v1`), passed through **unchanged**, plus
one NestJS field with **current** MySQL values for every `document_id` cited or present in
`evidence`:

```json
{
  "...": "all GroundedAnswer fields (docs/rag-api-contract.md)",
  "documents": {
    "cm2k8x1q0000108l4h7r2c9ab": { "title": "Hafta 4 — AVL Ağaçları", "original_filename": "Hafta4_AVL_Agaclari.pdf",
                                   "document_type": "slide", "page_count": 3 }
  }
}
```

- **`INSUFFICIENT_EVIDENCE` is a normal 200** (rendered as KOPUK), not an error.
- **`document_ids`** is optional. If present, it is **intersected** with the authorized
  scope; IDs outside it are silently dropped. If nothing remains, the response is 409
  `NO_READY_DOCUMENTS`.

Evidence retrieval for WBS-6/7 is a **NestJS service method** that calls
`/api/v1/rag/retrieve` with the same scope derivation. It is not a browser route in Phase 1.

### 3.5 Admin (WBS-4 may implement these as CLI scripts instead of HTTP)

| Operation | Effect |
| --- | --- |
| Create index version (`BUILDING`) with an `EmbeddingConfiguration` | New collection name and fingerprint |
| Start migration to a BUILDING version | Enqueue `MIGRATION` jobs for all live READY documents |
| Activate index version | Verification gate ([document-lifecycle.md §8](document-lifecycle.md#8-embedding-model-change-bluegreen-migration)) |
| Reindex documents to a new `indexing_version` | Throttled `REINDEX` jobs ([document-lifecycle.md §7](document-lifecycle.md#7-reindexing-same-embedding-configuration)) |
| Reconcile | Orphan cleanup ([document-lifecycle.md §9](document-lifecycle.md#9-stale-chunk-cleanup-reconcile)) |

## 4. NestJS → Python RAG (existing WBS-3)

These are unchanged; see [`docs/rag-api-contract.md`](../rag-api-contract.md).

| Endpoint | Used for |
| --- | --- |
| `GET /health` | Liveness |
| `GET /ready` | Index reachability + embedding model (+ fingerprint after C-1, §6) |
| `POST /api/v1/rag/retrieve` | Evidence for WBS-6/7 |
| `POST /api/v1/rag/answer` | Q&A |

Auth: `Authorization: Bearer ${RAG_INTERNAL_API_TOKEN}` (existing). Never sent to browsers.

## 5. Authorized scope derivation

The scope sent to Python is computed **only** from MySQL, per request:

```ts
// WBS-4 — the only place access to course material is decided
async function authorizedScope(userId: string, courseId: string, requested?: string[]) {
  const member = await prisma.courseMembership.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (!member) throw new NotFoundException();               // 404, not 403
  const docs = await prisma.document.findMany({
    where: {
      courseId,
      status: 'READY',
      deletedAt: null,
      OR: [{ visibility: 'COURSE' }, { ownerId: userId }],
      ...(requested?.length ? { id: { in: requested } } : {}),
    },
    select: { id: true },
    take: 1000,                                              // = WBS-3 MAX_SCOPE_DOCUMENTS
  });
  if (docs.length === 0) throw new ConflictException({ code: 'NO_READY_DOCUMENTS' });
  return { user_id: userId, course_id: courseId, document_ids: docs.map((d) => d.id) };
}
```

**Visibility rules**

| Document | Visible to (list, view, Q&A scope) | Upload | Delete / retry |
| --- | --- | --- | --- |
| `PRIVATE` | Owner only (while still a member) | Any member | Owner, Admin |
| `COURSE` | All course members | Instructor only (ADR-003) | Owner, course Instructor, Admin |

**Python-side enforcement (existing WBS-3):**
- The scope is a mandatory Chroma `where` filter.
- Every returned record is re-checked against the scope.
- Document IDs indexed under another course produce `403 UNAUTHORIZED_SCOPE`.

Python never widens a scope and never reads MySQL.

## 6. Consistency guard (NestJS ↔ Python)

NestJS calls `GET /ready` at startup and every 60 s, and compares it with the `ACTIVE`
`IndexVersion`:

- **After C-1:** `/ready` reports `index: { collection, embedding_fingerprint, index_version_id }`.
  NestJS compares all three.
- **Before C-1:** NestJS compares `checks.embedding_model` with `IndexVersion.embeddingModel`.
  The collection name is guaranteed only by deployment configuration (known gap, R4).
- **On mismatch:** answers return `503 INDEX_VERSION_MISMATCH`, ingestion dispatch pauses, and
  an operator alert is logged.

## 7. Error codes

**Public (NestJS) codes:** `VALIDATION_ERROR` 422 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 ·
`NOT_FOUND` 404 · `DUPLICATE_DOCUMENT` 409 · `JOB_ALREADY_RUNNING` 409 · `NOT_RETRYABLE` 409 ·
`NO_READY_DOCUMENTS` 409 · `DOCUMENT_NOT_READY` 409 · `PAYLOAD_TOO_LARGE` 413 ·
`UNSUPPORTED_MEDIA_TYPE` 415 · `RATE_LIMITED` 429 · `INTERNAL_ERROR` 500 ·
`GENERATION_FAILED` 502 · `AI_SERVICE_UNAVAILABLE` 503 · `INDEX_VERSION_MISMATCH` 503 ·
`PROVIDER_TIMEOUT` 504.

**Mapping of Python `rag.v1` codes to public codes:**

| Python | Public | Note |
| --- | --- | --- |
| `VALIDATION_ERROR` | `VALIDATION_ERROR` 422 | e.g. a question with no words |
| `UNAUTHORIZED` | `INTERNAL_ERROR` 500 | Token misconfiguration; alert |
| `UNAUTHORIZED_SCOPE` | `INTERNAL_ERROR` 500 | Means NestJS sent a wrong scope: a bug; alert |
| `INDEX_NOT_READY` | `NO_READY_DOCUMENTS` 409 | Race with delete or reindex; retryable |
| `RETRIEVAL_UNAVAILABLE` | `AI_SERVICE_UNAVAILABLE` 503 | |
| `GENERATION_FAILED` | `GENERATION_FAILED` 502 | |
| `PROVIDER_TIMEOUT` | `PROVIDER_TIMEOUT` 504 | |
| `INTERNAL_ERROR` / connection refused | `INTERNAL_ERROR` 500 / `AI_SERVICE_UNAVAILABLE` 503 | |

## 8. NestJS → Python ingestion API (new, implemented by WBS-2)

Auth: the same `Bearer RAG_INTERNAL_API_TOKEN`. Errors use the common envelope with
`schema_version: "ingest.v1"`.

### 8.1 `POST /api/v1/ingestion/jobs`
Request: [`IngestionJobRequest`](document-contract.md#6-ingestionjobrequest-indexingjob-nestjs--python).

| Response | Meaning | NestJS action |
| --- | --- | --- |
| `202 {"schema_version":"ingest.v1","job_id":"…","accepted":true,"duplicate":false,"worker_id":"ai-7f3a91","queue_position":0}` | Queued in the worker | Job `QUEUED → DISPATCHED`, set `workerId`, `dispatchedAt` |
| `200 {…,"accepted":true,"duplicate":true}` | Same `job_id` already queued or running in this process | Treat as dispatched (idempotent) |
| `409 DOCUMENT_BUSY` | This worker is processing another job for the same document | Keep `QUEUED`, retry dispatch after 30 s |
| `409 INDEX_CONFIG_MISMATCH` | Python cannot load the exact configuration, or the collection stamp differs | Job `FAILED` (not retryable); alert |
| `422 VALIDATION_ERROR` (incl. `UNSUPPORTED_INDEXING_VERSION`, unsafe `storage_key`) | Bad request | Job `FAILED` (not retryable) |
| `503 QUEUE_FULL` / connection error | Back-pressure or Python down | Keep `QUEUED`, retry dispatch after 30 s |

### 8.2 `DELETE /api/v1/ingestion/documents/{document_id}/chunks?collection={name}`
- Idempotent. Response: `200 {"document_id":"…","collection":"knot_chunks_v1","deleted":41}`
  (0 is fine).
- If this process is running a job for the document, the job is cancelled first; it stops at
  its next checkpoint.
- NestJS calls this for every collection not yet dropped (`ACTIVE`, `BUILDING`, and
  `RETIRED` collections kept for rollback). Deleted content must not survive in a rollback
  copy.

### 8.3 `POST /api/v1/ingestion/reconcile`
```json
{ "collection": "knot_chunks_v1", "live_document_ids": ["cm2k8x1q0000108l4h7r2c9ab"], "dry_run": true, "allow_empty": false }
```
→ `200 {"orphan_document_ids":["…"],"deleted_chunks":0,"dry_run":true}`.

Safety rules:
- `live_document_ids` are documents that are not deleted, in any status. In-flight jobs must
  not be destroyed.
- Python refuses an empty `live_document_ids` for a non-empty collection unless
  `allow_empty: true`, so a bug cannot wipe the index.

### 8.4 `POST /api/v1/ingestion/verify`
```json
{ "collection": "knot_chunks_v2", "documents": [{ "document_id": "cm2k8x1q0000108l4h7r2c9ab", "chunk_count": 2, "job_id": "cm2k9mig0000308l4job00007" }] }
```
→ `200 {"results":[{"document_id":"…","expected":2,"found":2,"foreign_job_chunks":0,"ok":true}],"collection_fingerprint":"sha256:…","ok":true}`.
Used by the activation gate and for audits.

## 9. Python → NestJS callbacks (new)

`POST /internal/v1/ingestion-jobs/{job_id}/events`
- **Auth:** `Authorization: Bearer ${INGEST_CALLBACK_TOKEN}`, a separate secret from
  `RAG_INTERNAL_API_TOKEN`, compared in constant time.
- **Network:** the route is bound to the internal network and not routed by the public
  reverse proxy.
- **Base URL:** Python takes it from configuration (`NESTJS_INTERNAL_URL`), never from the
  request (prevents SSRF).

Body: [`IngestionEvent`](document-contract.md#8-ingestionevent-indexingstatus-python--nestjs).

| Response | Meaning | Python action |
| --- | --- | --- |
| `200 {"applied":true}` | Event applied | Continue |
| `200 {"applied":false,"reason":"DUPLICATE_EVENT"}` | `seq ≤ lastEventSeq` | Continue (idempotent) |
| `409 STALE_JOB` | Job is not the document's active job, is terminal, or the document is deleted | **Abort immediately, write nothing more**, release the document lock |
| `409 INVALID_TRANSITION` | Event not allowed in the current job state | Abort; log |
| `401` / `422` | Configuration or contract bug | Abort; log |
| `5xx` / timeout | NestJS unavailable | `STAGE`/`HEARTBEAT`: drop. `SUCCEEDED`/`FAILED`: retry with backoff (1, 2, 4 … 30 s) for up to 2 min, then give up; the sweeper recovers the job ([document-lifecycle.md §4](document-lifecycle.md#4-in-process-worker-reliability)) |

Event handling in NestJS runs in **one transaction**: lock the job row (`SELECT … FOR UPDATE`),
check fencing and `seq`, validate the transition, then update the job and document.

## 10. Configuration and credentials

| Variable | Where | Secret |
| --- | --- | --- |
| `RAG_INTERNAL_API_TOKEN` | NestJS + Python | Yes |
| `INGEST_CALLBACK_TOKEN` | NestJS + Python | Yes |
| `NESTJS_INTERNAL_URL` | Python | No |
| `STORAGE_ROOT` | NestJS + Python (same volume) | No |
| `CHROMA_*`, `EMBEDDING_*` | Python (must match the ACTIVE `IndexVersion`) | No |
| `INGEST_WORKER_CONCURRENCY` (1), `INGEST_QUEUE_CAPACITY` (20), `INGEST_HEARTBEAT_SECONDS` (30) | Python | No |
| `INGEST_STALL_TIMEOUT_SECONDS` (300), `INGEST_MAX_AUTO_ATTEMPTS` (3) | NestJS | No |
| `LLM_*` | Python | `LLM_API_KEY` yes |
| JWT secret | NestJS | Yes |

None of these reach the browser bundle. Vite exposes only `VITE_*` variables; none of the
above may use that prefix.
