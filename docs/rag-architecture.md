# RAG Core Pipeline — Architecture (WBS-3)

**Principle:** every claim the AI makes must be traceable to an identifiable passage of the
student's own course material. If there isn't enough evidence, the system says so.

## 1. Where WBS-3 sits

```
Browser (React)  ──HTTPS──▶  NestJS (WBS-4)  ──internal HTTP + token──▶  knot_rag (WBS-3, Python)
                               │  auth, enrolment, Prisma/MySQL               │
                               │  decides the authorized scope                ├──▶ ChromaDB (index written by WBS-2)
                               │                                              └──▶ LLM provider (configurable)
                               └─ stores answers / citations / metrics for WBS-6/7/8
```

- NestJS remains the only application backend. The Python service has no users, sessions or
  database of its own, and keeps no per-request state.
- WBS-2 writes chunks into ChromaDB under the contract in §4. WBS-3 only reads them; it never
  creates collections or embeddings of its own.

## 2. Repository audit (state at implementation time)

| Area | Finding | Consequence |
| --- | --- | --- |
| Frontend | Vite + React 19 (JSX), hash routing, all data mocked in `src/data/mock.js` | Left untouched. Its claim → cite → page/segment model shaped the response contract. |
| Backend | No NestJS app, no Prisma schema, no MySQL config | WBS-3 defines the integration contract; NestJS code samples are in `rag-integration.md`. |
| Python / AI | None | New self-contained `ai-service/` directory, so no conflicts with other modules. |
| Docker / CI | None | No infrastructure added; ChromaDB runs via `chroma run`. |
| Docs/tests | Empty `docs/`, `tests/` placeholders | RAG docs go in `docs/rag-*.md`; Python tests stay inside `ai-service/tests`. |

Planned-stack note: the brief mentions Next.js/TypeScript, but the frontend is actually Vite +
JSX. That does not affect WBS-3, which only talks to NestJS.

## 3. Components

| Module | Responsibility | Key types |
| --- | --- | --- |
| `schemas/` | Versioned (`rag.v1`) Pydantic contracts. Unknown fields are rejected. | `IndexedChunk`, `AuthorizedScope`, `RetrievedEvidence`, `GroundedAnswer`, `ErrorResponse` |
| `query/` | Validates and normalizes questions (NFC, control chars, whitespace). Keeps the original. Optional `QueryRewriter` hook, off by default. | `QueryProcessor`, `PreparedQuery` |
| `retrieval/` | `Embedder` and `ChunkIndex` ports; ChromaDB adapter; `RetrievalService` (scope → embed → filtered search → scope re-check → optional score floor) | `ChromaChunkIndex`, `ChromaChunkWriter`, `SearchScope` |
| `context/` | Deterministic selection: sort, dedup by id/text/containment, per-document cap, token budget, `E1…En` ids, delimited rendering | `ContextBuilder` |
| `generation/` | Provider-independent `LLMProvider`; OpenAI-compatible HTTP adapter; scripted and extractive offline providers; prompts; structured generation with validation and bounded retries | `GroundedGenerator`, `ModelAnswer` |
| `evidence/` | **Citation integrity** (`EvidenceMapper`) kept separate from **support assessment** (`SupportAssessor`) | `MappedClaim`, `HeuristicSupportAssessor` |
| `pipeline.py` | Orchestrates retrieve / answer and decides the outcome | `RagService` |
| `api/` | FastAPI: internal token auth, request IDs, body-size limit, error envelope, OpenAPI | `create_app` |
| `bootstrap.py` | Composition root: the only place configuration becomes objects (dependency injection) | `build_components` |
| `evaluation/` | Metric definitions with explicit denominators; dataset runner | `summarize`, `runner` |

No LangChain or LlamaIndex: the pipeline is small, and explicit code keeps citation
validation auditable without an extra framework.

## 4. Indexing contract with WBS-2

