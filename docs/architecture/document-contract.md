# Canonical Document & AI Contracts

This is the single reference for data exchanged between WBS-2, WBS-3, WBS-4 and WBS-5.

- **Existing WBS-3 contracts (`rag.v1`) are preserved unchanged.** This document references
  them and adds the ingestion contracts (`ingest.v1`, `pages.v1`).
- JSON blocks marked `<!-- contract: X -->` are machine-checked against the existing Pydantic
  models, or against the rules stated here (§13).
- All examples describe one 3-page document, so IDs, offsets and pages agree across them.

## 1. Conventions (apply to every contract)

| Topic | Rule |
| --- | --- |
| Identifiers | Match WBS-3 `Identifier`: `^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$`. Server-generated cuids for users, courses, documents, jobs, index versions. **Never reused.** |
| `chunk_id` | `{document_id}:{indexing_version}:{ordinal}`, ordinal zero-padded to at least 3 digits (`001`, `1042`). Stable: the same document, `indexing_version` and source always give the same IDs. Consumers must not parse it. |
| Pages | `page_start` / `page_end` are **1-based physical PDF page indices** (not printed page labels). A chunk spanning pages keeps the range. Unknown means absent, never `0`. |
| Text | UTF-8, Unicode **NFC**, no control characters except `\n`. |
| Document text | `"\n\n".join(page_texts)`, the exact concatenation of `PageArtifact.pages[].text` in page order. Empty pages contribute `""`. |
| Offsets | `char_start` / `char_end` are **Unicode code-point** offsets into the document text, half-open `[start, end)`. Invariant: `chunk.text == document_text[char_start:char_end]`. JavaScript must slice with code-point-aware methods (`Array.from(text)`), not UTF-16 indices (§10). |
| Versions | Every payload carries `schema_version`: `rag.v1`, `ingest.v1` or `pages.v1`. Additive optional fields are allowed within a version; consumers ignore unknown response fields. |
| Enums | `document_type` ∈ `slide`, `notes`, `textbook`, `past_exam`, `other` (WBS-3 `DocumentType`) |

## 2. DocumentRecord (MySQL, authoritative) → `DocumentMetadata` (WBS-3)

`DocumentRecord` is the public/NestJS view of the `Document` row
([data-model.md](data-model.md)). WBS-3's `DocumentMetadata` is the subset copied into every
chunk.

