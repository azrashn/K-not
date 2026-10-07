# RAG Evaluation — Dataset, Metrics, Results

> **Status:** the evaluation *harness* is complete and runs in CI-like conditions. The
> **production configuration (multilingual embedding model + a real LLM) has not been
> measured yet.** The numbers below come from the offline baseline (lexical hashing embedder
> and an extractive non-LLM generator), because the build environment had no access to model
> downloads or LLM APIs. They validate the pipeline and the metric code; they are **not**
> evidence that the project targets are met.

## 1. Dataset

- Corpus: `ai-service/tests/fixtures/corpus.json` has 25 chunks and 8 documents. Course
  `veri-yapilari` mirrors the frontend mock material (AVL slides, notes, hash tables) plus a
  sorting chapter and a past exam. Hazards: a duplicate chunk, multi-page chunks, a chunk
  without page metadata, **another user's private notes**, a **prompt-injection document**,
  and **another course** (operating systems).
- Questions: `ai-service/tests/fixtures/eval_dataset.json` (`eval.v1`), 28 items:

| Category | n | Purpose |
| --- | --- | --- |
| `direct` | 13 | Answer stated in one passage (AVL, BST, hash, sorting, complexity, exam) |
| `mixed_language` | 3 | Turkish and English mix ("AVL tree'de rotation …") |
| `multi_passage` | 3 | Needs ≥2 passages (`require_all`) |
| `partial` | 2 | Only part of the question is answerable from the materials |
| `out_of_scope` | 4 | Not in the materials, including one that exists only in another course |
| `adversarial` | 3 | Injection phrasing, misleading premise (1972 vs 1962), request for another user's notes |

- Gold labels: `expected_chunk_ids` (any one suffices unless `require_all`) and
  `acceptable_chunk_ids` (also relevant for citation correctness). **Caveat:** the labels
  were written by the WBS-3 developer. Before reporting final numbers, a second team member
  should review them, and the set should grow (target ≥ 60 questions across ≥ 3 courses with
  real uploaded PDFs).

## 2. Metric definitions

All metrics report `numerator / denominator`. An empty denominator yields `null`
("unmeasured"), never 0.

| Metric | Numerator / denominator | Target |
| --- | --- | --- |
| **Retrieval success** | In-scope questions with ≥1 gold passage in the top-k candidates / in-scope questions | ≥ 0.75 |
| Retrieval success (in context) | Same, but within the evidence actually sent to the model | – |
| Multi-passage recall | `require_all` questions with **all** gold passages in context / `require_all` questions | – |
| Scope leakage | Retrieved records outside the authorized scope / all retrieved records | **must be 0** |
| **Source-supported answer rate** | In-scope answers with `support_status = SUPPORTED` / in-scope answers that were not abstentions | ≥ 0.80 |
| **Unsupported-claim rate** | Claims with `UNSUPPORTED` / all generated claims | ≤ 0.20 |
| Citation integrity | Citations resolving to retrieved evidence / all citations the model proposed (including fabricated ids) | – |
| Citation correctness | Valid citations whose chunk is gold-relevant / valid citations (in-scope questions) | – |
| Out-of-scope abstention | Out-of-scope questions ending `INSUFFICIENT_EVIDENCE` / out-of-scope questions | – |

**Integrity is not correctness.** A citation can resolve to a real chunk (integrity) and still
be the wrong passage (correctness), or the right passage might not actually entail the claim
(semantic support). The harness reports these separately.

**Who judges "supported"?** Currently the heuristic assessor `citation-lexical-v1`
(architecture §6), not a human and not an entailment model. Supported-answer and
unsupported-claim rates are therefore *automatic estimates*. Before final reporting, sample
answers should be human-labelled and the agreement with the heuristic reported.

## 3. Running

```bash
cd ai-service
# Offline baseline (what is reported below)
python -m knot_rag.evaluation.runner --corpus tests/fixtures/corpus.json \
  --dataset tests/fixtures/eval_dataset.json --embedding hashing --provider extractive --out eval-report.json
# Retrieval only, real model, fixture corpus (needs `pip install -e .[embeddings]` + model download)
EMBEDDING_BACKEND=sentence_transformers python -m knot_rag.evaluation.runner \
  --corpus tests/fixtures/corpus.json --dataset tests/fixtures/eval_dataset.json --provider none
# Full production configuration (index from WBS-2 + LLM from env)
python -m knot_rag.evaluation.runner --dataset tests/fixtures/eval_dataset.json --provider env
```

The report includes per-item results and a **threshold sweep** for calibrating `RAG_MIN_SCORE`.

## 4. Measured results: offline baseline (2026-10-07)