One Chroma collection per embedding model and chunking scheme (default `knot_chunks_v1`):

- **Collection metadata:** `hnsw:space = "cosine"`, `embedding_model = <model id>`,
  `embedding_dim = <int>`. The reader refuses a collection whose model or dimension differs
  from its own embedder (`ConfigurationError`), so the two sides can never drift silently.
- **Record:** `id = chunk_id`; `document = chunk text` (UTF-8, NFC); `embedding` from the
  shared model.
- **Record metadata** (exact keys; `None` is omitted, never stored as a fake value):

| Key | Type | Required | Meaning |
| --- | --- | --- | --- |
| `chunk_id` | str | ✔ | Stable id, recommended `{document_id}:{indexing_version}:{ordinal:03d}` |
| `document_id` | str | ✔ | Same id NestJS/Prisma uses for the document |
| `course_id` | str | ✔ | Same id NestJS uses for the course |
| `document_title` | str | ✔ | Display title |
| `document_type` | str | ✔ | `slide` \| `notes` \| `textbook` \| `past_exam` \| `other` |
| `indexing_version` | str | ✔ | Chunker/pipeline version |
| `owner_id` | str |  | Uploader (informational; access is decided by NestJS) |
| `page_count` | int |  | Pages in the document |
| `page_start`, `page_end` | int |  | 1-based page range of the chunk (equal for single-page chunks) |
| `char_start`, `char_end` | int |  | Offsets of this exact chunk text in the extracted document text |
| `section_title` | str |  | Slide or section heading |
| `x_*` | scalar |  | Free extras (for example `x_block_ids`) |

`IndexedChunk.to_chroma_metadata()` is the single source of truth for these names.
`ChromaChunkWriter` is a reference writer that WBS-2 may call directly.

## 5. Request flow (answer)

1. **Auth.** The internal token is checked with a constant-time comparison.
2. **Validation.** Pydantic rejects unknown fields, malformed ids, empty scope, oversized
   question (2,000 chars), `top_k > 50`, and bodies over 256 KB.
3. **Query prep.** The question is normalized; Turkish characters and technical tokens
   (LL, RR, LR, RL, AVL, BST, O(log n)) are preserved.
4. **Scope.** `course_id AND document_id IN (authorized ids)` is a *mandatory* `where` filter.
   `ChunkIndex` has no unscoped search method. If the scope holds no indexed chunk, the result
   is `UNAUTHORIZED_SCOPE` when those documents are indexed under another course, and
   `INDEX_NOT_READY` otherwise.
5. **Search.** Top-k by cosine similarity (`score = 1 − distance`, a ranking signal and not a
   probability). Every returned record is re-checked against the scope; mismatches are dropped
   and counted (`rejected_out_of_scope`).
6. **Context.** The deterministic `ContextBuilder` runs (see the module docstring).
7. **No evidence.** The response is `INSUFFICIENT_EVIDENCE / NO_RETRIEVED_EVIDENCE` with
   HTTP 200, and the LLM is not called.
8. **Generation.** Trusted rules go in the system message. The question and evidence go in
   delimited data sections of the user message, with delimiter look-alikes escaped.
   Temperature is 0 and JSON mode is on.
9. **Schema validation.** Output is parsed into `ModelAnswer`. Malformed output is retried
   once with a repair note, then becomes `GENERATION_FAILED`. Timeouts are never retried
   (`PROVIDER_TIMEOUT`).
10. **Citation integrity.** Ids that were not shown to the model are removed and reported as
    `UNKNOWN_EVIDENCE_ID`. Quotes are verified by exact (case- and whitespace-folded)
    matching; only verified quotes get highlight offsets.
11. **Support assessment.** Explicit criteria (§6) yield a per-claim status, which is
    aggregated with the frontend's `KnotStrength` rule.
12. **Outcome.** `ANSWERED` only if every claim is SUPPORTED, the model said `answered`, and
    nothing is listed as missing.

