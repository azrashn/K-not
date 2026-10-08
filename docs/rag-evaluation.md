# RAG Evaluation — Dataset, Metrics, Results

> **Status (2026-10-07).** The harness, datasets and support rules are complete and tested.
> **The production configuration (multilingual embedding model + real LLM) has still not been
> measured**: the build environment's network policy denies huggingface.co (model downloads
> fail with `ProxyError: 403 Forbidden`) and no LLM API is configured. Every number below comes
> from the **offline baseline**: a lexical hashing embedder and an extractive non-LLM generator.
> They measure the pipeline's rules, not answer quality. **No project target is claimed as
> met.**

## 1. Datasets

| File | Content |
| --- | --- |
| `tests/fixtures/corpus.json` | corpus.v1: 25 chunks, 8 documents. Unchanged, so earlier results stay reproducible. |
| `tests/fixtures/eval_dataset.json` | eval.v1: 28 questions. Unchanged. |
| `tests/fixtures/corpus_v2.json` | corpus.v2 = corpus.v1 + 17 chunks: BST deletion/traversal, binary heaps, elementary sorts, a quicksort **negation** ("kararlı … değildir"), the comparison-sort lower bound, asymptotic notation, a 2023 exam, and a Dijkstra passage **in another course** (leakage trap). |
| `tests/fixtures/eval_dataset_v2.json` | eval.v2: 66 questions = the 28 v1 items (`split: calibration`) + **38 new held-out items** |

New held-out questions by category: 15 direct, 2 negation-sensitive, 3 paraphrase (little
lexical overlap), 2 typed without Turkish characters, 2 exam style, 3 multi-passage, 4 partially
answerable, 5 out-of-scope (near-topic: B-trees, Fibonacci heap, Dijkstra, trie, exam date), and
2 adversarial (misleading premise, injected instruction).

Every item carries `expected_chunk_ids` (gold passages), optional `acceptable_chunk_ids`, and
`expected_outcome` (the acceptable answer outcomes). For eval.v1, outcomes are derived from the
category. **Labels were written by the WBS-3 developer and need independent review.**

**Calibration vs held-out.** The thresholds of `citation-lexical-v2` were chosen on the
calibration split (eval.v1). The held-out split was written afterwards and reports
generalisation. It was consulted for two design decisions, which are disclosed here:
(1) ASCII folding of stems was added after seeing `s01`, so the `ascii_typo` category is not
independent; (2) a stricter "absent term" rule was **rejected** because of held-out results
(§4.3).

## 2. Metric definitions

All metrics report `numerator / denominator`; an empty denominator is `null` ("unmeasured").

| Metric | Numerator / denominator |
| --- | --- |
| Retrieval success | In-scope questions with ≥1 gold passage in the top-k candidates / in-scope questions |
| Recall@1, Recall@3, MRR | Gold passage at rank ≤ k; mean reciprocal rank of the first gold passage |
| Multi-passage recall | `require_all` questions with all gold passages in context / such questions |
| Scope leakage | Retrieved records outside the authorized scope / all retrieved records (**must be 0**) |
| Citation integrity | Citations resolving to retrieved evidence / all proposed citations |
| Citation correctness | Valid citations pointing to a gold-relevant passage / valid citations |
| **SIKI citation precision** | Citations of SIKI claims pointing to a gold-relevant passage / citations of SIKI claims |
| **SIKI on out-of-scope** | SIKI claims on questions with no gold passage / all claims on those questions |
| **Confirmed support** | SIKI claims confirmed by a semantic judge / SIKI claims |
| Source-supported answer rate | In-scope answers rated SUPPORTED / in-scope non-abstentions *(target ≥ 0.80)* |
| Unsupported-claim rate | KOPUK claims / all claims *(target ≤ 0.20)* |
| **Outcome accuracy** | Answers whose outcome is among `expected_outcome` / labelled answers |
| **Over-claim rate** | Questions that should **not** be fully answered but got `ANSWERED` / such questions |
| **Answered rate on answerable** | Fully answerable questions with `ANSWERED` / fully answerable questions |
| **Partial detection** | Partially answerable questions with `PARTIALLY_ANSWERED` / such questions |
| Out-of-scope abstention | Out-of-scope questions with `INSUFFICIENT_EVIDENCE` / such questions |

