# RAG API Contract (`rag.v1`)

Internal HTTP API of the Python RAG service. **Caller: the NestJS backend only.**
Interactive OpenAPI: `GET /docs` (schema at `/openapi.json`).

## Conventions

| Item | Rule |
| --- | --- |
| Auth | `Authorization: Bearer <RAG_INTERNAL_API_TOKEN>` (or `X-Internal-Token: <token>`) on every `/api/v1/*` call. Missing or wrong → `401 UNAUTHORIZED`. |
| Correlation | Send `X-Request-ID` (`[A-Za-z0-9_.:-]{1,128}`) or `request_id` in the body (body wins). Echoed in the response header and body; generated if absent. |
| Versioning | Every body has `schema_version: "rag.v1"`. Additive fields may appear within `v1`; renames or removals mean `v2` under a new path (`/api/v2`). Clients must ignore unknown response fields. Requests with unknown fields are **rejected** (422). |
| Encoding | UTF-8 JSON. Turkish text is returned as-is (the examples below are human-readable; on the wire `ı` may be `ı`). |
| Timeouts | LLM call: `LLM_TIMEOUT_SECONDS` (default 30 s). NestJS should use a client timeout ≥ LLM timeout + 5 s. |
| Limits | question ≤ 2,000 chars · `document_ids` 1–1,000 · `top_k` 1–50 · `max_evidence` 1–20 · body ≤ 256 KB |

## Endpoints

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | – | Liveness. `200 {"status":"ok"}` while the process runs. |
| `GET /ready` | – | Readiness: index reachable and compatible with the embedder. `200` or `503` with `checks`. |
| `POST /api/v1/rag/retrieve` | ✔ | Scoped evidence only (no LLM). For question generation (WBS-6), answer evaluation (WBS-7), debugging. |
| `POST /api/v1/rag/answer` | ✔ | Grounded answer: claims + citations + support states. |

## Request body (both POST endpoints)

```json
{
  "request_id": "req-7f3a",
  "question": "AVL ağacı ile kırmızı-siyah ağaç arasındaki fark nedir?",
  "scope": {
    "user_id": "u-ayse",
    "course_id": "veri-yapilari",
    "document_ids": ["doc-vy-hafta4", "doc-vy-notlar"]
  },
  "params": { "top_k": 8, "max_evidence": 6, "min_score": null, "max_context_tokens": 3000 }
}
```

- `scope` **must be computed by NestJS** from its own database: documents the user may read in
  that course whose indexing status is *ready*. Never forward ids from the browser unchecked.
- `params` is optional; each `null` or omitted field uses the server default.

## `POST /api/v1/rag/retrieve` → `RetrieveResponse`

`outcome` is `EVIDENCE_FOUND` or `NO_EVIDENCE` (both 200). Example (`max_evidence: 2`):

```json
{
  "schema_version": "rag.v1",
  "request_id": "req-7f3a",
  "question": "AVL ağacında kaç temel rotasyon vardır?",
  "retrieval_query": "AVL ağacında kaç temel rotasyon vardır?",
  "outcome": "EVIDENCE_FOUND",
  "evidence": [
    {
      "evidence_id": "E1",
      "chunk_id": "doc-vy-notlar:v1:003",
      "document_id": "doc-vy-notlar",
      "course_id": "veri-yapilari",
      "document_title": "Kişisel Ders Notları",
      "document_type": "notes",
      "indexing_version": "v1",
      "location": {
        "page_start": 2,
        "page_end": 3,
        "char_start": 227,
        "char_end": 397,
        "section_title": "Rotasyonların Özeti"
      },
      "label": "Notlar · s.2–3",
      "text": "Tek rotasyon: LL, RR. Çift rotasyon: LR, RL (iki adımlı düzeltme). Dört temel rotasyon vardır: LL, RR, LR ve RL. LL ve RR tek rotasyon; LR ve RL çift rotasyon gerektirir.",
      "score": 0.470764,
      "rank": 1,
      "truncated": false
    },
    {
      "evidence_id": "E2",
      "chunk_id": "doc-vy-hafta4:v1:004",
      "document_id": "doc-vy-hafta4",
      "course_id": "veri-yapilari",
      "document_title": "Ders Slaytları · Hafta 4 — AVL Ağaçları",
      "document_type": "slide",
      "indexing_version": "v1",
      "location": {
        "page_start": 18,
        "page_end": 18,
        "char_start": null,
        "char_end": null,
        "section_title": "AVL Ağaçları: Denge Koşulu"
      },
      "label": "Slayt · s.18",
      "text": "Denge koşulu bozulduğunda (fark ≥ 2) ağaç rotasyon işlemleriyle yeniden dengelenir. Rotasyon yükseklik farkını telafi eder; arama O(log n) kalır.",
      "score": 0.302995,
      "rank": 2,
      "truncated": false
    }
  ],
  "diagnostics": {
    "candidates": 8,
    "rejected_out_of_scope": 0,
    "below_min_score": 0,
    "duplicates_removed": 0,
    "dropped_by_limits": 6,
    "context_tokens_estimate": 186,
    "embedding_model": "knot-hashing-v1-d512"
  }
}
```

