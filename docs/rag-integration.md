# RAG Integration Guide — Team Handoff

How the other work packages connect to WBS-3 without knowing its internals. The contract
is `rag.v1` (see [`rag-api-contract.md`](rag-api-contract.md)); the indexing contract is in
[`rag-architecture.md` §4](rag-architecture.md#4-indexing-contract-with-wbs-2).

> **WBS-1 (2026-10-08):** the cross-module architecture is now defined in
> [`docs/architecture/`](architecture/system-overview.md). Where this guide and those documents
> differ (ingestion jobs, lifecycle, data model, visibility, public API), **`docs/architecture/`
> is authoritative**. This guide remains the reference for using the WBS-3 API.

---

## WBS-2 — Document ingestion

> Superseded in detail by [`architecture/wbs2-handoff.md`](architecture/wbs2-handoff.md) (job
> protocol, delete-first + verification, page artifacts, offsets, events). The requirements
> below remain valid.

You own parsing, chunking, embedding and writing to ChromaDB. WBS-3 reads exactly what you
write, so the following are **contract requirements**:

1. **Same embedding model on both sides.** Agree on one model id; the default is
   `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` (384-d, Turkish-capable).
   Stamp the collection with it. If you choose an E5 model, index with the prefix
   `"passage: "` and tell WBS-3 to set `EMBEDDING_QUERY_PREFIX="query: "`.
2. **One collection** (`CHROMA_COLLECTION`, default `knot_chunks_v1`) with
   `hnsw:space=cosine`. Moving to a different model or chunking scheme means a new collection
   name, never mixed embeddings in one collection.
3. **Metadata keys exactly as listed** in the architecture doc §4. Never store placeholder
   values: an unknown page is *absent*, not `0` or `-1`.
4. **Stable `chunk_id`**, recommended `{document_id}:{indexing_version}:{ordinal:03d}`.
   Answers stored by NestJS reference chunk ids, so re-indexing the same version must
   reproduce the same ids. A new chunker version gets a new `indexing_version`.
5. **Page ranges:** a chunk spanning pages 2–3 has `page_start=2, page_end=3`. Don't force
   one page per chunk.
6. **Offsets (optional but valuable):** if `char_start/char_end` are set, they must be the
   offsets of *this exact chunk text* in your extracted document text, so the frontend can
   highlight. If you can produce PDF coordinates (bounding boxes), propose an `x_` extension
   and WBS-3 will pass it through.
7. **Text as NFC UTF-8**, no control characters. Keep LL/RR/LR/RL, O(log n), ≥, −, etc.
8. **Deleting or re-uploading a document:** delete by `document_id` before upserting the new
   version. `ChromaChunkWriter.delete_document` does this.
9. Report readiness to NestJS (Prisma `Document.status = READY`) **after** the upsert
   commits. WBS-3 returns `409 INDEX_NOT_READY` for scopes with nothing indexed.

The quickest compliant path is to reuse the reference writer:

```python
from knot_rag.schemas import IndexedChunk, DocumentMetadata, SourceLocation
from knot_rag.retrieval.chroma_index import ChromaChunkWriter, build_chroma_client
from knot_rag.retrieval.embedding import build_embedder

doc = DocumentMetadata(document_id="doc-123", course_id="veri-yapilari", owner_id="u-ayse",
                       title="Hafta 4 — AVL Ağaçları", document_type="slide",
                       indexing_version="v1", page_count=32)
chunks = [IndexedChunk(chunk_id="doc-123:v1:001", document=doc, text="AVL ağacı, ...",
                       location=SourceLocation(page_start=18, section_title="Denge Koşulu"))]
writer = ChromaChunkWriter(build_chroma_client("http", "localhost", 8000, ""), "knot_chunks_v1",
                           build_embedder("sentence_transformers", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"))
writer.upsert(chunks)
```

The test fixture `ai-service/tests/fixtures/corpus.json` shows complete, valid chunks
(multi-page, missing page, offsets).

---

## WBS-4 — NestJS backend

NestJS authenticates the student, decides what they may read, calls WBS-3, persists the
result, and shapes it for the frontend.

### Building the scope (the critical part)

```ts
// Never take document ids from the request body as-is.
const docs = await prisma.document.findMany({
  where: {
    courseId,
    status: 'READY',                        // indexed by WBS-2
    OR: [{ visibility: 'COURSE' }, { ownerId: user.id }], // shared materials + own uploads
    course: { enrollments: { some: { userId: user.id } } },
  },
  select: { id: true },
});
if (docs.length === 0) throw new NotFoundException('Bu derste hazır materyal yok.');
const scope = { user_id: user.id, course_id: courseId, document_ids: docs.map(d => d.id) };
```

(Field names are illustrative; adapt them to the real Prisma schema. If the student picked
specific materials in the UI, intersect their selection with this list.)

### Calling the service

```ts
// rag.client.ts
@Injectable()
export class RagClient {
  constructor(private readonly http: HttpService, private readonly config: ConfigService) {}

  async answer(question: string, scope: RagScope, requestId: string): Promise<GroundedAnswer> {
    try {
      const { data } = await firstValueFrom(this.http.post<GroundedAnswer>(
        `${this.config.get('RAG_URL')}/api/v1/rag/answer`,
        { question, scope, request_id: requestId },
        {
          headers: { Authorization: `Bearer ${this.config.get('RAG_INTERNAL_API_TOKEN')}`, 'X-Request-ID': requestId },
          timeout: 35_000,              // > LLM_TIMEOUT_SECONDS
        },
      ));
      return data;
    } catch (e) {
      const err = e?.response?.data?.error;   // { code, message, retryable, request_id }
      throw mapRagError(err);                 // e.g. 409 INDEX_NOT_READY → "Materyaller hazırlanıyor"
    }
  }
}
```

- Network: keep the RAG service on the private network (Docker network or localhost). The
  shared token is the authentication mechanism; CORS is irrelevant because browsers must not
  reach this service.
- `outcome = INSUFFICIENT_EVIDENCE` is HTTP **200**: render it as KOPUK, not as an error.
- Retry only when `error.retryable` is true, at most once, with backoff.

### Suggested persistence (proposal; the schema belongs to WBS-4)

> The MVP schema is now [`architecture/data-model.md`](architecture/data-model.md). The
> `Answer` model below corresponds to the later `QaInteraction` entity there.

```prisma
model Answer {
  id            String   @id            // GroundedAnswer.answer_id
  requestId     String
  userId        String
  courseId      String
  question      String   @db.Text
  outcome       String                  // ANSWERED | PARTIALLY_ANSWERED | INSUFFICIENT_EVIDENCE
  supportStatus String                  // SUPPORTED | PARTIALLY_SUPPORTED | UNSUPPORTED
  schemaVersion String                  // "rag.v1"
  payload       Json                    // full GroundedAnswer for replay and WBS-8 audits
  createdAt     DateTime @default(now())
  claims        AnswerClaim[]
}
model AnswerClaim {
  id            String @id @default(cuid())
  answerId      String
  claimId       String                  // c1, c2 …
  text          String @db.Text
  supportStatus String
  chunkIds      Json                    // stable chunk ids from citations[].chunk_id
  answer        Answer @relation(fields: [answerId], references: [id])
}
```

Store `chunk_id`, never `evidence_id` (E1, E2 are only meaningful inside one response).

### Mapping to the current frontend shape

The frontend mocks (`src/data/mock.js`) use `claims[].cites[] = {doc, page, seg, label, strength, note}`
and `gap`/`unsupported` flags. A direct mapping:

```js
const toUiClaims = (a) => a.claims.map((c) => ({
  id: c.claim_id,
  text: c.claim_text,
  unsupported: c.support_status === 'UNSUPPORTED',
  gap: c.support_status === 'UNSUPPORTED',
  detail: c.support_status === 'UNSUPPORTED' ? c.support_explanation : undefined,
  cites: c.citations.map((x) => ({
    doc: x.document_id,
    page: x.location.page_start,          // may be null → open document start, show no page
    seg: x.chunk_id,                      // replaces mock block ids
    label: x.label,                       // "Slayt · s.18"
    strength: c.support_status === 'SUPPORTED' ? 'full' : 'partial',
    note: c.support_status === 'PARTIALLY_SUPPORTED' ? c.support_explanation : undefined,
    confirmed: c.support_confirmed,       // false for heuristic SIKI → caption "otomatik kontrol"
    sideRemark: c.assessment.addresses_question === false, // de-emphasise; not counted as a gap
    quote: x.quote_verified ? x.quote : null,
    highlight: x.highlight,               // chunk/document offsets for marking the passage
  })),
}));
// When outcome === 'INSUFFICIENT_EVIDENCE' and claims is empty, render the existing
// makeGap() style message using a.insufficient_evidence.message.
// Use the ANSWER-level a.support_label for the Düğüm Gücü badge rather than recomputing it
// from claims: the backend excludes side remarks (addresses_question === false) from it.
// Never show "doğrulandı" unless a.support_confirmed is true; heuristic SIKI means
// "quoted from the cited source", not "semantically verified".
```

The source viewer needs the passage text: `a.evidence.find(e => e.evidence_id === x.evidence_id).text`.

---

## WBS-6 — Question generation

Use **`POST /api/v1/rag/retrieve`** with the topic or learning objective as the `question`:

```json
{ "question": "AVL ağaçlarında LR rotasyonu", "scope": { "user_id": "u-ayse", "course_id": "veri-yapilari", "document_ids": ["doc-vy-hafta4", "doc-vy-notlar"] },
  "params": { "max_evidence": 4 } }
```

You get `evidence[]` with text, `chunk_id`, and location. Generate questions **from that
text** and store the `chunk_id`s each question is based on, so the answer key and later
feedback can cite the same passages ("Kaynağa dön"). `outcome: NO_EVIDENCE` means don't
generate a question for that topic.

In-process alternative (if WBS-6 is Python in the same service):

```python
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.schemas import AuthorizedScope
rag = build_components(Settings.from_env()).rag
res = rag.retrieval.retrieve("AVL LR rotasyonu", AuthorizedScope(user_id="u", course_id="veri-yapilari", document_ids=[...]))
built = rag.context_builder.build(res.hits)   # deduplicated, budgeted evidence
```

---

## WBS-7 — Answer evaluation

To score a student's answer against course material:

1. Retrieve reference evidence with `POST /api/v1/rag/retrieve`, using the **question text**
   (plus the stored `chunk_id`s from WBS-6, if any, to confirm they're still in scope).
2. Evaluate the student answer against `evidence[].text` with your own scorer or LLM judge.
3. In feedback, cite `chunk_id` + `label` + `location` exactly like `/answer` does, so the
   frontend's "Kaynağa dön" opens the right passage.

`evidence[].score` is a ranking signal. Don't use it as a correctness score.

---

## WBS-8 — Hallucination and evidence measurement

Each `GroundedAnswer` contains everything needed to measure grounding:

| Signal | Field |
| --- | --- |
| Fabricated references | `citation_issues[].issue == "UNKNOWN_EVIDENCE_ID"` |
| Quotes not in source | `citation_issues[].issue == "QUOTE_NOT_FOUND"`, `citations[].quote_verified` |
| Per-claim support | `claims[].support_status`, `claims[].assessment` (coverage, numbers, method) |
| Abstention | `outcome`, `insufficient_evidence.reason` |
| What the model saw | `evidence[]` (exact context) and `generation.prompt_version` |

- **Metric definitions and runner:** `ai-service/src/knot_rag/evaluation/` and
  [`rag-evaluation.md`](rag-evaluation.md). Extend `tests/fixtures/eval_dataset.json`; keep
  denominators explicit.
- **Semantic judge:** an LLM entailment judge already exists (`SUPPORT_JUDGE=llm`,
  `evidence/judge.py`). Measuring its agreement with human labels is WBS-8's most valuable next
  step. To plug in a different judge (for example a local NLI model), implement the
  `SupportAssessor` protocol `assess_all(claims, question) -> list[SupportDecision]`, keep the
  hard-rule caps (see `LLMJudgeSupportAssessor`), set `verification=SEMANTIC_JUDGE`, and inject
  it in `bootstrap.py`.
- **New measurement fields:** `claims[].assessment.{quote_coverage, question_relevance,
  negation_consistent, addresses_question, verification, judge_verdict}`,
  `claims[].support_confirmed`, and `question_coverage` on the answer. The evaluation runner
  reports `siki_citation_precision`, `siki_on_out_of_scope`, `over_claim_rate`,
  `partial_detection`, `answered_rate_on_answerable` and `confirmed_support`, with definitions
  in `rag-evaluation.md`.
- **Human labels:** the dashboard should let reviewers label `claim_id`s as
  supported/partial/unsupported. Compare those labels with `support_status` to calibrate
  `SUPPORT_COVERAGE_*`.

---

## Compatibility and versioning

- `rag.v1` request fields are stable. New optional response fields may be added; clients must
  ignore unknown fields.
- Breaking changes (renamed fields, changed semantics of `support_status`) → `rag.v2` and
  `/api/v2/...`, served alongside v1 for at least one iteration.
- Index compatibility is guarded at runtime (model and dimension stamp). Changing the
  embedding model requires a full re-index into a new collection, then switching
  `CHROMA_COLLECTION` on both sides.

## Open questions for the team

> Decided or tracked in [`architecture/architecture-decisions.md`](architecture/architecture-decisions.md):
> embedding selection procedure (ADR-010, PROVISIONAL), visibility model (ADR-003), LLM
> provider (U2), deployment (U5).

1. **Embedding model choice (WBS-2 + WBS-3):** run
   `python -m knot_rag.evaluation.compare_embeddings --candidates evaluation/embedding_candidates.json --corpus tests/fixtures/corpus_v2.json --dataset tests/fixtures/eval_dataset_v2.json`
   on a machine with Hugging Face access. It compares MiniLM-L12, mpnet-base, e5-small/base,
   bge-m3 and a Turkish BERT, per question category (paraphrase, mixed language, ASCII typos).
   Pin the winner's `resolved_revision` and set the same model and prefixes on both sides (E5:
   `EMBEDDING_QUERY_PREFIX="query: "`, `EMBEDDING_DOCUMENT_PREFIX="passage: "`).
2. **LLM provider:** local (Ollama, free, needs a GPU or patience) vs a hosted API (cost,
   data-protection review for student documents).
3. **Document visibility model** in Prisma (course-shared vs personal uploads). WBS-3 only
   needs the final list of document ids.
4. **Deployment topology:** same Docker network for NestJS, RAG and Chroma? Defines
   `RAG_URL` and where the token lives.