Citation correctness measures the **generator** (which passage it cites). SIKI citation
precision measures the **support rules** (whether a wrong citation is still labelled SIKI).

## 3. Running

```bash
cd ai-service
# Answer pipeline, offline baseline
python -m knot_rag.evaluation.runner --corpus tests/fixtures/corpus_v2.json \
  --dataset tests/fixtures/eval_dataset_v2.json --embedding hashing --provider extractive --out eval-report.json
# Embedding comparison (retrieval only; needs `pip install -e .[embeddings]` + Hugging Face access)
python -m knot_rag.evaluation.compare_embeddings --candidates evaluation/embedding_candidates.json \
  --corpus tests/fixtures/corpus_v2.json --dataset tests/fixtures/eval_dataset_v2.json --out evaluation/reports/embeddings-<date>.json
# Production configuration (index from WBS-2, LLM from env; optional SUPPORT_JUDGE=llm)
python -m knot_rag.evaluation.runner --dataset tests/fixtures/eval_dataset_v2.json --provider env
```

Reports from this round: `ai-service/evaluation/reports/` (`eval-v{1,2}-prev-d84eb03.json`,
`eval-v{1,2}-new.json`, `embeddings-2026-10-07.json`, `comparison-table.md`). "prev" means the
previous code (commit `d84eb03`, `citation-lexical-v1`) run through the *current* metric
definitions, so both columns are directly comparable.

## 4. Results: offline baseline (hashing embedder + extractive generator)

### 4.1 Why citation correctness was 32/60

Every one of the 28 off-gold citations in eval.v1 came from a claim that v1 rated **SIKI**.
Causes:

1. **Generator.** The extractive baseline emits up to 3 sentences per answer. Sentences 2–3
   usually share only 1–2 generic tokens with the question ("hash", "denge", "rotasyon",
   "log"), so they come from related but non-gold passages. For example, for "Hash tablosunda
   çakışma ne zaman oluşur?" it added the hash *function* definition. The generator is
   unchanged in this round, so **citation correctness is unchanged (0.533)**. A real LLM is
   expected to differ, but that is unmeasured.
2. **Support rules (fixed).** v1 rated a claim SIKI whenever its quote was verbatim and its
   words occurred anywhere in the chunk. It never asked whether the claim addresses the
   question, never restricted coverage to the quoted sentence, and ignored negation. Rules
   S3, S5 and S7 (architecture §6) address this.
3. **Gold strictness.** A few off-gold citations are arguably relevant (for `d01`, the
   "fark ≥ 2 → rotasyon" chunk). Gold labels were **not** relaxed after the fact; numbers use
   the original strict labels.

### 4.2 Previous vs current rules (same retrieval, same generator)