## `POST /api/v1/rag/answer` → `GroundedAnswer`

Produced by the real pipeline over the fixture corpus, with the model output scripted so that
all three cases appear. Example with three claims: one well supported, one partially supported, and one where the
model cited a fabricated id (`E9`). The fabricated citation was removed and reported in
`citation_issues`, so the claim is KOPUK.

```json
{
  "schema_version": "rag.v1",
  "answer_id": "0b6c2f8e-5d1a-4c3e-9f7a-2e8d4b1c6a90",
  "request_id": "req-7f3a",
  "question": "AVL ağacı ile kırmızı-siyah ağaç arasındaki fark nedir?",
  "course_id": "veri-yapilari",
  "outcome": "PARTIALLY_ANSWERED",
  "support_status": "PARTIALLY_SUPPORTED",
  "support_label": "GEVEŞEK",
  "answer_text": "AVL ağacı daha sıkı dengelidir; bu yüzden arama genellikle daha hızlıdır. Kırmızı-siyah ağaçlarda ekleme ve silme daha az rotasyon gerektirir. Kırmızı-siyah ağaçlarda yükseklik en fazla 2·log(n+1) olabilir.",
  "claims": [
    {
      "claim_id": "c1",
      "claim_text": "AVL ağacı daha sıkı dengelidir; bu yüzden arama genellikle daha hızlıdır.",
      "cited_evidence_ids": [
        "E3"
      ],
      "citations": [
        {
          "evidence_id": "E3",
          "chunk_id": "doc-vy-notlar:v1:002",
          "document_id": "doc-vy-notlar",
          "document_title": "Kişisel Ders Notları",
          "location": {
            "page_start": 1,
            "page_end": 1,
            "char_start": 129,
            "char_end": 226,
            "section_title": "Hafta 4 — Genel Notlar"
          },
          "label": "Notlar · s.1",
          "quote": "daha sıkı dengeli; arama daha hızlı",
          "quote_verified": true,
          "highlight": {
            "chunk_char_start": 37,
            "chunk_char_end": 72,
            "document_char_start": 166,
            "document_char_end": 201
          }
        }
      ],
      "support_status": "PARTIALLY_SUPPORTED",
      "support_label": "GEVEŞEK",
      "support_explanation": "Kısmen destekleniyor: alıntılanan cümle iddianın tamamını içermiyor.",
      "assessment": {
        "method": "citation-lexical-v2",
        "citations_valid": true,
        "quote_verified": true,
        "lexical_coverage": 0.5,
        "numbers_consistent": true,
        "model_marked_partial": false,
        "semantically_verified": false,
        "verification": "HEURISTIC",
        "quote_coverage": 0.5,
        "question_relevance": 0.4,
        "negation_consistent": true,
        "addresses_question": true,
        "judge_verdict": null
      },
      "support_confirmed": false
    },
    {
      "claim_id": "c2",
      "claim_text": "Kırmızı-siyah ağaçlarda ekleme ve silme daha az rotasyon gerektirir.",
      "cited_evidence_ids": [
        "E2"
      ],
      "citations": [
        {
          "evidence_id": "E2",
          "chunk_id": "doc-vy-notlar:v1:006",
          "document_id": "doc-vy-notlar",
          "document_title": "Kişisel Ders Notları",
          "location": {
            "page_start": 4,
            "page_end": 4,
            "char_start": 616,
            "char_end": 809,
            "section_title": "Karmaşıklık Karşılaştırması"
          },
          "label": "Notlar · s.4",
          "quote": "ekleme ve silme biraz daha hızlı",
          "quote_verified": true,
          "highlight": {
            "chunk_char_start": 160,
            "chunk_char_end": 192,
            "document_char_start": 776,
            "document_char_end": 808
          }
        }
      ],
      "support_status": "PARTIALLY_SUPPORTED",
      "support_label": "GEVEŞEK",
      "support_explanation": "Kısmen destekleniyor: alıntılanan cümle iddianın tamamını içermiyor; kaynak iddianın yalnızca bir kısmını destekliyor.",
      "assessment": {
        "method": "citation-lexical-v2",
        "citations_valid": true,
        "quote_verified": true,
        "lexical_coverage": 0.5714,
        "numbers_consistent": true,
        "model_marked_partial": true,
        "semantically_verified": false,
        "verification": "HEURISTIC",
        "quote_coverage": 0.2857,
        "question_relevance": 0.4,
        "negation_consistent": true,
        "addresses_question": true,
        "judge_verdict": null
      },
      "support_confirmed": false
    },
    {
      "claim_id": "c3",
      "claim_text": "Kırmızı-siyah ağaçlarda yükseklik en fazla 2·log(n+1) olabilir.",
      "cited_evidence_ids": [],
      "citations": [],
      "support_status": "UNSUPPORTED",
      "support_label": "KOPUK",
      "support_explanation": "İddia, getirilen kaynaklarda olmayan bir kanıta atıf yaptı.",
      "assessment": {
        "method": "citation-lexical-v2",
        "citations_valid": false,
        "quote_verified": false,
        "lexical_coverage": 0.0,
        "numbers_consistent": false,
        "model_marked_partial": false,
        "semantically_verified": false,
        "verification": "HEURISTIC",
        "quote_coverage": null,
        "question_relevance": 0.4,
        "negation_consistent": true,
        "addresses_question": true,
        "judge_verdict": null
      },
      "support_confirmed": false
    }
  ],
  "evidence": [
    {
      "evidence_id": "E1",
      "chunk_id": "doc-vy-hafta4:v1:003",
      "document_id": "doc-vy-hafta4",
      "course_id": "veri-yapilari",
      "document_title": "Ders Slaytları · Hafta 4 — AVL Ağaçları",
      "document_type": "slide",
      "indexing_version": "v1",
      "location": {
        "page_start": 18,
        "page_end": 18,
        "char_start": null,
        "char_end": null,
        "section_title": "AVL Ağaçları: Denge Koşulu"
      },
      "label": "Slayt · s.18",
      "text": "AVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.",
      "score": 0.368773,
      "rank": 1,
      "truncated": false
    },
    {
      "evidence_id": "E2",
      "chunk_id": "doc-vy-notlar:v1:006",
      "document_id": "doc-vy-notlar",
      "course_id": "veri-yapilari",
      "document_title": "Kişisel Ders Notları",
      "document_type": "notes",
      "indexing_version": "v1",
      "location": {
        "page_start": 4,
        "page_end": 4,
        "char_start": 616,
        "char_end": 809,
        "section_title": "Karmaşıklık Karşılaştırması"
      },
      "label": "Notlar · s.4",
      "text": "Ağaç · Arama · Ekleme — BST (dengesiz) · O(n) · O(n) — AVL · O(log n) · O(log n) — Kırmızı-siyah · O(log n) · O(log n). Kırmızı-siyah ağaçta denge daha gevşek; ekleme ve silme biraz daha hızlı.",
      "score": 0.296507,
      "rank": 3,
      "truncated": false
    },
    {
      "evidence_id": "E3",
      "chunk_id": "doc-vy-notlar:v1:002",
      "document_id": "doc-vy-notlar",
      "course_id": "veri-yapilari",
      "document_title": "Kişisel Ders Notları",
      "document_type": "notes",
      "indexing_version": "v1",
      "location": {
        "page_start": 1,
        "page_end": 1,
        "char_start": 129,
        "char_end": 226,
        "section_title": "Hafta 4 — Genel Notlar"
      },
      "label": "Notlar · s.1",
      "text": "Pratikte kırmızı-siyah ağaçlara göre daha sıkı dengeli; arama daha hızlı, güncelleme biraz yavaş.",
      "score": 0.223941,
      "rank": 4,
      "truncated": false
    }
  ],
  "insufficient_evidence": {
    "reason": "PARTIAL_COVERAGE",
    "message": "Yanıtın yalnızca bir kısmı için yeterli kanıt var.",
    "missing_information": [
      "Kırmızı-siyah ağaçların yükseklik üst sınırı materyallerde geçmiyor."
    ]
  },
  "citation_issues": [
    {
      "claim_id": "c3",
      "evidence_id": "E9",
      "issue": "UNKNOWN_EVIDENCE_ID"
    }
  ],
  "retrieval": {
    "candidates": 8,
    "rejected_out_of_scope": 0,
    "below_min_score": 0,
    "duplicates_removed": 1,
    "dropped_by_limits": 4,
    "context_tokens_estimate": 256,
    "embedding_model": "knot-hashing-v1-d512"
  },
  "generation": {
    "provider": "openai_compatible",
    "model": "example-model",
    "prompt_version": "grounded-answer.v1",
    "attempts": 1,
    "latency_ms": 1840
  },
  "support_confirmed": false,
  "verification": "HEURISTIC",
  "question_coverage": {
    "method": "key-term-stem-v1",
    "key_terms": [
      "AVL",
      "ağacı",
      "kırmızı",
      "siyah",
      "fark"
    ],
    "uncovered_terms": [
      "fark"
    ],
    "ratio": 0.8,
    "absent_from_context": []
  }
}
```

