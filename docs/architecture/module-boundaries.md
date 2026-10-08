# Module Boundaries and Ownership

Every capability has exactly one owner. "Consumes" means the module uses an interface it does
not own and must not reimplement.

## 1. Responsibility matrix

| WBS | Module | Owns | Consumes | Must not |
| --- | --- | --- | --- | --- |
| **1** | Requirements & architecture | Shared contracts (`docs/architecture/*`), the contract code listed in §3, decision record | — | Implement features |
| **2** | Document ingestion (`ai-service/src/knot_ingest/`, proposed) | PDF text extraction, page artifacts, **chunking**, **document (passage) embeddings**, writing/deleting/verifying chunks in ChromaDB, ingestion job execution and status events, reindex and migration execution | Shared contract code (§3), `Storage` path rules, NestJS callback API | Touch MySQL; decide access; embed queries; search |
| **3** | RAG core (`ai-service/src/knot_rag/`, exists) | **Query embedding**, **scoped vector search**, context building, grounded generation, citation validation, support assessment, `/api/v1/rag/*` | Shared contract code, ChromaDB collections written by WBS-2 | Create collections; write chunks; chunk documents; decide access |
| **4** | NestJS backend | Auth, users, courses, memberships, documents (relational), visibility, authorized-scope derivation, upload handling, `Storage` interface, job orchestration (dispatch, sweeper, transitions), public API, internal callback API, error mapping | `/api/v1/rag/*`, `/api/v1/ingestion/*` | Call ChromaDB directly; embed; trust browser-supplied permissions |
| **5** | Frontend integration | API client, replacing mocks, status polling, citation → source viewer mapping, labels | Public NestJS API only | Call Python/ChromaDB; compute access |
| **6** | Question generation | Practice question generation (MCQ, T/F, open) from retrieved evidence, storing source `chunk_id`s | Evidence via NestJS → `/api/v1/rag/retrieve` | Own retrieval |
| **7** | Answer evaluation | Scoring student answers against course evidence | Same as WBS-6 | Own retrieval |
| **8** | Grounding measurement | Hallucination/support metrics, human labelling, semantic judge evaluation | `GroundedAnswer` payloads, `ai-service/src/knot_rag/evaluation/` | Change WBS-3 outputs |
| **9** | End-to-end integration | docker-compose, environment wiring, E2E flows | All public/internal APIs | — |
| **10** | Testing & QA | Test plans, contract tests, E2E tests | — | — |
| **11** | Delivery & docs | Final report, user docs | — | — |

## 2. No duplicated ownership: chunking, embeddings, search

| Capability | Owner | Code location | Shared rule |
| --- | --- | --- | --- |
| Text extraction | WBS-2 | `knot_ingest` | Produces the page artifact ([document-contract.md §7](document-contract.md#7-pageartifact)) |
| Chunking | WBS-2 | `knot_ingest` | Versioned by `indexing_version` |
| **Document** embeddings | WBS-2 | `knot_ingest` via `Embedder.embed_documents()` | Same `Embedder` class and **identical `EmbeddingConfiguration`** as WBS-3 |
| **Query** embeddings | WBS-3 | `knot_rag` via `Embedder.embed_query()` | Same as above |
| Chunk writes / deletes / verification | WBS-2 | `ChromaChunkWriter` (moves to WBS-2 ownership, decision A6) | Writes only into collections whose stamp matches the job's configuration |
| Vector search | WBS-3 | `ChromaChunkIndex` | Read-only; never creates collections |
| Access decision | WBS-4 | NestJS | Python only *enforces* the scope it receives |

## 3. Shared contract code (WBS-1 custodian)

These existing files are the executable form of the contracts. Changes require review by
**both WBS-2 and WBS-3**, a note in [architecture-decisions.md](architecture-decisions.md),
and passing WBS-3 tests.

| File (existing) | Contract |
| --- | --- |
| `ai-service/src/knot_rag/schemas/documents.py` | `DocumentMetadata`, `IndexedChunk`, `SourceLocation`, Chroma metadata key constants |
| `ai-service/src/knot_rag/retrieval/embedding.py` | `Embedder` protocol, `SentenceTransformerEmbedder`, `build_embedder` |
| `ai-service/src/knot_rag/retrieval/chroma_index.py` → `ChromaChunkWriter` | Collection stamp and write path (**owner: WBS-2**; reader `ChromaChunkIndex` stays WBS-3) |
| `ai-service/src/knot_rag/schemas/{retrieval,answer,common}.py` | `rag.v1` API (owner: WBS-3) |

WBS-2 **imports** these modules and does not copy them. If WBS-2 needs a contract change, it
proposes one via an ADR entry. It does not fork the code.

## 4. Process topology (decision A9, conditional)

- WBS-2 and WBS-3 run in **one Python deployable** (the FastAPI app in `ai-service`) as
  separate packages with separate routers:
  - `/api/v1/rag/*`: WBS-3.
  - `/api/v1/ingestion/*`: WBS-2.
- Ingestion runs on a **bounded in-process worker**. This is an MVP solution, **not** a
  durable queue. MySQL remains authoritative for job state. Restart recovery, stall detection,
  idempotent callbacks and fencing are mandatory: [document-lifecycle.md §4](document-lifecycle.md#4-in-process-worker-reliability).
- Because embedding is CPU-heavy, the worker runs at most `INGEST_WORKER_CONCURRENCY`
  (default **1**) jobs at a time in a thread separate from the request handlers. This keeps
  the Q&A latency of `/api/v1/rag/*` predictable.
- If ingestion load later interferes with Q&A, the same package can run as a second process
  (`uvicorn knot_ingest.main:app`) without contract changes.

## 5. Change control

| Change | Requires |
| --- | --- |
| New optional field in a contract | Owner PR + WBS-1 review; consumers ignore unknown fields |
| Renamed/removed field, changed meaning | New contract version (`rag.v2`, `ingest.v2`) + ADR + migration plan |
| Embedding configuration change | New `IndexVersion` + blue/green migration ([document-lifecycle.md §8](document-lifecycle.md#8-embedding-model-change-bluegreen-migration)) |
| Extraction/chunking code change that can alter text or boundaries | New `indexing_version` + reindex ([document-lifecycle.md §7](document-lifecycle.md#7-reindexing-same-embedding-configuration)) |