| Metric | v1 prev | v1 now | v2 held-out prev | v2 held-out now | v2 all prev | v2 all now |
| --- | --- | --- | --- | --- | --- | --- |
| Retrieval success | 22/23 | 22/23 | 32/33 | 32/33 | 53/56 | 53/56 |
| Scope leakage | 0/224 | 0/224 | 0/304 | 0/304 | 0/528 | 0/528 |
| Citation integrity | 64/64 | 64/64 | 105/105 | 105/105 | 175/175 | 175/175 |
| Citation correctness (generator) | 32/60 | 32/60 | 41/97 | 41/97 | 70/160 | 70/160 |
| **SIKI citation precision** | 0.533 (32/60) | **0.765 (26/34)** | 0.423 (41/97) | **0.635 (33/52)** | 0.438 (70/160) | **0.637 (58/91)** |
| **SIKI on out-of-scope** ↓ | 4/4 | 3/4 | 8/8 | **1/8** | 15/15 | **4/15** |
| Confirmed support | 0/64 | 0/37 | 0/105 | 0/53 | 0/175 | 0/95 |
| **Over-claim rate** ↓ | 4/7 | **1/7** | 8/9 | **4/9** | 13/16 | **5/16** |
| **Partial detection** | 0/2 | 1/2 | 0/4 | 1/4 | 0/6 | 2/6 |
| Answered rate on answerable | 20/21 | 17/21 | 28/28 | 25/28 | 47/48 | 41/48 |
| Outcome accuracy | 23/28 | 21/28 | 30/38 | 28/38 | 52/66 | 49/66 |
| Source-supported answer rate † | 22/22 | 18/22 | 33/33 | 28/33 | 55/55 | 46/55 |
| Unsupported-claim rate † | 0/64 | 0/64 | 0/105 | 0/105 | 0/175 | 0/175 |
| Out-of-scope abstention | 3/5 | 3/5 | 1/5 | 1/5 | 3/10 | 3/10 |

† Still not meaningful as quality measures: the extractive baseline quotes sentences
verbatim, so its claims can't be unsupported by construction.

How to read this:

- **The intended effect holds on held-out data.** Wrong or irrelevant evidence labelled SIKI
  dropped substantially: SIKI citation precision went from 0.42 to 0.64, SIKI on
  out-of-scope questions from 8/8 to 1/8, and over-claiming from 8/9 to 4/9. Held-out gains are
  smaller than on the calibration set, as expected.
- **The cost:** 6 of 48 fully answerable questions are no longer reported `ANSWERED` (they are
  now `PARTIALLY_ANSWERED`), and outcome accuracy fell slightly (52 → 49 of 66), because v1
  labelled almost everything ANSWERED, which happened to match most labels. This is a
  deliberate trade: under-claiming (GEVEŞEK) is preferred to over-claiming (SIKI).
- **Confirmed support is 0** everywhere: no semantic judge ran, so no SIKI is "confirmed".
  That is the correct report, not a bug.
- Out-of-scope abstention is unchanged by design: lexical signals never abstain on their own
  (§6.3 of the architecture). Abstention depends on the score floor (§4.5) and the generator.

### 4.3 Design decisions and the evidence behind them

**Claim relevance rule (S7)**, chosen on eval.v1 (32 gold and 28 off-gold claims):

| Rule | Gold claims kept SIKI | Off-gold claims demoted |
| --- | --- | --- |
| relevance ≥ 0.25 | 30/32 | 6/28 |
| relevance ≥ 0.34 | 26/32 | 18/28 |
| relevance ≥ 0.25 and ≥ 0.6 × best | 28/32 | 18/28 |
| **relevance ≥ 0.34 and ≥ 0.6 × best (chosen)** | **26/32** | **21/28** |
| relevance ≥ 0.5 and ≥ 0.6 × best | 20/32 | 24/28 |

Lexical relevance separates the two groups only partially (medians ≈ 0.5 vs ≈ 0.3). That's
acceptable only because a miss demotes to GEVEŞEK, never to KOPUK.

**Side remarks.** The first version let S7-demoted extra sentences make the whole answer
`PARTIALLY_ANSWERED`: fully answerable questions reported ANSWERED fell to 10/48. In 30 of 38
downgrades, S7 on a side sentence was the only rule that fired. Excluding claims capped
*only* by S7 from the answer-level state restored this to 39/48 (41/48 after the stem fix
below) without bringing back over-claiming. Side remarks keep their GEVEŞEK label and
`addresses_question=false`.

**Rejected: "any question term absent from the retrieved context blocks ANSWERED."** It looked
free on eval.v1, but on held-out questions it fired on ordinary words ("sırayla", "arasında",
"hakkında", "üzerinde", "verilir") and cut answered-on-answerable to 34/48. It remains
available as the informational field `question_coverage.absent_from_context`.