> Note on `c1`: the quote is verbatim, but the quoted sentence contains only part of the claim
> (rule S3: "bu yüzden … genellikle" is not in it), so the heuristic rates it GEVEŞEK. A semantic
> judge (`SUPPORT_JUDGE=llm`) may upgrade such overlap-only cases; see `rag-architecture.md` §6.
> `support_confirmed` is `false` everywhere because no judge ran: **a heuristic SIKI is never
> "confirmed"**.

### Field guide

| Field | Meaning |
| --- | --- |
| `outcome` | `ANSWERED` · `PARTIALLY_ANSWERED` · `INSUFFICIENT_EVIDENCE` |
| `support_status` / `support_label` | Answer-level SUPPORTED/PARTIALLY_SUPPORTED/UNSUPPORTED → SIKI/GEVEŞEK/KOPUK |
| `claims[].citations[]` | Structured pointers; each `evidence_id` is guaranteed to exist in `evidence[]` |
| `citations[].chunk_id` | Stable WBS-2 id. **Persist this**, not `evidence_id` (which is response-local). |
| `citations[].location` | Page range / offsets as indexed; `null` means unknown and is never guessed |
| `citations[].quote_verified`, `highlight` | Highlight offsets exist only for verbatim-verified quotes. `chunk_char_*` index into `evidence[].text`; `document_char_*` index into the extracted document text when WBS-2 supplied chunk offsets and the chunk was not truncated. |
| `claims[].assessment` | Inputs to the support decision (rules S1–S8, see architecture §6). `verification`: `HEURISTIC` · `SEMANTIC_JUDGE` · `HEURISTIC_FALLBACK`; `semantically_verified` is `true` only for `SEMANTIC_JUDGE` |
| `claims[].assessment.addresses_question` | `false` = side remark (rule S7). Shown as GEVEŞEK but does not make the answer incomplete; the UI may de-emphasise it |
| `claims[].assessment.unsupported_terms` | *(additive, `citation-lexical-v3`)* Claim content terms found in none of the cited passages (rule S8); non-empty blocks SIKI by default. `null` when the claim has no valid citation |
| Conflicting evidence | No new field: conflicted claims are GEVEŞEK with "…başka bir kaynakla çelişiyor (E1, E3)." in `support_explanation`, and `insufficient_evidence.missing_information` names the disagreeing evidence ids (`reason` `PARTIAL_COVERAGE`) |
| `claims[].support_confirmed`, `support_confirmed` | `true` only for SIKI that a semantic judge verified. Show heuristic SIKI as "kaynağa bağlı (otomatik kontrol)", never as "doğrulandı" |
| `verification` | Weakest verification level across claims |
| `question_coverage` | Key terms of the question, those not found in the backing evidence (`uncovered_terms`), `ratio`, and `absent_from_context` (informational). `ratio < 0.6` prevents `ANSWERED` |
| `citation_issues[]` | `UNKNOWN_EVIDENCE_ID` (fabricated reference) or `QUOTE_NOT_FOUND` (quote absent from cited chunk) |
| `evidence[].score` | Cosine similarity ranking signal; **not a probability** |
| `insufficient_evidence` | Set whenever `outcome ≠ ANSWERED`: `reason` (`NO_RETRIEVED_EVIDENCE` · `MODEL_DECLINED` · `NO_SUPPORTED_CLAIMS` · `PARTIAL_COVERAGE`), a Turkish `message`, and `missing_information` |
| `generation` | Provider, model, prompt version, attempts, latency; `null` if the LLM was not called |

