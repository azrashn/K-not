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

```bash
curl -s localhost:8100/api/v1/rag/answer \
  -H "Authorization: Bearer $RAG_INTERNAL_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"AVL ağacında kaç temel rotasyon vardır?",
       "scope":{"user_id":"u-ayse","course_id":"veri-yapilari","document_ids":["doc-vy-hafta4","doc-vy-notlar"]}}'
```

## Tests

```bash
pytest                       # everything (≈5 s, no network, no model download)
pytest tests/unit            # mocked dependencies only
pytest -m integration        # real in-memory ChromaDB + FastAPI TestClient
pytest -m evaluation         # labelled evaluation set end-to-end
```

Evaluation report (see `docs/rag-evaluation.md`):

```bash
python -m knot_rag.evaluation.runner --corpus tests/fixtures/corpus.json \
  --dataset tests/fixtures/eval_dataset.json --embedding hashing --provider extractive
# Against a real index + real LLM configured in the environment:
python -m knot_rag.evaluation.runner --dataset tests/fixtures/eval_dataset.json --provider env
```

## Layout

```
src/knot_rag/
  schemas/      Versioned Pydantic contracts (documents, retrieval, answer, errors)
  query/        Question validation / normalization (optional rewriter hook)
  retrieval/    Embedder + ChunkIndex ports, ChromaDB adapter, scoped RetrievalService
  context/      Deterministic dedup, ranking, token budget, delimited rendering
  generation/   LLM provider port + adapters, prompts, structured generator
  evidence/     Citation integrity mapper, support assessor (SIKI/GEVEŞEK/KOPUK)
  api/          FastAPI app: auth, request IDs, error envelope
  evaluation/   Metric definitions + runner
  pipeline.py   RagService orchestration      bootstrap.py  composition root
tests/          unit/ integration/ evaluation/ fixtures/
```

## Known limitations (summary)

- Support states come from a **heuristic** (verbatim quote + lexical coverage + number check),
  not semantic entailment. Every claim carries `semantically_verified: false`.
- Measured metrics so far use the offline hashing embedder and extractive baseline; the real
  multilingual model and a real LLM have **not** been evaluated yet (no model download / API
  access in the build environment).
- `RAG_MIN_SCORE` is unset by default and must be calibrated per embedding model.
- Highlight offsets exist only when the quoted text is found verbatim; PDF coordinates are not
  produced (WBS-2 would need to supply them).

Details: `docs/rag-evaluation.md` § Limitations.