**Stem matching.** Prefix-compatible stems (`ağaç` ~ `ağacı`) fixed a false "irrelevant" on
comparison questions. Trade-off: on the 4 out-of-scope claims of eval.v1, SIKI rose from 1/4
to 3/4 under the more lenient matching (held-out unchanged at 1/8).

### 4.4 Remaining failures (eval.v2, current rules)

| Pattern | Items | Why lexical rules can't fix it |
| --- | --- | --- |
| Mixed Turkish/English questions not fully answered | m01–m03 | "rotation" ≠ "rotasyon" lexically; needs multilingual embeddings and an LLM |
| Partial questions reported ANSWERED | x02, x03, x04, x06 | "yığın sıralaması" (heap sort) vs "yığın" (heap): every word is covered, the meaning isn't |
| Out-of-scope answered or partial instead of abstaining | o02, o04–o08 (o07 ANSWERED) | The baseline generator always quotes something; "Dijkstra" is 1 of 5 key terms, so coverage 0.8 passes |
| Answerable reported partial | a01, a05, n11, r02 | Injected instructions or paraphrases dilute key-term overlap |

These are the cases that need the semantic judge and the real-model evaluation.

### 4.5 Score-floor sweep (eval.v2, hashing embedder)

| min_score | 0.0 | 0.1 | 0.15 | 0.2 | 0.25 | 0.3 |
| --- | --- | --- | --- | --- | --- | --- |
| Retrieval success | 0.946 | 0.946 | 0.929 | 0.875 | 0.714 | 0.625 |
| Out-of-scope rejected | 0.0 | 0.1 | 0.2 | 0.7 | 0.8 | 1.0 |

Valid for the hashing embedder only. Re-derive per model with `compare_embeddings`.

### 4.6 Embedding model comparison: BLOCKED

`evaluation/embedding_candidates.json` lists MiniLM-L12 (current default), mpnet-base,
multilingual-e5-small/base (with `query:`/`passage:` prefixes), bge-m3, and a Turkish BERT
control. In this environment `sentence-transformers` 6.1.0 installed from PyPI, but **every
model download failed with `ProxyError: 403 Forbidden`** (huggingface.co denied).
`evaluation/reports/embeddings-2026-10-07.json` records all six as BLOCKED with that reason and
reports numbers only for the hashing control (retrieval success 0.946, R@1 0.679, MRR 0.758).
The harness is tested for determinism and for reporting BLOCKED instead of numbers.

To run it, use a machine with Hugging Face access (see §3). The report records the resolved
model commit (`resolved_revision`); pin it in the candidates file. **Superseded by §4.7.**

### 4.7 ADR-010 real-model evaluation on `challenge.v1` (2026-10-08)

The first run with real models, following the pre-registered ADR-010 procedure. Retrieval only:
no LLM is involved, so nothing here measures answer quality.

**Setup**

| Item | Value |
| --- | --- |
| Dataset | `challenge.v1`: 41 locked questions (TR 20, EN 12, mixed 9; 33 in scope, 8 out of scope), commit `7bc6bb0` on `feature/rag-core-pipeline`, SHA-256 `a036f09d5f1a1f782bee5dc8f00d07208de16704c1d29448235380045246dc50`. Read with `git show`; **not copied or modified** on this branch |
| Corpus | `corpus.v2` (`tests/fixtures/corpus_v2.json`, 42 chunks, 13 documents in 3 courses) |
| Scope | The dataset's `default_scope` (9 `veri-yapilari` documents); other-course, private and injected documents are in the index but out of scope |
| Retrieval | Production `RetrievalService`, `top_k` = 8, no score floor (`min_score=-1`); thresholds and grounding rules unchanged |
| Index | Each model gets its own in-memory collection with the full C-1 stamp; written and read with the identical `EmbeddingConfiguration` |
| Machine | 4 vCPU, CPU only; sentence-transformers 6.1.0, torch 2.14.1, transformers 5.19.0, chromadb 1.5.9 |
| Gold labels | Written by the WBS-3 developer; **no independent review yet** |