### Changelog

| Version | Change | Compatibility |
| --- | --- | --- |
| `rag.v1` (initial) | Endpoints and schemas as above | – |
| `rag.v1` + 1.1 fields | Added `claims[].support_confirmed`, `support_confirmed`, `verification`, `question_coverage`; `assessment.{verification, quote_coverage, question_relevance, negation_consistent, addresses_question, judge_verdict}`. Support method `citation-lexical-v1` → `-v2` (stricter SIKI rules; see architecture §6). | Additive: all new fields have defaults; `schema_version` stays `rag.v1`. **Behaviour change:** fewer claims and answers are SIKI / `ANSWERED` than before for the same input. |

### No-evidence response (success, HTTP 200)

```json
{
  "schema_version": "rag.v1",
  "answer_id": "5e0d7a41-8c2b-4f6e-b1d3-9a7c0e2f4b58",
  "request_id": "req-7f3a",
  "question": "İstanbul'un nüfusu kaçtır?",
  "course_id": "veri-yapilari",
  "outcome": "INSUFFICIENT_EVIDENCE",
  "support_status": "UNSUPPORTED",
  "support_label": "KOPUK",
  "answer_text": "",
  "claims": [],
  "evidence": [],
  "insufficient_evidence": {
    "reason": "NO_RETRIEVED_EVIDENCE",
    "message": "Yüklediğin materyallerde bu soruyu yanıtlamaya yetecek bilgi bulunamadı. Tahmin yürütmek yerine durdum.",
    "missing_information": []
  },
  "citation_issues": [],
  "retrieval": {
    "candidates": 8,
    "rejected_out_of_scope": 0,
    "below_min_score": 8,
    "duplicates_removed": 0,
    "dropped_by_limits": 0,
    "context_tokens_estimate": 0,
    "embedding_model": "knot-hashing-v1-d512"
  },
  "generation": null,
  "support_confirmed": false,
  "verification": "HEURISTIC",
  "question_coverage": null
}
```

