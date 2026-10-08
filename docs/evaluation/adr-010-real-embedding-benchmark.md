# ADR-010 Real Embedding Benchmark (`challenge.v1`)

| | |
| --- | --- |
| Date of run | 2026-10-08 |
| Branch / commit of results | `feature/document-ingestion`, `677884c` |
| Decision record | [architecture-decisions.md §3.1](../architecture/architecture-decisions.md#31-result-2026-10-08) |
| Detailed notes | [rag-evaluation.md §4.7](../rag-evaluation.md#47-adr-010-real-model-evaluation-on-challengev1-2026-10-08) |
| Raw outputs | `ai-service/evaluation/reports/adr010-challenge-v1-2026-10-08.json` (harness CLI), `ai-service/evaluation/reports/adr010-breakdown-2026-10-08.json` (per-language/category/item breakdown) |

This report only collects results that were already measured and committed. No new numbers
were produced for it.

## 1. Objective and methodology

**Objective:** choose the provisional MVP embedding model for K-not with the pre-registered
ADR-010 procedure ([architecture-decisions.md §3](../architecture/architecture-decisions.md#3-adr-010--embedding-model-selection-procedure-pre-registered)).
The rules were fixed before any results were seen:
- **Hard requirements:** zero scope leakage; a licence allowing academic use; RAM ≤ 2 GB; CPU
  query latency p95 ≤ 200 ms on 4 cores.
- **Gates:** the model must beat the hashing baseline on the mixed-language and paraphrase
  categories.
- **Primary metric:** in-scope retrieval success (a gold passage in the top 8).
- **Tie rule:** within 0.03 on the primary metric, prefer the smaller and faster model.

**Method:**
- **Scope:** retrieval only. No LLM is involved.
- **Index:** for each candidate, the `corpus.v2` chunks are written to a fresh in-memory Chroma
  collection with the existing `ChromaChunkWriter`. The collection carries the full C-1
  `EmbeddingConfiguration` stamp and is read back with the identical configuration through
  `ChromaChunkIndex`.
- **Retrieval:** each question is retrieved with the production `RetrievalService`
  (`knot_rag.evaluation.runner.evaluate`, `generate=False`).
  - `top_k` = 8; no score floor (`min_score = -1`).
  - Scope = the dataset's `default_scope`.
  - Thresholds and grounding rules are unchanged.
- **Metrics:** definitions from `knot_rag/evaluation/metrics.py`, computed over **in-scope
  questions only** (questions with gold chunk ids). The gold rank is the 1-based position of
  the first gold chunk among the top-8 candidates.
  - Recall@k: share of in-scope questions with a gold chunk at rank ≤ k.
  - R@8 is the harness's "retrieval success".
  - MRR: the mean of 1/rank, with 0 when no gold chunk is retrieved.
- **Labels:** similarity scores are never used as correctness labels; only the dataset's gold
  chunk ids are.

**Candidates run:**
- `hashing-baseline`: lexical control, not a production candidate.
- `minilm-l12-multi`: the current code default.
- `e5-small-multi`.

The other candidates in `embedding_candidates.json` (mpnet-base, e5-base, bge-m3, Turkish
BERT) were **not** run.

## 2. Model under evaluation (pinned)

| Field | Value |
| --- | --- |
| Model | `intfloat/multilingual-e5-small` |
| Revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Backend | `sentence_transformers` |
| Dimension | 384 |
| Query prefix | `"query: "` (trailing space included) |
| Document (passage) prefix | `"passage: "` (trailing space included) |
| Normalization | L2-normalized. Verified: sampled stored vectors have norm 1.0; collection stamp `embedding_normalize = true` |
| Distance | cosine (verified: collection stamp `hnsw:space = cosine`) |
| C-1 fingerprint | `sha256:7858637ffe512d13b894af08f99e75f8f42be36c457e2e02192bacdfd6671616` |

Comparison models:
- **MiniLM:** `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` at revision
  `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`, 384-d, no prefixes; fingerprint
  `sha256:1163fc477a2a5dcf75f34c0ae819b3bcae6c28ac6173318d468424d7eb63991b`.
- **Hashing baseline:** `knot-hashing-v1`, 512-d.

## 3. Dataset

| Field | Value |
| --- | --- |
| Version | `challenge.v1` (locked) |
| Location | `ai-service/evaluation/validation/challenge_v1.json` at commit `7bc6bb0` on `feature/rag-core-pipeline`. It is **not** on `feature/document-ingestion`; it was read with `git show` and neither copied nor modified |
| SHA-256 | `a036f09d5f1a1f782bee5dc8f00d07208de16704c1d29448235380045246dc50` |
| Size | 41 questions: Turkish 20, English 12, mixed 9 |
| In scope / out of scope | 33 with gold chunk ids / 8 without (4 Dijkstra traps, 4 other near-topic) |
| Categories | direct 15, paraphrase 7, partial 4, negation 4, multi-passage 3, out_of_scope_dijkstra 4, out_of_scope 4 |
| Corpus | `corpus.v2` (`ai-service/tests/fixtures/corpus_v2.json`): 42 chunks, 13 documents in 3 courses |
| Gold labels | Written by the WBS-3 developer; **not independently reviewed** |

## 4. Overall results (in-scope n = 33)

| Model | R@1 | R@3 | R@5 | R@8 | MRR |
| --- | --- | --- | --- | --- | --- |
| hashing baseline | 0.4242 | 0.6667 | 0.7273 | 0.7576 | 0.5404 |
| MiniLM-L12-multi | 0.5152 | 0.7576 | 0.8182 | 0.9091 | 0.6486 |
| **multilingual-e5-small** | **0.5758** | **0.8485** | **0.9091** | **0.9394** | **0.7157** |

In absolute counts, e5-small's R@8 of 0.9394 is 31 of 33 in-scope questions. All three models
reach 0.6667 multi-passage recall: 2 of the 3 multi-passage questions get all their gold
passages into the context.

## 5. Language breakdown

The language is the dataset's own `language` field. In-scope n: Turkish 16, English 10,
mixed 7.

| Model | Language | R@1 | R@3 | R@5 | R@8 | MRR |
| --- | --- | --- | --- | --- | --- | --- |
| hashing | TR | 0.5000 | 0.8750 | 0.9375 | 1.0000 | 0.6719 |
| hashing | EN | 0.2000 | 0.4000 | 0.5000 | 0.5000 | 0.3083 |
| hashing | mixed | 0.5714 | 0.5714 | 0.5714 | 0.5714 | 0.5714 |
| MiniLM | TR | 0.3750 | 0.6875 | 0.8125 | 0.8125 | 0.5385 |
| MiniLM | EN | 0.7000 | 1.0000 | 1.0000 | 1.0000 | 0.8333 |
| MiniLM | mixed | 0.5714 | 0.5714 | 0.5714 | 1.0000 | 0.6361 |
| **e5-small** | TR | 0.6250 | 0.9375 | 1.0000 | 1.0000 | 0.7729 |
| **e5-small** | EN | 0.4000 | 0.8000 | 0.8000 | 0.9000 | 0.6000 |
| **e5-small** | mixed | 0.7143 | 0.7143 | 0.8571 | 0.8571 | 0.7500 |

With these sample sizes, one question moves a per-language number by about 6 points (TR),
10 points (EN) or 14 points (mixed).

## 6. Comparison and ADR-010 gates

R@8 by category (in-scope categories only):

| Category (n) | hashing | MiniLM | e5-small |
| --- | --- | --- | --- |
| direct (15) | 0.6667 | 0.9333 | 0.8667 |
| paraphrase (7) | 0.8571 | 0.8571 | 1.0000 |
| partial (4) | 0.75 | 0.75 | 1.0 |
| negation (4) | 0.75 | 1.0 | 1.0 |
| multi_passage (3) | 1.0 | 1.0 | 1.0 |

| Gate / requirement | hashing | MiniLM | e5-small |
| --- | --- | --- | --- |
| Zero scope leakage | 0 / 328 | 0 / 328 | 0 / 328 |
| Beats hashing on mixed (R@8) | — | 1.0000 > 0.5714 ✔ | 0.8571 > 0.5714 ✔ |
| Beats hashing on paraphrase (R@8) | — | 0.8571 = 0.8571 ✘ (tie, does not beat) | 1.0000 > 0.8571 ✔ |
| Licence | — | Apache-2.0 | MIT |
| p95 query latency ≤ 200 ms | ✔ | ✔ (§8) | ✔ (§8) |
| RAM ≤ 2 GB | ✔ | ✔ (§8) | ✔ (§8) |
| Primary metric, R@8 overall | 0.7576 | 0.9091 | 0.9394 |

- **Head to head with MiniLM:** e5-small is better overall on every recall level and on MRR.
  It is clearly better on Turkish (MRR 0.7729 vs 0.5385) and on mixed R@1. It is weaker on
  English (MRR 0.6000 vs 0.8333) and on the `direct` category.
- **Tie rule:** the primary-metric difference is 0.0303 (31/33 vs 30/33), at the 0.03 boundary.
  Applying it does not change the outcome. The models are the same size class (384-d) with
  comparable latency, and MiniLM already fails the paraphrase gate.

## 7. Out-of-scope and cross-course isolation

**Isolation:**
- Scope leakage is **0 of 328** retrieved records for every model.
- The index also holds out-of-scope documents: two other courses (`doc-os-hafta5`,
  `doc-ag-hafta3`), another student's private notes (`doc-vy-notlar-mehmet`) and an injected
  document (`doc-vy-zararli`). None was ever returned.
- Isolation is enforced by the metadata scope filter, independent of the embedding model.

**Out-of-scope questions:** similarity scores do **not** separate them from in-scope questions.

| Model | Top-1 score, in-scope (min / median) | Top-1 score, the 8 out-of-scope questions |
| --- | --- | --- |
| hashing | 0.1015 / 0.2934 | 0.1181 – 0.2961 |
| MiniLM | 0.4202 / 0.6117 | 0.3390 – 0.5531 |
| e5-small | 0.7877 / 0.8560 | 0.7977 – 0.8582 (Dijkstra traps 0.8140 – 0.8418) |

- e5-small compresses scores into a narrow high band. Every out-of-scope top-1 score lies
  inside the in-scope range, so no `RAG_MIN_SCORE` floor can reject them without also cutting
  in-scope questions.
- `RAG_MIN_SCORE` therefore stays unset. Rejecting out-of-scope questions stays the job of the
  WBS-3 grounding rules (question coverage and support assessment). This retrieval-only
  benchmark does **not** measure them.

## 8. Hardware, latency and memory

**Environment** (from the CLI report):
- 4 vCPU, CPU only.
- Python 3.13.16, Linux x86_64.
- sentence-transformers 6.1.0, torch 2.14.1, transformers 5.19.0, chromadb 1.5.9, pydantic
  2.13.5.

Query embedding latency (ms) per question, over the 41 questions. Three runs were recorded;
the numbers depend on the hardware and are not comparable across machines.

| Model | CLI report (p50 / p95) | Breakdown file (p50 / p95) | Separate-process run in rag-evaluation.md §4.7 (p95) |
| --- | --- | --- | --- |
| hashing | 0.2 / 0.3 | 0.2 / 0.32 | 0.4 |
| MiniLM | 12.41 / 18.13 | 14.14 / 22.2 | 19.5 |
| e5-small | 11.49 / 14.38 | 13.73 / 16.73 | 19.8 |

All runs are an order of magnitude below the 200 ms p95 limit. Indexing the 42-chunk corpus
took 0.44 s for e5-small (CLI report).

**Memory** (whole-process maximum RSS, including torch and Chroma):
- **Separate-process measurements** recorded in rag-evaluation.md §4.7 are the basis for the
  ≤ 2 GB check: hashing about 0.1 GB, MiniLM 1.84 GB, e5-small 1.38 GB.
  - These come from the evaluation runs in which each model ran in its own process.
  - That raw output is not committed as a separate file.
- **The committed breakdown file's `max_rss_mb`** values (100 / 1810 / 2065 MB) were measured in
  **one** process that loaded all three models in turn.
  - They accumulate, so they are not per-model figures.
  - The 2065 MB for e5-small includes the earlier MiniLM load.
- **Recommendation:** re-measure e5-small's RSS alone on the deployment host before
  production. 1.38 GB is under the limit, but the margin depends on the host.

## 9. Important retrieval failures (e5-small)

In-scope questions whose gold chunk is not in the top 3:

| Item | Language / category | Gold chunk | Gold rank | Observation |
| --- | --- | --- | --- | --- |
| `e3` | EN / direct | `doc-vy-hafta5:v1:001` | not in top 8 | English question over Turkish material; other weeks' chunks win (top 1 `doc-vy-hafta7:v1:001`) |
| `m4` | mixed / direct | `doc-vy-hafta7:v1:002` | not in top 8 | A sibling chunk of the same lecture (`doc-vy-hafta7:v1:004`) ranks first |
| `e1` | EN / direct | `doc-vy-hafta4:v1:005` | 6 | Exam chunks (`doc-vy-sinav-2023`, `doc-vy-sinav-2024`) occupy the top 3 |
| `p3` | TR / partial | `doc-vy-hafta6:v1:003` | 5 | Exam and neighbouring hafta6 chunks rank higher |
| `p4` | mixed / partial | `doc-vy-notlar:v1:004` | 4 | Exam chunks rank first; the neighbouring notes chunk is 3rd |

Patterns:
- English-only questions over Turkish material are the main weakness (EN R@1 0.40).
- Exam-paper chunks restate many topics and often rank first.

For comparison, MiniLM has 8 such failures (`p1`, `p3`, `p4`, `r2`, `t5`, `t6`, `m2`, `m4`).
They are mostly Turkish and mixed questions. The hashing baseline has 11, mostly English.

## 10. Limitations

1. **Small sample.** 33 in-scope questions (7–16 per language) give wide uncertainty.
2. **Unreviewed gold labels.** Written by the WBS-3 developer; an independent review is
   pending.
3. **Synthetic corpus.** `corpus.v2` is a curated fixture (42 chunks), not real course PDFs
   run through the WBS-2 ingestion pipeline.
4. **Retrieval only.**
   - Citation correctness was not re-measured on this dataset. The separate WBS-2 → WBS-3
     real-model smoke test showed verified quotes whose highlights map exactly to the page
     text.
   - **LLM answer quality is untested**; no LLM provider is configured.
   - Out-of-scope rejection by the grounding rules was not measured here.
5. **Partial candidate coverage.** Only 3 of the 7 listed candidates were run.
6. **Hardware-dependent performance.** Latency and memory were measured on one 4-vCPU cloud
   container. The separate-process RSS figures are recorded in the documentation but not
   committed as a raw output file (§8).

## 11. Recommendation

**Adopt `intfloat/multilingual-e5-small` at revision
`614241f622f53c4eeff9890bdc4f31cfecc418b3` as the provisional K-not MVP embedding model.** It
is recorded as ADR-010 "ACCEPTED (provisional for the MVP)" in
[architecture-decisions.md §3.1](../architecture/architecture-decisions.md#31-result-2026-10-08).

Why:
- It is the only real candidate that meets every hard requirement and both "beats hashing"
  gates.
- It leads on the primary metric overall, on Turkish (the main course language) and on
  paraphrase.
- It has the best R@1, R@3, R@5 and MRR.

Separating what is and is not established:

| Aspect | Status |
| --- | --- |
| Technical pipeline correctness | Shown. PDF → WBS-2 ingestion → e5 embeddings → Chroma → WBS-3 `/retrieve` and `/answer` with exact ids, pages and offsets; one fingerprint on both sides |
| Retrieval relevance | Measured on `challenge.v1` (this report), within the limitations above |
| Citation correctness | Shown in the smoke test only; not benchmarked here |
| LLM answer quality | **Untested** |

Configuration and follow-ups:
- **Where the model is configured:** the deployment environment (`ai-service/.env.example`) and
  the first `IndexVersion`.
  - The Python code default (`config.py`) intentionally stays MiniLM, as documented in ADR-010
    §3.1.
  - A deployment whose settings differ from the active `IndexVersion` is refused by the C-1
    fingerprint check.
- **Before treating the choice as final:**
  - An independent review of the gold labels.
  - A benchmark on real course PDFs.
  - An RSS measurement on the deployment host.
  - Answer-quality evaluation once an LLM is configured.
- **If English-only questions turn out to matter more than this dataset suggests,** run the
  remaining candidates (e5-base, bge-m3).

## 12. Reproducible commands

```bash
cd ai-service
pip install -e ".[embeddings]"   # sentence-transformers; downloads the models from Hugging Face
git show 7bc6bb0:ai-service/evaluation/validation/challenge_v1.json > /tmp/challenge_v1.json
sha256sum /tmp/challenge_v1.json   # expect a036f09d5f1a1f782bee5dc8f00d07208de16704c1d29448235380045246dc50

# Overall metrics (existing harness; candidates pinned in evaluation/embedding_candidates.json)
PYTHONPATH=src python -m knot_rag.evaluation.compare_embeddings \
  --candidates evaluation/embedding_candidates.json --corpus tests/fixtures/corpus_v2.json \
  --dataset /tmp/challenge_v1.json --only hashing-baseline,minilm-l12-multi,e5-small-multi \
  --out evaluation/reports/adr010-challenge-v1-2026-10-08.json

# Recall@5, language/category breakdown, out-of-scope scores, per-item ranks
PYTHONPATH=src python evaluation/scripts/adr010_breakdown.py /tmp/challenge_v1.json \
  hashing-baseline,minilm-l12-multi,e5-small-multi evaluation/reports/adr010-breakdown-2026-10-08.json
```

- **Deterministic:** quality metrics, for the pinned revisions.
- **Will vary:** latency and RSS.
- **Pinned in `evaluation/embedding_candidates.json`:** e5-small `614241f…` and MiniLM
  `e8f8c21…`.