## 6. Support states — explicit criteria

Method `citation-lexical-v1` (`evidence/support.py`):

| State (UI) | Criteria |
| --- | --- |
| **SUPPORTED** (SIKI) | ≥1 citation resolves **and** the quote is found verbatim in a cited chunk **and** lexical coverage ≥ `SUPPORT_COVERAGE_SUPPORTED` (0.6) **and** every number in the claim appears in the cited evidence **and** the model did not mark it partial **and** no fabricated id is attached |
| **PARTIALLY_SUPPORTED** (GEVEŞEK) | Valid citation, but at least one SUPPORTED criterion fails (and the claim isn't UNSUPPORTED) |
| **UNSUPPORTED** (KOPUK) | No valid citation, **or** coverage < `SUPPORT_COVERAGE_PARTIAL` (0.3) with no verified quote |

Lexical coverage is the share of the claim's content tokens found in the cited evidence, using
5-character prefix matching as crude Turkish stemming. It is a proxy, not entailment, so
`semantically_verified` is always `false`. WBS-8 can plug in an NLI or LLM-judge assessor
through the `SupportAssessor` protocol without changing the API.

Answer-level state: all claims SUPPORTED gives SUPPORTED; no claim supported gives
UNSUPPORTED; anything else gives PARTIALLY_SUPPORTED. An answer whose claims are all
supported but which lists missing parts is downgraded to PARTIALLY_SUPPORTED.

## 7. Security

| Threat | Control |
| --- | --- |
| Cross-user / cross-course leakage | Scope comes from NestJS, not the student. Mandatory metadata filter, post-query re-check, and `get_chunks` scoped too. Tested against another course, another user's notes, and a buggy leaking index. |
| Forged scope | Only callers holding `RAG_INTERNAL_API_TOKEN` are accepted. The service must not be exposed publicly (bind to the private network). CORS is not relied on. |
| Prompt injection in documents | Evidence is rendered as delimited data; `<evidence`/`</evidence` inside text are escaped; the system prompt declares document text untrusted. Above all, **output is validated**: a model that obeys an injection still cannot cite unseen evidence or claim support without a verbatim quote. |
| Prompt injection in the question | The question is delimited and escaped; it never reaches the system message. |
| Unexpected model output | Strict schema with length and count limits, bounded retries, then `GENERATION_FAILED`. Nothing from the model is executed. |
| Input size | 2,000-char question, ≤ 1,000 scope ids, `top_k ≤ 50`, 256 KB body (by `Content-Length`; also configure a body limit in the reverse proxy or uvicorn). |
| Sensitive logging | Logs record ids, counts, latency, question length and a SHA-256 prefix. No question or document text unless `RAG_LOG_QUESTIONS=true`. Secrets are excluded from `repr`. |
| Error leakage | One error envelope; unhandled exceptions become `INTERNAL_ERROR` with no stack trace (the trace goes to server logs only). |
| Provider failures | Classified as timeout, unavailable, rate limit, auth, or bad response, then mapped to `PROVIDER_TIMEOUT` (504) or `GENERATION_FAILED` (502) with a `retryable` flag. |
| ChromaDB down | Lazy client: the service starts, `/ready` returns 503, and requests return `RETRIEVAL_UNAVAILABLE` (503). |

## 8. Design decisions and alternatives

- **Single collection plus metadata filter** rather than a collection per course: simpler for
  WBS-2 and cheap re-indexing. Isolation is enforced by code paths with no unscoped search,
  and tested.
- **Quote-based citations.** The model must copy a verbatim span. This makes citations
  mechanically checkable and gives real highlight offsets without guessing coordinates.
- **Abstain before generating.** No evidence means the LLM is never called, so there's nothing
  to hallucinate from.
- **Optional improvements not implemented** (query rewriting, hybrid BM25, reranking,
  neighbour chunks): add them only if the evaluation set shows a measurable gain with the real
  embedding model.