## Errors

All errors share one envelope; `message` is safe to show and never contains internals.

```json
{
  "schema_version": "rag.v1",
  "error": {
    "code": "INDEX_NOT_READY",
    "message": "None of the authorized documents has indexed content yet.",
    "request_id": "req-7f3a",
    "retryable": true,
    "details": {
      "course_id": "veri-yapilari",
      "document_count": 1
    }
  }
}
```

```json
{
  "schema_version": "rag.v1",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "request_id": "req-7f3a",
    "retryable": false,
    "details": {
      "errors": [
        {
          "loc": [
            "body",
            "question"
          ],
          "msg": "String should have at least 1 character"
        }
      ]
    }
  }
}
```

| HTTP | `code` | When | `retryable` |
| --- | --- | --- | --- |
| 401 | `UNAUTHORIZED` | Missing or wrong internal token | no |
| 403 | `UNAUTHORIZED_SCOPE` | Authorized `document_ids` are indexed under a *different* `course_id` (a NestJS bug or a tampered scope). No content is returned. | no |
| 409 | `INDEX_NOT_READY` | No indexed chunk in the authorized scope, or the collection does not exist yet | yes, after indexing |
| 413 / 422 | `VALIDATION_ERROR` | Malformed body, unknown field, limits exceeded, empty question | no |
| 500 | `INTERNAL_ERROR` | Unexpected failure, or misconfiguration such as an embedding model mismatch | no |
| 502 | `GENERATION_FAILED` | Provider error, or model output invalid after retries | usually yes |
| 503 | `RETRIEVAL_UNAVAILABLE` | ChromaDB unreachable | yes |
| 504 | `PROVIDER_TIMEOUT` | LLM exceeded `LLM_TIMEOUT_SECONDS` | yes |

`NO_EVIDENCE` is **not** an error code in responses: lack of evidence is a successful
`INSUFFICIENT_EVIDENCE` answer (or `outcome: NO_EVIDENCE` from `/retrieve`). The enum value
exists so NestJS can reuse the vocabulary in its own API.
