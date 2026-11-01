# K-not RAG Service (WBS-3)

Internal Python service that answers student questions **only from their authorized course
materials** and returns structured, verifiable citations. The NestJS backend (WBS-4) is the only
caller; browsers never talk to this service.

```
Question → scoped retrieval (ChromaDB) → context selection → structured generation
         → schema validation → citation validation → support assessment → GroundedAnswer
```

| Doc | Content |
| --- | --- |
| [`docs/rag-architecture.md`](../docs/rag-architecture.md) | Components, data flow, design decisions, security |
| [`docs/rag-api-contract.md`](../docs/rag-api-contract.md) | Endpoints, schemas, full JSON examples, error codes |
| [`docs/rag-integration.md`](../docs/rag-integration.md) | Handoff for WBS-2, 4, 6, 7, 8 and the frontend |
| [`docs/rag-evaluation.md`](../docs/rag-evaluation.md) | Dataset, metric definitions, measured baseline, limitations |

## Local setup

Requires Python ≥ 3.11.

```bash
cd ai-service
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"                 # API, ChromaDB client, tests
pip install -e ".[embeddings]"          # + sentence-transformers (torch) for the real multilingual model
cp .env.example .env                    # then edit; load with `set -a; source .env; set +a`
```

### ChromaDB

The `chromadb` package ships a server:

```bash
chroma run --path ./.chroma --port 8000      # CHROMA_MODE=http (default)
```

For quick experiments without a server use `CHROMA_MODE=persistent` (local folder) or `memory`.

### Load demo data (until WBS-2 indexing is connected)

```bash
# Offline: lexical test embedder, no model download.
CHROMA_MODE=persistent EMBEDDING_BACKEND=hashing python -m knot_rag.devtools.seed tests/fixtures/corpus.json
```

