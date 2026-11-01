# WBS-2 Handoff — Document Ingestion

This is everything needed to implement ingestion without guessing. Normative terms: **MUST**,
**SHOULD**, **MAY**. Contracts: [document-contract.md](document-contract.md). APIs:
[api-contracts.md §8–9](api-contracts.md#8-nestjs--python-ingestion-api-new-implemented-by-wbs-2).
States and recovery: [document-lifecycle.md](document-lifecycle.md).

## 1. What WBS-2 builds

| Deliverable | Notes |
| --- | --- |
| `ai-service/src/knot_ingest/` package | Extraction, chunking, document embedding, Chroma writes, worker, events |
| FastAPI router `/api/v1/ingestion/*` | `POST jobs`, `DELETE documents/{id}/chunks`, `POST reconcile`, `POST verify` |
| Bounded in-process worker | [document-lifecycle.md §4.1](document-lifecycle.md#41-python-worker-obligations) |
| Callback client to NestJS | Authenticated, sequenced, retrying terminal events |
| Page artifacts | `pages.v1` JSON in storage |
| Tests | §11 |

**Out of scope for WBS-2:**
- MySQL, users, access decisions.
- Query embeddings, search, answers (WBS-3).
- The NestJS side of jobs (WBS-4).
- OCR, PPT/DOC formats (Phase 2).

## 2. Code location and dependencies

- **Imports, never copies:**
  - `knot_rag.schemas.documents`: `DocumentMetadata`, `IndexedChunk`, `SourceLocation`,
    `DocumentType`.
  - `knot_rag.retrieval.embedding.build_embedder`.
  - `knot_rag.retrieval.chroma_index`: `ChromaChunkWriter`, `build_chroma_client`.
- **Owns `ChromaChunkWriter`** (ADR-007). Required additive changes, reviewed by WBS-3:
  1. `upsert(chunks, embeddings=None)`: accept precomputed embeddings, so EMBEDDING and
     INDEXING are separate stages. Today `upsert` embeds internally.
  2. Full collection stamp per C-1 (ADR-006), in the same PR as the WBS-3 reader
     verification.
  3. `count(document_id, exclude_job_id=None)` and `delete_document(..., job_id=None)`
     helpers for verification.
- **Router mounting:** one additive line in the composition root
  (`knot_rag/main.py`/`bootstrap.py`), behind `INGEST_ENABLED=true`, reviewed by WBS-3. Same
  auth dependency as `/api/v1/rag/*`.
- **New dependencies:** a PDF text extractor. Choose a permissive license (pypdf: BSD;
  pdfminer.six/pdfplumber: MIT). PyMuPDF is AGPL; avoid it unless the team accepts the
  license. Pin exact versions (determinism, §5).

## 3. Inputs and outputs

| Direction | Contract |
| --- | --- |
| In: `POST /api/v1/ingestion/jobs` | `IngestionJobRequest` (`ingest.v1`) |
| In: original file | `STORAGE_ROOT/{source.storage_key}` (read-only) |
| Out: ChromaDB | `IndexedChunk` records in `index.collection`, metadata via `to_chroma_metadata()`, plus `x_job_id` |
| Out: storage | `STORAGE_ROOT/documents/{document_id}/pages.{indexing_version}.json` (`pages.v1`) |
| Out: NestJS | `IngestionEvent`s to `{NESTJS_INTERNAL_URL}/internal/v1/ingestion-jobs/{job_id}/events` |

## 4. Job algorithm

```text
ACCEPT (request thread)
  validate IngestionJobRequest (pydantic, extra=forbid)                 → 422
  storage_key: relative, no "..", resolved path inside STORAGE_ROOT     → 422
  document.indexing_version ∈ INGEST_SUPPORTED_INDEXING_VERSIONS        → 422 UNSUPPORTED_INDEXING_VERSION
  embedder = cached build_embedder(index.embedding); recompute fingerprint
     ≠ index.embedding_fingerprint or model dimension ≠ embedding.dimension → 409 INDEX_CONFIG_MISMATCH
  collection exists with a different stamp                              → 409 INDEX_CONFIG_MISMATCH
  job_id already registered                                              → 200 duplicate
  another local job holds document_id                                    → 409 DOCUMENT_BUSY
  queue full                                                             → 503 QUEUE_FULL
  register + enqueue                                                     → 202

RUN (worker thread; heartbeat timer every 30 s while running; seq starts at 1)
  1 STAGE EXTRACTING
    read file; sha256 must equal source.sha256          else FAILED SOURCE_CHECKSUM_MISMATCH (not retryable)
    extract pages in physical order → normalize (§5) → page_texts
    page_count > INGEST_MAX_PAGES                       → FAILED TOO_LARGE
    encrypted / unparsable                              → FAILED ENCRYPTED_PDF / CORRUPT_PDF
    empty-page ratio > INGEST_MAX_EMPTY_PAGE_RATIO      → FAILED NO_TEXT_LAYER
    no text at all                                      → FAILED EMPTY_DOCUMENT
    send STAGE EXTRACTING with page_count (progress)
  2 STAGE CHUNKING
    document_text = "\n\n".join(page_texts); page offsets per pages.v1
    chunks = chunk(document_text, pages, document_type) (§6)
    assert for every chunk: text == document_text[char_start:char_end]; page range is correct
  3 STAGE EMBEDDING
    vectors = embedder.embed_documents([c.text …]) in batches of INGEST_EMBED_BATCH_SIZE
    assert len(vector) == dimension for all
  4 STAGE INDEXING                                       ── checkpoint before every write
    writer.ensure_collection()  (full C-1 stamp; refuse if the stamp differs)
    writer.delete_document(document_id)                  # delete-first: idempotent retries
    for batch: checkpoint; writer.upsert(batch, embeddings=…)  # extra.job_id = job_id → x_job_id
    verify: count(document_id) == len(chunks) and count(document_id, x_job_id ≠ job_id) == 0
        foreign chunks → delete them, recount; still wrong → FAILED VERIFICATION_FAILED (retryable)
    write pages.{iv}.json.tmp → fsync → rename to pages.{iv}.json
  5 SUCCEEDED (result: page_count, chunk_count, indexing_version, collection,
               embedding_fingerprint, pages_artifact_key, warnings?)
  on exception → classify (§8) → FAILED; always release the document lock and stop the heartbeat
```

- **Checkpoint:**
  - If the local cancel flag is set, or the last callback answered `409 STALE_JOB` /
    `INVALID_TRANSITION`, stop immediately. Do **not** write, delete or send further events.
  - Cancellation through `DELETE …/chunks` sets the flag.
- **`MIGRATION` jobs** run the same algorithm against their (BUILDING) collection. They write
  only that collection's chunks plus the page artifact. The artifact is version-named and
  identical for the same `indexing_version`, so rewriting it is harmless.

## 5. Extraction rules (affect offsets, so they must be deterministic)

| Rule | Requirement |
| --- | --- |
| Page order | Physical PDF page order, 1-based. Every page appears in the artifact, empty if it has no text. |
| Unicode | **NFC** (not NFKC, which would turn `O(n²)` into `O(n2)`). Map ligatures explicitly (`ﬁ→fi`, `ﬂ→fl`, `ﬀ→ff`, `ﬃ→ffi`, `ﬄ→ffl`). Preserve Turkish `ı İ ğ ş ç ö ü` and symbols `≥ − ⌊ ⌋ Ω Θ α`. |
| Whitespace | `\r\n`/`\r` → `\n`; remove control characters except `\n`; collapse runs of spaces/tabs to one space; strip trailing spaces per line; at most two consecutive `\n` inside a page |
| Hyphenation | MAY join a line-final `-` between two letters when the next line starts lowercase. Must be deterministic and documented. |
| Headers/footers | MAY remove repeated identical first or last lines across ≥ 50% of pages. Deterministic. |
| Determinism | Same file + same `indexing_version` ⇒ byte-identical page texts and chunks. Upgrading the extractor library or changing any rule ⇒ **new `indexing_version`**. |
| Logging | Never log document text; log counts and timings only |

## 6. Chunking rules

| Rule | Value |
| --- | --- |
| Size | Target 800–1,200 characters; **hard max 1,500** (fits WBS-3's default 3,000-token / 6-evidence context budget at 3 chars/token). Minimum 20 characters: merge smaller fragments with a neighbour. |
| Overlap | ≤ 150 characters, or none. Overlapping text must still satisfy the substring invariant. |
| Boundaries | `slide`: one chunk per page; split at paragraph or sentence breaks only if > 1,500. `notes`, `textbook`, `past_exam`, `other`: paragraph, then sentence, then whitespace boundaries. Never split inside a word. |
| Pages | A chunk MAY span pages. `page_start`/`page_end` give the range, and its text includes the `"\n\n"` separator. |
| `section_title` | MAY be set (e.g. a slide title = first line); ≤ 300 characters; otherwise omit |
| Offsets | `char_start`/`char_end` in code points into `document_text`; always set |
| IDs | `ordinal` starts at 1 in document order; `chunk_id = f"{document_id}:{indexing_version}:{ordinal:03d}"` |
| Metadata | `DocumentMetadata` from the job request, with `page_count` filled in; `extra = {"job_id": job_id}` |
| Version | The first implementation is `indexing_version = "c1"`; it must match `IndexVersion.chunkerVersion` (seeded as `c1`) |

## 7. Embedding and index rules

- **Embedding:** use the embedder built from the job's `EmbeddingConfiguration`. The embedder
  applies `document_prefix` and normalization; do not add prefixes manually. `HashingEmbedder`
  is for tests only.
- **Collections:** write only to `index.collection`, and only if its stamp equals the job's
  configuration. Create a missing collection with the full stamp. Never write two models into
  one collection.
- **Never search.** Read only for counts, verification, deletion and reconcile.
- **The embedding model is PROVISIONAL** (ADR-010). All code must be configuration-driven. A
  model change is a new `IndexVersion` and a migration, never an in-place change.

## 8. Events and error classification

- **Sequencing:** `seq` increases by 1 per event; heartbeats count.
- **Delivery:** `STAGE`/`HEARTBEAT` are best-effort. `SUCCEEDED`/`FAILED` are retried with
  backoff for 2 min on 5xx or timeout.
- **Responses:** handle per [api-contracts.md §9](api-contracts.md#9-python--nestjs-callbacks-new).
- **Error codes:** see [document-lifecycle.md §5](document-lifecycle.md#5-error-codes-and-retry-policy),
  plus `SOURCE_CHECKSUM_MISMATCH` (EXTRACTING, not retryable).

Exception classification:

| Exception | Code |
| --- | --- |
| File missing or unreadable | `SOURCE_NOT_FOUND` |
| Extractor: password / encryption | `ENCRYPTED_PDF` |
| Extractor: parse error | `CORRUPT_PDF` |
| Not a PDF (magic bytes) | `UNSUPPORTED_FORMAT` |
| Embedder `RuntimeError` / OOM | `EMBEDDING_FAILED` |
| Chroma connection or timeout | `INDEX_UNAVAILABLE` |
| Chroma stamp mismatch | `INDEX_CONFIG_MISMATCH` |
| Artifact write failure | `STORAGE_WRITE_FAILED` |
| Anything else | `INTERNAL` |

## 9. Other endpoints

| Endpoint | Behaviour |
| --- | --- |
| `DELETE /api/v1/ingestion/documents/{id}/chunks?collection=` | Set the cancel flag on a local job for the document; `delete_document`; return the count; idempotent |
| `POST /api/v1/ingestion/reconcile` | Delete chunks whose `document_id` ∉ `live_document_ids`; `dry_run` support; refuse an empty list unless `allow_empty` |
| `POST /api/v1/ingestion/verify` | For each document: expected vs. found count; chunks with `x_job_id` ≠ given `job_id`; collection fingerprint |

## 10. Configuration

| Variable | Default |
| --- | --- |
| `INGEST_ENABLED` | `false` |
| `STORAGE_ROOT` | — (required) |
| `NESTJS_INTERNAL_URL` | — (required) |
| `INGEST_CALLBACK_TOKEN` | — (required, secret) |
| `INGEST_WORKER_CONCURRENCY` | `1` |
| `INGEST_QUEUE_CAPACITY` | `20` |
| `INGEST_HEARTBEAT_SECONDS` | `30` |
| `INGEST_EMBED_BATCH_SIZE` | `32` |
| `INGEST_MAX_PAGES` | `400` |
| `INGEST_MAX_EMPTY_PAGE_RATIO` | `0.5` |
| `INGEST_SUPPORTED_INDEXING_VERSIONS` | `c1` |
| `CHROMA_*`, `RAG_INTERNAL_API_TOKEN` | Shared with WBS-3 |

## 11. Required tests (definition of done)

Tests use `HashingEmbedder`, an in-memory Chroma, temp storage, and a **callback stub** that
records events and applies the rules of [document-lifecycle.md §3.3](document-lifecycle.md#33-applying-events-one-transaction-per-event).

| # | Test |
| --- | --- |
| T1 | The `IngestionJobRequest`, `IngestionEvent` and `PageArtifact` examples in `document-contract.md` parse with WBS-2's models |
| T2 | Offset invariant on fixture PDFs: Turkish text, a multi-page chunk, an empty page, `O(n²)`/`≥` symbols |
| T3 | Determinism: two runs give identical chunk IDs, texts, offsets and artifact |
| T4 | **Compatibility:** chunks written by WBS-2 are retrieved by the existing WBS-3 `RetrievalService` in scope, with correct `page_start`, `label` and offsets; a WBS-3 citation highlight maps to the page via the artifact |
| T5 | Delete-first: a partial earlier write plus a rerun leaves exactly `chunk_count` chunks |
| T6 | A foreign `x_job_id` chunk is detected and removed; an unrecoverable mismatch → `VERIFICATION_FAILED` |
| T7 | A `409 STALE_JOB` callback stops the worker before its next write |
| T8 | Duplicate `job_id` → one execution; second job for the same document → `DOCUMENT_BUSY` |
| T9 | Configuration or stamp mismatch → `INDEX_CONFIG_MISMATCH`; nothing written |
| T10 | `storage_key` path traversal and absolute paths are rejected |
| T11 | Scanned → `NO_TEXT_LAYER`; encrypted → `ENCRYPTED_PDF`; > `INGEST_MAX_PAGES` → `TOO_LARGE`; checksum mismatch → `SOURCE_CHECKSUM_MISMATCH` |
| T12 | Reconcile refuses an empty list; `dry_run` deletes nothing |
| T13 | Heartbeats continue during a slow (fake) embedding |
| T14 | Event `seq` is strictly increasing; terminal events are retried on 5xx |
| T15 | The page artifact appears only after successful verification (atomic rename) |
| T16 | No document text in logs |
| T17 | Existing WBS-3 test suite still passes (`pytest` in `ai-service`) |

## 12. Working without NestJS

- Develop against the callback stub (§11).
- An end-to-end smoke test: `POST /api/v1/ingestion/jobs` with a fixture PDF → events
  `EXTRACTING…SUCCEEDED` at the stub → `POST /api/v1/rag/retrieve` with a scope containing the
  document returns its chunks.

## 13. Decisions left to WBS-2 (within the constraints above)

Record each in [architecture-decisions.md](architecture-decisions.md):
- Extraction library.
- Exact target size within 800–1,200.
- Overlap value.
- Hyphenation and header/footer rules.
- Section-title heuristic.

Changing any of them after documents are indexed requires a new `indexing_version`.