**Results** (in-scope questions, `metrics.py` definitions; R@8 is the harness's "retrieval success")

| Model (pinned revision) | n | R@1 | R@3 | R@5 | R@8 | MRR | Leakage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hashing baseline (lexical control) | 33 | 0.424 | 0.667 | 0.727 | 0.758 | 0.540 | 0 / 328 |
| MiniLM-L12-multi `e8f8c21…` (current default) | 33 | 0.515 | 0.758 | 0.818 | 0.909 | 0.649 | 0 / 328 |
| **multilingual-e5-small `614241f…`** | 33 | **0.576** | **0.848** | **0.909** | **0.939** | **0.716** | 0 / 328 |

By language (in-scope n: TR 16, EN 10, mixed 7):

| Model | TR R@1 / R@8 / MRR | EN R@1 / R@8 / MRR | Mixed R@1 / R@8 / MRR |
| --- | --- | --- | --- |
| hashing | 0.50 / 1.00 / 0.67 | 0.20 / 0.50 / 0.31 | 0.57 / 0.57 / 0.57 |
| MiniLM | 0.38 / 0.81 / 0.54 | 0.70 / 1.00 / 0.83 | 0.57 / 1.00 / 0.64 |
| e5-small | 0.63 / 1.00 / 0.77 | 0.40 / 0.90 / 0.60 | 0.71 / 0.86 / 0.75 |

ADR-010 gates:

| Gate | Hashing | MiniLM | e5-small |
| --- | --- | --- | --- |
| Zero scope leakage | 0 | 0 | 0 |
| Beats hashing on mixed (R@8) | — | 1.00 > 0.57 | 0.86 > 0.57 |
| Beats hashing on paraphrase (R@8, n = 7) | — | **0.86 = 0.86 (fails)** | 1.00 > 0.86 |
| Licence | — | Apache-2.0 | MIT |
| Query latency p95 ≤ 200 ms (4 vCPU) | 0.4 ms | 19.5 ms | 19.8 ms |
| RAM ≤ 2 GB (whole process max RSS, model + torch + Chroma) | 98 MB | 1.84 GB | 1.38 GB |
| Primary metric (R@8, overall) | 0.758 | 0.909 | 0.939 (+0.030, at the tie-rule boundary) |

**Out-of-scope and cross-course behaviour**
- Scope leakage is 0 for every model. Chunks of other courses, of another student's private
  notes and of the injected document were never returned. Isolation is enforced by the
  metadata filter, independent of the model.
- **Similarity does not separate out-of-scope questions.** For e5-small, the top-1 scores of
  the 8 out-of-scope questions (0.80–0.86, including all four Dijkstra traps) overlap the
  in-scope ones (min 0.79, median 0.86). E5 scores are compressed into a narrow high band, so a
  `RAG_MIN_SCORE` floor cannot reject them; it would also cut in-scope answers. MiniLM
  overlaps too (out-of-scope 0.34–0.55, in-scope min 0.42). Rejecting out-of-scope questions
  stays the job of WBS-3's grounding rules (question coverage, support assessment), which this
  retrieval-only run does not measure. `RAG_MIN_SCORE` stays unset.

**e5-small failures** (gold passage not in the top 3)

| Item | Language / category | Gold rank | Observation |
| --- | --- | --- | --- |
| `e3` | EN / direct | not in top 8 | English question; the gold Turkish chunk (`hafta5:001`) is beaten by other weeks' chunks |
| `m4` | mixed / direct | not in top 8 | Gold `hafta7:002` loses to sibling chunks of the same lecture (`hafta7:004`) |
| `e1` | EN / direct | 6 | Exam chunks (`sinav-2023/2024`) outrank the lecture slide |
| `p3`, `p4` | TR, mixed / partial | 5, 4 | Partially answerable questions; neighbouring chunks rank higher |

Weaknesses: English-only questions over Turkish material (EN R@1 0.40; MiniLM is better there
with 0.70), and exam-paper chunks that restate many topics and so often rank first.

**Distinguishing what is and is not shown**
1. *Technical pipeline correctness:* shown. PDF ingestion → e5 embeddings → Chroma → `/retrieve`
   and `/answer` works with exact chunk ids, pages and offsets (2026-10-08 smoke test). Here,
   writer and reader share one fingerprint (`sha256:7858637f…` for the pinned e5 configuration).
2. *Retrieval relevance:* measured above on 33 in-scope questions. Small n: one question moves
   a per-language number by 6–14 points.
3. *Citation correctness:* not re-measured on this dataset. The smoke test showed verified
   quotes whose highlights map exactly to the page text; citation integrity is enforced by WBS-3
   independently of the embedding model.
4. *LLM answer quality:* **untested**. No LLM provider is configured.

**Reproduce**

```bash
cd ai-service
pip install -e ".[embeddings]"   # sentence-transformers; downloads the models from Hugging Face
git show 7bc6bb0:ai-service/evaluation/validation/challenge_v1.json > /tmp/challenge_v1.json
sha256sum /tmp/challenge_v1.json   # a036f09d…46dc50
PYTHONPATH=src python -m knot_rag.evaluation.compare_embeddings \
  --candidates evaluation/embedding_candidates.json --corpus tests/fixtures/corpus_v2.json \
  --dataset /tmp/challenge_v1.json --only hashing-baseline,minilm-l12-multi,e5-small-multi \
  --out evaluation/reports/adr010-challenge-v1-2026-10-08.json
PYTHONPATH=src python evaluation/scripts/adr010_breakdown.py /tmp/challenge_v1.json \
  hashing-baseline,minilm-l12-multi,e5-small-multi evaluation/reports/adr010-breakdown-2026-10-08.json
```

Quality metrics are deterministic for the pinned revisions. Latency and RSS depend on the
hardware. RSS in the breakdown file accumulates across models within one process; the RAM
figures above come from separate processes.

## 5. Not yet measured

| Item | Blocked by | What is needed |
| --- | --- | --- |
| Multilingual embedding comparison | ~~huggingface.co denied~~ Done for 3 candidates (§4.7); mpnet, e5-base, bge-m3 and Turkish BERT not run | Run the remaining candidates if e5-small proves insufficient |
| Answer quality with a real LLM | No provider configured | `LLM_*` settings, then the runner with `--provider env` |
| Semantic judge agreement with humans | Both of the above, plus labels | Label ≥ 100 claims; run with `SUPPORT_JUDGE=llm`; report agreement |
| Independent review of gold labels | Team | A second reviewer for eval.v2 |
| Project targets (≥ 0.80 supported answers, ≥ 0.75 retrieval, ≤ 0.20 unsupported claims) | All of the above | **Not claimed** |

## 6. Limitations

1. Support rules are lexical. S3 catches substantial borrowing only: one wrong word in a
   five-word claim still passes (`test_s3_limit_single_borrowed_word_still_passes`). Negation
   detection covers common Turkish and English markers only.
2. Implicit topics cause false partials. A chunk that answers an AVL question without saying
   "AVL" lowers question coverage
   (`test_known_limitation_implicit_topic_gives_false_partial`).
3. Question coverage can't tell decisive terms ("Dijkstra") from incidental ones; that needs
   corpus statistics (IDF) or a semantic judge.
4. Thresholds were calibrated on 28 questions; expect them to move with a real LLM and real
   embeddings.
5. Token budgeting uses a character heuristic; highlights are character offsets, not PDF
   coordinates; the body-size limit relies on `Content-Length`.