The corpus mirrors the frontend mock documents (AVL slides, notes, hash tables) plus sorting
material and deliberate hazards (another course, another user's notes, a prompt-injection file).

### Run

```bash
uvicorn knot_rag.main:app --host 0.0.0.0 --port 8100
# OpenAPI: http://localhost:8100/docs
```

Without any LLM, `LLM_PROVIDER=extractive` runs the whole pipeline with a deterministic
sentence-extraction baseline (useful for demos and frontend integration; it is **not** an LLM).
A free local model works through `LLM_PROVIDER=openai_compatible` + Ollama
(`LLM_BASE_URL=http://localhost:11434/v1`).

**External providers are off by default ($0).** A non-loopback `LLM_BASE_URL` is refused at
start-up unless `LLM_ALLOW_EXTERNAL=true`, `LLM_BUDGET_USD > 0` and both
`LLM_PRICE_*_PER_MTOK` are set; approved providers run behind a hard budget cap. No external
provider is approved yet (docs/architecture/architecture-decisions.md §10).

```bash
curl -s localhost:8100/api/v1/rag/answer \
  -H "Authorization: Bearer $RAG_INTERNAL_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"AVL ağacında kaç temel rotasyon vardır?",
       "scope":{"user_id":"u-ayse","course_id":"veri-yapilari","document_ids":["doc-vy-hafta4","doc-vy-notlar"]}}'
```

## Tests

```bash
pytest                       # everything (no network, no model download)
pytest tests/unit            # mocked dependencies only
pytest -m integration        # real in-memory ChromaDB + FastAPI TestClient
pytest -m evaluation         # labelled evaluation set end-to-end
```

Evaluation report (see `docs/rag-evaluation.md`):

```bash
python -m knot_rag.evaluation.runner --corpus tests/fixtures/corpus.json \
  --dataset tests/fixtures/eval_dataset.json --embedding hashing --provider extractive
# Embedding model comparison (needs Hugging Face access):
python -m knot_rag.evaluation.compare_embeddings --candidates evaluation/embedding_candidates.json \
  --corpus tests/fixtures/corpus_v2.json --dataset tests/fixtures/eval_dataset_v2.json
# Against a real index + real LLM configured in the environment (refused unless approved, see above):
python -m knot_rag.evaluation.runner --dataset tests/fixtures/eval_dataset.json --provider env
# Offline grounding harness: constructed errors through the real validation layer ($0, no LLM):
python -m knot_rag.evaluation.grounding --corpus tests/fixtures/corpus_v2.json \
  --dataset tests/fixtures/eval_dataset_v2.json --out report.json
# Blind human labelling of real answers, then claim-level metrics:
python -m knot_rag.evaluation.claim_labels export --corpus tests/fixtures/corpus_v2.json \
  --dataset tests/fixtures/eval_dataset_v2.json --sheet sheet.jsonl --key key.jsonl
python -m knot_rag.evaluation.claim_labels score --sheet sheet.labelled.jsonl --key key.jsonl
```

## Layout

```
src/knot_rag/
  schemas/      Versioned Pydantic contracts (documents, retrieval, answer, errors)
  query/        Question validation / normalization (optional rewriter hook)
  retrieval/    Embedder + ChunkIndex ports, ChromaDB adapter, scoped RetrievalService
  context/      Deterministic dedup, ranking, token budget, delimited rendering
  generation/   LLM provider port + adapters, prompts, structured generator
  evidence/     Citation integrity mapper, support assessor (SIKI/GEVEŞEK/KOPUK), conflicts
  api/          FastAPI app: auth, request IDs, error envelope
  evaluation/   Metrics, runner, offline grounding harness, claim-labelling tool
  pipeline.py   RagService orchestration      bootstrap.py  composition root
src/knot_ingest/  WBS-2 ingestion, same deployable (mounted only with INGEST_ENABLED=true)
  extraction.py PDF validation + page text (pypdf, pinned)   normalize.py  c1 text rules
  chunking.py   offset-preserving chunks + pages.v1 artifact  pipeline.py   one job (§4 algorithm)
  worker.py     bounded in-process queue                      callbacks.py  sequenced NestJS events
  service.py    accept / delete / reconcile / verify          api.py        /api/v1/ingestion/*
tests/          unit/ integration/ evaluation/ fixtures/ ingest/
```

## Ingestion (WBS-2)

Contracts: `docs/architecture/wbs2-handoff.md`, `document-contract.md` (`ingest.v1`,
`pages.v1`), `document-lifecycle.md`. NestJS posts a job to `POST /api/v1/ingestion/jobs`;
the worker extracts page text, chunks it (`chunk.text == document_text[char_start:char_end]`),
embeds with the job's exact `EmbeddingConfiguration`, deletes the document's old chunks,
writes the new ones tagged `x_job_id`, verifies them by read-back, writes
`documents/{id}/pages.{indexing_version}.json`, and reports `SUCCEEDED` to NestJS. No OCR:
scanned PDFs fail with `NO_TEXT_LAYER`. The worker is in-memory (MVP): jobs lost on restart
are recovered by the NestJS sweeper and are idempotent.

```bash
pytest tests/ingest        # HashingEmbedder (mock embeddings), in-memory Chroma, callback stub
python tests/ingest/fixtures/make_pdfs.py   # regenerate fixture PDFs (needs reportlab)
```

## Known limitations (summary)

- Support states come from explicit **lexical rules** (`citation-lexical-v2`: verbatim quote,
  quoted-sentence coverage, numbers, negation, question relevance). A heuristic SIKI has
  `support_confirmed: false`. An optional LLM entailment judge (`SUPPORT_JUDGE=llm`) is
  implemented but not yet evaluated against human labels.
- Measured metrics so far use the offline hashing embedder and extractive baseline; the real
  multilingual models and a real LLM have **not** been evaluated (huggingface.co is blocked in
  the build environment; `compare_embeddings` reports them as BLOCKED).
- `RAG_MIN_SCORE` is unset by default and must be calibrated per embedding model.
- Highlight offsets exist only when the quoted text is found verbatim; PDF coordinates are not
  produced (WBS-2 would need to supply them).

Details: `docs/rag-evaluation.md` § Limitations.