| Required concept | Where it lives | Field |
| --- | --- | --- |
| document ID | MySQL + Chroma | `Document.id` → `document_id` |
| chunk ID | Chroma | `chunk_id` (record ID) |
| course ID | MySQL + Chroma | `courseId` → `course_id` |
| owner / access scope | MySQL (`ownerId`, `visibility`, memberships); Chroma `owner_id` is informational only | Scope is passed per request ([api-contracts.md §4](api-contracts.md#4-nestjs--python-rag-existing-wbs-3)) |
| source filename | **MySQL only** | `originalFilename` (NestJS overlays it onto answers) |
| source type | MySQL + Chroma | `documentType` → `document_type`; file format in `mimeType` (MySQL) |
| source text | Chroma (chunk text) + storage (page artifact) | `IndexedChunk.text`, `PageArtifact.pages[].text` |
| page range | Chroma | `page_start`, `page_end` |
| text offsets | Chroma | `char_start`, `char_end` |
| embedding model / revision / dimension | MySQL `IndexVersion` + Chroma collection stamp | §4 |
| index version | MySQL `IndexVersion.collectionName` (collection) + chunk `indexing_version` (chunker) | §5 |

<!-- contract: DocumentMetadata -->
```json
{
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "course_id": "cm2k7v0aa000008l4vy000211",
  "owner_id": "cm2k7u9zz000008l4instr001",
  "title": "Hafta 4 — AVL Ağaçları",
  "document_type": "slide",
  "indexing_version": "c1",
  "page_count": 3
}
```

## 3. IndexedChunk (WBS-2 output, WBS-3 input), unchanged

This is the existing `knot_rag.schemas.documents.IndexedChunk`. WBS-2 constructs it and writes
it with `to_chroma_metadata()`. The only new convention is `extra.job_id` (stored as the
metadata key `x_job_id` through the existing `x_` extension mechanism), used for write
verification (ADR-018).

<!-- contract: IndexedChunk -->
```json
{
  "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
  "document": {
    "document_id": "cm2k8x1q0000108l4h7r2c9ab",
    "course_id": "cm2k7v0aa000008l4vy000211",
    "owner_id": "cm2k7u9zz000008l4instr001",
    "title": "Hafta 4 — AVL Ağaçları",
    "document_type": "slide",
    "indexing_version": "c1",
    "page_count": 3
  },
  "text": "Ağaç dengesizleşirse en kötü durum O(n) olur.\n\nAVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.",
  "location": {
    "page_start": 2,
    "page_end": 3,
    "char_start": 110,
    "char_end": 298,
    "section_title": "AVL Ağaçları: Denge Koşulu"
  },
  "extra": { "job_id": "cm2k8x9jb000208l4job00001" }
}
```

The resulting Chroma record: `id = chunk_id`, `document = text`, `embedding` from
`Embedder.embed_documents`, and this metadata:

<!-- contract: ChromaMetadata -->
```json
{
  "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "course_id": "cm2k7v0aa000008l4vy000211",
  "owner_id": "cm2k7u9zz000008l4instr001",
  "document_title": "Hafta 4 — AVL Ağaçları",
  "document_type": "slide",
  "indexing_version": "c1",
  "page_count": 3,
  "page_start": 2,
  "page_end": 3,
  "char_start": 110,
  "char_end": 298,
  "section_title": "AVL Ağaçları: Denge Koşulu",
  "x_job_id": "cm2k8x9jb000208l4job00001"
}
```

## 4. EmbeddingConfiguration

WBS-2 (document embeddings) and WBS-3 (query embeddings) must use the **complete, identical**
configuration. One configuration equals one `IndexVersion` equals one Chroma collection.

<!-- contract: EmbeddingConfiguration -->
```json
{
  "backend": "sentence_transformers",
  "model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
  "revision": null,
  "dimension": 384,
  "query_prefix": "",
  "document_prefix": "",
  "normalize": true,
  "distance": "cosine"
}
```

| Field | Meaning | Existing WBS-3 setting |
| --- | --- | --- |
| `backend` | `sentence_transformers` (production) or `hashing` (tests only, never an ACTIVE index) | `EMBEDDING_BACKEND` |
| `model` | Hugging Face model ID | `EMBEDDING_MODEL` |
| `revision` | Model commit hash; `null` = not yet pinned (**PROVISIONAL**, must be pinned before validation results are recorded) | `EMBEDDING_REVISION` |
| `dimension` | Vector size; verified when the model loads | collection `embedding_dim` |
| `query_prefix` / `document_prefix` | Prepended to queries / passages (the "passage prefix"; e.g. E5 uses `"query: "` / `"passage: "`) | `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_DOCUMENT_PREFIX` |
| `normalize` | L2-normalized vectors (`normalize_embeddings=True` in the existing embedder) | fixed `true` |
| `distance` | Chroma `hnsw:space` | fixed `cosine` |

- **Fingerprint:**
  `"sha256:" + sha256(json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=False))`.
  For the example above it is
  `sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d`.
- **Collection stamp after C-1** (additive WBS-3 change, ADR-006):
  - **Existing keys:** `embedding_model`, `embedding_dim`, `hnsw:space`.
  - **New keys:** `embedding_backend`, `embedding_revision` (`""` when `null`),
    `embedding_query_prefix`, `embedding_document_prefix`, `embedding_normalize`,
    `embedding_fingerprint`, `index_version_id`.
- **Until C-1 lands:** the reader checks only model and dimension, so NestJS must also compare
  fingerprints ([api-contracts.md §6](api-contracts.md#6-consistency-guard-nestjs--python)).

**Model status: PROVISIONAL.**
- The default above is the current WBS-3 code default and has **not** been validated on K-not
  data.
- Hugging Face access was verified in a separate team environment, but no benchmark has been
  run.
- The selection procedure is fixed in ADR-010.

## 5. Two version levels

| Name | Granularity | Changes when | Effect |
| --- | --- | --- | --- |
| `IndexVersion` (`collectionName`, e.g. `knot_chunks_v1`) | One Chroma collection; one `EmbeddingConfiguration` + default chunker | Embedding configuration changes | Blue/green migration ([document-lifecycle.md §8](document-lifecycle.md#8-embedding-model-change-bluegreen-migration)) |
| `indexing_version` (existing chunk field, e.g. `c1`) | Extraction + chunking code version | Any change that can alter extracted text, offsets or chunk boundaries | Per-document reindex ([document-lifecycle.md §7](document-lifecycle.md#7-reindexing-same-embedding-configuration)); new chunk IDs and a new page artifact |

## 6. IngestionJobRequest (`IndexingJob`): NestJS → Python

`POST /api/v1/ingestion/jobs`. `document` is exactly `DocumentMetadata` (§2).

<!-- contract: IngestionJobRequest -->
```json
{
  "schema_version": "ingest.v1",
  "job_id": "cm2k8x9jb000208l4job00001",
  "attempt": 1,
  "kind": "INITIAL",
  "document": {
    "document_id": "cm2k8x1q0000108l4h7r2c9ab",
    "course_id": "cm2k7v0aa000008l4vy000211",
    "owner_id": "cm2k7u9zz000008l4instr001",
    "title": "Hafta 4 — AVL Ağaçları",
    "document_type": "slide",
    "indexing_version": "c1",
    "page_count": null
  },
  "source": {
    "storage_key": "documents/cm2k8x1q0000108l4h7r2c9ab/original.pdf",
    "mime_type": "application/pdf",
    "sha256": "4b1f0e7c2a9d5b3e8f6a1c0d9e2b7a4f5c3d8e1b6a9f0c2d7e4b1a8f5c3e9d20",
    "size_bytes": 1843200,
    "original_filename": "Hafta4_AVL_Agaclari.pdf"
  },
  "index": {
    "index_version_id": "cm2k7iv01000008l4idxv0001",
    "collection": "knot_chunks_v1",
    "embedding": {
      "backend": "sentence_transformers",
      "model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
      "revision": null,
      "dimension": 384,
      "query_prefix": "",
      "document_prefix": "",
      "normalize": true,
      "distance": "cosine"
    },
    "embedding_fingerprint": "sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d"
  }
}
```

| Field | Rule |
| --- | --- |
| `kind` | `INITIAL`, `RETRY`, `REINDEX` change the document's user-visible status; `MIGRATION` writes into a BUILDING collection and never changes it |
| `document.indexing_version` | Chunker version WBS-2 must use. WBS-2 rejects versions it does not implement (`UNSUPPORTED_INDEXING_VERSION`). |
| `source.storage_key` | Relative to `STORAGE_ROOT`. Python rejects absolute paths, `..`, and symlinks leaving the root. |
| `source.original_filename` | For logs and diagnostics only. Never used to build paths. |
| `index.*` | Python refuses the job (`INDEX_CONFIG_MISMATCH`) if it cannot load exactly this configuration, or if the collection exists with a different stamp |

## 7. PageArtifact

Written by WBS-2, served by NestJS to the source viewer. Storage key:
`documents/{document_id}/pages.{indexing_version}.json`. It is written to a temp name and
atomically renamed **after** the chunks are verified (ADR-005). Artifacts of earlier
`indexing_version`s are kept until the document is deleted, so citations in stored answers
still resolve.

<!-- contract: PageArtifact -->
```json
{
  "schema_version": "pages.v1",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "indexing_version": "c1",
  "page_count": 3,
  "separator": "\n\n",
  "pages": [
    { "page": 1, "char_start": 0, "char_end": 36, "text": "Veri Yapıları · Hafta 4\nAVL Ağaçları" },
    { "page": 2, "char_start": 38, "char_end": 155, "text": "İkili Arama Ağacı (BST)\nArama, ekleme ve silme ortalama O(log n) sürer. Ağaç dengesizleşirse en kötü durum O(n) olur." },
    { "page": 3, "char_start": 157, "char_end": 298, "text": "AVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır." }
  ]
}
```

**Invariants**
- `pages[i].char_end - pages[i].char_start == len(pages[i].text)` (code points).
- `pages[i+1].char_start == pages[i].char_end + 2`.
- `len(pages) == page_count`, with pages numbered 1..`page_count` without gaps.

**Limitation (accepted, A4):** extracted text does **not** reproduce the PDF layout. Columns
may be serialized in extractor order; tables become text rows; diagrams and images are absent;
math is reduced to its text layer. The viewer offers the original PDF download for layout
(`GET /documents/:id/file`).

## 8. IngestionEvent (`IndexingStatus`): Python → NestJS

`POST /internal/v1/ingestion-jobs/{job_id}/events`.

<!-- contract: IngestionEvent -->
```json
{
  "schema_version": "ingest.v1",
  "job_id": "cm2k8x9jb000208l4job00001",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "attempt": 1,
  "seq": 7,
  "worker_id": "ai-7f3a91",
  "type": "SUCCEEDED",
  "stage": "INDEXING",
  "progress": 1.0,
  "emitted_at": "2026-10-07T21:14:03Z",
  "result": {
    "page_count": 3,
    "chunk_count": 2,
    "indexing_version": "c1",
    "collection": "knot_chunks_v1",
    "embedding_fingerprint": "sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d",
    "pages_artifact_key": "documents/cm2k8x1q0000108l4h7r2c9ab/pages.c1.json"
  },
  "error": null
}
```

| Field | Rule |
| --- | --- |
| `type` | `STAGE` (entering a stage), `HEARTBEAT` (every ≤ 30 s while running), `SUCCEEDED`, `FAILED` |
| `stage` | `EXTRACTING`, `CHUNKING`, `EMBEDDING` or `INDEXING`. `INDEXING` covers the Chroma write and read-back verification. |
| `seq` | Strictly increasing per job, starting at 1. NestJS ignores `seq ≤ lastEventSeq` (idempotency). |
| `progress` | 0–1, informational only |
| `result` | Required for `SUCCEEDED`; `page_count` may also appear in `STAGE` events after extraction |
| `error` | Required for `FAILED`: `{ "code", "message", "retryable" }`. Codes are in [document-lifecycle.md §5](document-lifecycle.md#5-error-codes-and-retry-policy). `message` is safe for logs and contains no document text. |

Failure example:

<!-- contract: IngestionEvent -->
```json
{
  "schema_version": "ingest.v1",
  "job_id": "cm2k8x9jb000208l4job00001",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "attempt": 1,
  "seq": 3,
  "worker_id": "ai-7f3a91",
  "type": "FAILED",
  "stage": "EXTRACTING",
  "progress": 0.1,
  "emitted_at": "2026-10-07T21:12:41Z",
  "result": null,
  "error": { "code": "NO_TEXT_LAYER", "message": "No extractable text on 32 of 32 pages.", "retryable": false }
}
```

## 9. Public document status (`IndexingStatus` as seen by the frontend)

Part of `DocumentDto` ([api-contracts.md §3](api-contracts.md#3-public-api-nestjs--browser)).

<!-- contract: DocumentDto -->
```json
{
  "id": "cm2k8x1q0000108l4h7r2c9ab",
  "course_id": "cm2k7v0aa000008l4vy000211",
  "owner_id": "cm2k7u9zz000008l4instr001",
  "visibility": "COURSE",
  "document_type": "slide",
  "title": "Hafta 4 — AVL Ağaçları",
  "original_filename": "Hafta4_AVL_Agaclari.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 1843200,
  "page_count": 3,
  "created_at": "2026-10-07T21:11:58Z",
  "status": {
    "state": "READY",
    "ui_state": "ready",
    "stage": null,
    "updated_at": "2026-10-07T21:14:03Z",
    "error": null
  },
  "can_delete": true,
  "notices": []
}
```

`ui_state` maps directly onto the existing frontend keys (`src/data/academic.js`
`MATERIAL_STATES`):

| `state` | `ui_state` | Label |
| --- | --- | --- |
| `UPLOADED` | `uploaded` | Yüklendi |
| `EXTRACTING` | `reading` | Okunuyor |
| `CHUNKING`, `EMBEDDING`, `INDEXING` | `preparing` | Hazırlanıyor |
| `READY` | `ready` | Hazır |
| `FAILED` | `error` | Sorun var (`error.message_tr` explains why) |
| `DELETING` | — | Not listed (filtered out) |

Frontend type labels (WBS-5 mapping; the backend sends only `document_type`):

| `document_type` | Current frontend `type` | Label |
| --- | --- | --- |
| `slide` | `slayt` | Slayt |
| `notes` | `not` | Not |
| `past_exam` | `sinav` | Geçmiş sınav |
| `textbook` | (was `pdf`) | Kitap |
| `other` | (was `pdf`) | Belge |

The frontend's `pdf` value is a file format, not a role. Format comes from `mime_type`, which
is always `application/pdf` in Phase 1 (ADR-004).

## 10. Retrieval and answer contracts (existing `rag.v1`, unchanged)

Full specification and examples: [`docs/rag-api-contract.md`](../rag-api-contract.md).

**RetrievalRequest** (`RetrieveRequest` / `AnswerRequest`): built by NestJS only. `scope` is
derived server-side ([api-contracts.md §5](api-contracts.md#5-authorized-scope-derivation)).

<!-- contract: RetrieveRequest -->
```json
{
  "schema_version": "rag.v1",
  "request_id": "req-01JAB7Q",
  "question": "AVL ağacında yükseklik farkı en fazla kaç olabilir?",
  "scope": {
    "user_id": "cm2k7u9zz000008l4stud0001",
    "course_id": "cm2k7v0aa000008l4vy000211",
    "document_ids": ["cm2k8x1q0000108l4h7r2c9ab"]
  },
  "params": { "top_k": 8, "max_evidence": 6 }
}
```

**RetrievedEvidence**: one item of `RetrieveResponse.evidence` / `GroundedAnswer.evidence`.
`evidence_id` is response-local; **persist `chunk_id`**.

<!-- contract: RetrievedEvidence -->
```json
{
  "evidence_id": "E1",
  "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "course_id": "cm2k7v0aa000008l4vy000211",
  "document_title": "Hafta 4 — AVL Ağaçları",
  "document_type": "slide",
  "indexing_version": "c1",
  "location": { "page_start": 2, "page_end": 3, "char_start": 110, "char_end": 298, "section_title": "AVL Ağaçları: Denge Koşulu" },
  "label": "Slayt · s.2–3",
  "text": "Ağaç dengesizleşirse en kötü durum O(n) olur.\n\nAVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.",
  "score": 0.71,
  "rank": 1,
  "truncated": false
}
```

**Citation**: inside `GroundedAnswer.claims[].citations[]`. `highlight` exists **only** when
the quote was found verbatim (`quote_verified`). Its offsets are character offsets and
**never** layout coordinates.

<!-- contract: Citation -->
```json
{
  "evidence_id": "E1",
  "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
  "document_id": "cm2k8x1q0000108l4h7r2c9ab",
  "document_title": "Hafta 4 — AVL Ağaçları",
  "location": { "page_start": 2, "page_end": 3, "char_start": 110, "char_end": 298, "section_title": "AVL Ağaçları: Denge Koşulu" },
  "label": "Slayt · s.2–3",
  "quote": "farkın en fazla 1",
  "quote_verified": true,
  "highlight": { "chunk_char_start": 142, "chunk_char_end": 159, "document_char_start": 252, "document_char_end": 269 }
}
```

**GroundedAnswer**: abbreviated example. All fields are defined in
[`rag-api-contract.md`](../rag-api-contract.md).

<!-- contract: GroundedAnswer -->
```json
{
  "schema_version": "rag.v1",
  "answer_id": "0b6c2f8e-5d1a-4c3e-9f7a-2e8d4b1c6a90",
  "request_id": "req-01JAB7Q",
  "question": "AVL ağacında yükseklik farkı en fazla kaç olabilir?",
  "course_id": "cm2k7v0aa000008l4vy000211",
  "outcome": "ANSWERED",
  "support_status": "SUPPORTED",
  "support_label": "SIKI",
  "answer_text": "AVL ağacında her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla 1 olabilir.",
  "claims": [
    {
      "claim_id": "c1",
      "claim_text": "AVL ağacında her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki fark en fazla 1 olabilir.",
      "cited_evidence_ids": ["E1"],
      "citations": [
        {
          "evidence_id": "E1",
          "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
          "document_id": "cm2k8x1q0000108l4h7r2c9ab",
          "document_title": "Hafta 4 — AVL Ağaçları",
          "location": { "page_start": 2, "page_end": 3, "char_start": 110, "char_end": 298, "section_title": "AVL Ağaçları: Denge Koşulu" },
          "label": "Slayt · s.2–3",
          "quote": "farkın en fazla 1",
          "quote_verified": true,
          "highlight": { "chunk_char_start": 142, "chunk_char_end": 159, "document_char_start": 252, "document_char_end": 269 }
        }
      ],
      "support_status": "SUPPORTED",
      "support_label": "SIKI",
      "support_explanation": null,
      "assessment": {
        "method": "citation-lexical-v2", "citations_valid": true, "quote_verified": true,
        "lexical_coverage": 0.83, "numbers_consistent": true, "model_marked_partial": false,
        "semantically_verified": false, "verification": "HEURISTIC", "quote_coverage": 0.83,
        "question_relevance": 0.8, "negation_consistent": true, "addresses_question": true, "judge_verdict": null
      },
      "support_confirmed": false
    }
  ],
  "evidence": [
    {
      "evidence_id": "E1",
      "chunk_id": "cm2k8x1q0000108l4h7r2c9ab:c1:002",
      "document_id": "cm2k8x1q0000108l4h7r2c9ab",
      "course_id": "cm2k7v0aa000008l4vy000211",
      "document_title": "Hafta 4 — AVL Ağaçları",
      "document_type": "slide",
      "indexing_version": "c1",
      "location": { "page_start": 2, "page_end": 3, "char_start": 110, "char_end": 298, "section_title": "AVL Ağaçları: Denge Koşulu" },
      "label": "Slayt · s.2–3",
      "text": "Ağaç dengesizleşirse en kötü durum O(n) olur.\n\nAVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.",
      "score": 0.71,
      "rank": 1,
      "truncated": false
    }
  ],
  "insufficient_evidence": null,
  "citation_issues": [],
  "retrieval": {
    "candidates": 2, "rejected_out_of_scope": 0, "below_min_score": 0, "duplicates_removed": 0,
    "dropped_by_limits": 1, "context_tokens_estimate": 103,
    "embedding_model": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
  },
  "generation": { "provider": "openai_compatible", "model": "example-model", "prompt_version": "grounded-answer.v1", "attempts": 1, "latency_ms": 1840 },
  "support_confirmed": false,
  "verification": "HEURISTIC",
  "question_coverage": { "method": "key-term-stem-v1", "key_terms": ["AVL", "ağacında", "yükseklik", "farkı", "fazla"], "uncovered_terms": [], "ratio": 1.0, "absent_from_context": [] }
}
```

### Citation → source viewer mapping (WBS-5)

1. Select a claim: `claims[i]`.
2. Find its evidence: `claims[i].citations[j].evidence_id` resolves to `evidence[k]` with the
   same `evidence_id`. This is guaranteed by WBS-3, which removes fabricated IDs.
3. Identify the document: `citation.document_id`. The display name comes from the NestJS
   `documents` map ([api-contracts.md §3.4](api-contracts.md#34-answers)).
4. Open the page: `GET /documents/{document_id}/pages/{location.page_start}?indexing_version={indexing_version}`.
   `indexing_version` is the middle segment of `chunk_id`, which is also present on
   `evidence[k].indexing_version`.
5. Highlight: if `citation.highlight.document_char_start` is present, the page-relative range
   is `document_char_* − page.char_start`, clipped to the page; a multi-page span continues on
   the next page. In the example: page 3 `char_start` = 157, so 252−157 = 95 and 269−157 = 112;
   `pages[3].text[95:112]` = `"farkın en fazla 1"`.
6. No highlight (quote not verified, chunk truncated, or offsets unknown): show
   `evidence[k].text` as the **source excerpt** and do not mark the page.

```js
// Code-point-safe slice (offsets are Unicode code points, not UTF-16 units)
const cpSlice = (text, start, end) => Array.from(text).slice(start, end).join('')
```

The frontend's `seg` (mock block ID) is replaced by `chunk_id` + `highlight`; `strength` is
derived from `support_status` ([`rag-integration.md`](../rag-integration.md#mapping-to-the-current-frontend-shape)).

## 11. ErrorResponse (one envelope for every API)

The shape equals WBS-3 `ErrorResponse`. Python uses the `rag.v1` code set; NestJS uses the
public code set in [api-contracts.md §7](api-contracts.md#7-error-codes).

<!-- contract: ErrorResponse -->
```json
{
  "schema_version": "rag.v1",
  "error": {
    "code": "INDEX_NOT_READY",
    "message": "None of the authorized documents has indexed content yet.",
    "request_id": "req-01JAB7Q",
    "retryable": true,
    "details": { "course_id": "cm2k7v0aa000008l4vy000211", "document_count": 1 }
  }
}
```

## 12. Compatibility summary

| Contract | Status | Change vs. WBS-3 at `13ea172` |
| --- | --- | --- |
| `DocumentMetadata`, `IndexedChunk`, `SourceLocation`, Chroma metadata keys | Existing | None. `x_job_id` uses the existing `extra`/`x_` mechanism. |
| `RetrieveRequest`, `AnswerRequest`, `RetrieveResponse`, `GroundedAnswer`, `Citation`, `ErrorResponse` | Existing | None |
| Collection stamp | Existing (partial) | C-1 adds keys; additive, readers ignore unknown keys (ADR-006) |
| `EmbeddingConfiguration`, `IngestionJobRequest`, `IngestionEvent`, `PageArtifact`, `DocumentDto` | **New** | — |
| Frontend `type`, `seg`, material `id` = filename | Mock only | Replaced by `document_type`, `chunk_id` + `highlight`, `document_id` (WBS-5) |

## 13. Validation

Every `<!-- contract: X -->` example in `docs/architecture/` is checked as follows:
- **Existing models:** parsed by the existing Pydantic models (`DocumentMetadata`,
  `IndexedChunk`, `RetrieveRequest`, `RetrievedEvidence`, `Citation`, `GroundedAnswer`,
  `ErrorResponse`).
- **Chroma metadata:** must equal `IndexedChunk.to_chroma_metadata()`.
- **Offsets:** chunk and citation offsets are checked against the `PageArtifact` text.
- **Fingerprint:** recomputed.
- **New contracts:** checked for the required fields and enums listed above.

The results of the last run are in [architecture-decisions.md §4](architecture-decisions.md#4-validation-record).