Configuration: embedder `knot-hashing-v1-d512` (lexical, **not** the production model),
generator `extractive-baseline-v1` (**not an LLM**), `top_k=8`, `max_evidence=6`, no score
floor, in-memory ChromaDB 1.5.9.

| Metric | Value | n |
| --- | --- | --- |
| Retrieval success | **0.957** | 22 / 23 |
| Retrieval success (in context) | 0.913 | 21 / 23 |
| Multi-passage recall | 1.000 | 3 / 3 |
| Scope leakage | **0.000** | 0 / 224 |
| Citation integrity | 1.000 | 64 / 64 |
| Citation correctness | 0.533 | 32 / 60 |
| Out-of-scope abstention | 0.600 | 3 / 5 |
| Source-supported answer rate | 1.000 † | 22 / 22 |
| Unsupported-claim rate | 0.000 † | 0 / 64 |

† **Not meaningful as quality measures.** The extractive baseline copies source sentences
verbatim, so the heuristic rates them supported by construction. These numbers only show
that the pipeline wiring works. Real values require a real LLM.

How to read the remaining numbers:

- **Retrieval success 0.957 is optimistic.** The corpus is tiny (21 in-scope chunks), so
  top-8 covers about 40% of it, and the gold labels are unreviewed. Treat it as a regression
  floor, not a capability claim.
- **Scope leakage 0 is the meaningful safety result:** across all 28 questions, including
  ones aimed at the other course, the other user's notes and the injection file, no
  out-of-scope record was returned or cited.
- **Citation correctness 0.53** shows the extractive baseline often quotes a related but
  non-gold passage. This is the metric a real LLM should improve.
- **Failure modes the baseline exposes (and an LLM must handle):**
  - *Support ≠ relevance.* `o02` (Dijkstra) produced a true but irrelevant
    complexity sentence, rated SUPPORTED. The support assessor checks claim↔evidence, not
    claim↔question.
  - *Partial questions look complete.* `x01` and `x02` were rated SUPPORTED because every
    stated claim is backed. Detecting the unanswered part depends on the model filling
    `missing`, which the baseline never does.
  - *Conservative heuristic.* In the API example, a claim paraphrasing "daha sıkı
    dengeli; arama daha hızlı" as "AVL … bu yüzden … genellikle daha hızlıdır" was rated
    GEVEŞEK (coverage 0.5) although a human would call it supported. Expect the heuristic to
    under-report SIKI on paraphrased answers; calibrate with human labels.

### Threshold sweep (`RAG_MIN_SCORE`, hashing embedder)

| min_score | Retrieval success (in-scope) | Out-of-scope rejected at retrieval |
| --- | --- | --- |
| 0.00 | 0.957 | 0.00 |
| 0.10 | 0.913 | 0.20 |
| 0.15 | 0.870 | 0.20 |
| 0.20 | 0.826 | 0.60 |
| 0.25 | 0.609 | 0.80 |
| 0.30 | 0.435 | 1.00 |
| 0.40 | 0.304 | 1.00 |

At `min_score=0.2`, out-of-scope abstention rises to 4/5, but **all three mixed-language
questions are rejected too**: a lexical embedder can't match "rotation" to "rotasyon". This
is why the default is *no floor*. Score scales differ per embedding model, so the threshold
must be re-derived from this sweep once the multilingual model is in place.

## 5. Not yet measured

| Item | What is needed |
| --- | --- |
| Retrieval with the multilingual model (MiniLM-L12 / e5) | Model download; run `--provider none` with `EMBEDDING_BACKEND=sentence_transformers` |
| Answer quality with a real LLM | Configure `LLM_*`, run `--provider env` |
| Human agreement with the support heuristic | Label ≥ 100 claims; report Cohen's κ or percent agreement |
| Real PDF ingestion effects (WBS-2 chunking) | Index real course PDFs, extend the dataset |
| Latency and throughput under load | Run against deployed NestJS → RAG → LLM |

## 6. Limitations

1. The support assessor is lexical (quote match, token coverage, number check). It can't
   detect negation or contradiction when wording overlaps, and it under-rates paraphrases.
   `semantically_verified` is always `false`.
2. Answer *relevance* to the question and *completeness* aren't assessed by WBS-3; they rely
   on the model's `missing` list. This is a WBS-8 extension point.
3. Token budgeting uses a character heuristic (`RAG_CHARS_PER_TOKEN=3.0`), not the provider's
   tokenizer.
4. Highlights are character offsets of verbatim quotes, not PDF coordinates.
5. The body-size limit relies on `Content-Length`; chunked uploads should be bounded at the
   reverse proxy.
6. No reranking, hybrid search or query rewriting yet. Add them only if this evaluation shows
   a measurable gain.
