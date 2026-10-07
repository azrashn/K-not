"""Run the evaluation dataset through the real pipeline.

    python -m knot_rag.evaluation.runner --corpus tests/fixtures/corpus.json \
        --dataset tests/fixtures/eval_dataset.json --embedding hashing --provider extractive

`--corpus` seeds a throw-away in-memory Chroma (offline mode). Omit it to evaluate against
the index configured via environment (CHROMA_*), e.g. one built by WBS-2.
`--provider env` uses the LLM configured via LLM_* variables (a real model).
"""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

from knot_rag.bootstrap import Components, build_components
from knot_rag.config import Settings
from knot_rag.errors import RagError
from knot_rag.evaluation.metrics import ItemResult, summarize
from knot_rag.schemas import AnswerRequest, AuthorizedScope, IndexedChunk, RetrievalParams
from knot_rag.schemas.answer import CitationIssueType

DEFAULT_THRESHOLDS = [0.0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5]
# eval.v1 has no outcome labels; derive them from the category (same rule eval.v2 used).
_DEFAULT_OUTCOME = {
    "partial": ["PARTIALLY_ANSWERED"],
    "out_of_scope": ["INSUFFICIENT_EVIDENCE"],
}


def expected_outcome(item: dict[str, Any]) -> list[str]:
    if "expected_outcome" in item:
        return list(item["expected_outcome"])
    if item["category"] in _DEFAULT_OUTCOME:
        return _DEFAULT_OUTCOME[item["category"]]
    return ["ANSWERED"] if item.get("expected_chunk_ids") else ["INSUFFICIENT_EVIDENCE"]


def evaluate(components: Components, dataset: dict[str, Any], *, generate: bool = True) -> list[ItemResult]:
    results: list[ItemResult] = []
    rag = components.rag
    top_k = components.settings.retrieval.top_k
    for item in dataset["items"]:
        docs = item.get("scope_docs", dataset["default_scope"])
        scope = AuthorizedScope(user_id=dataset["user_id"], course_id=dataset["course_id"], document_ids=docs)
        # Raw candidates without a score floor, so the threshold sweep can be computed offline.
        raw = rag.retrieval.retrieve(item["question"], scope, RetrievalParams(top_k=top_k, min_score=-1.0))
        built = rag.context_builder.build(raw.hits)
        r = ItemResult(
            item_id=item["id"],
            category=item["category"],
            expected=item.get("expected_chunk_ids", []),
            acceptable=item.get("acceptable_chunk_ids", []),
            require_all=item.get("require_all", False),
            candidate_ids=[h.chunk.chunk_id for h in raw.hits],
            candidate_scores=[h.score for h in raw.hits],
            context_ids=[e.chunk_id for e in built.evidence],
            out_of_scope_hits=raw.rejected_out_of_scope,
            expected_outcome=expected_outcome(item),
            split=item.get("split", "all"),
        )
        if generate:
            try:
                ans = rag.answer(AnswerRequest(question=item["question"], scope=scope), f"eval-{item['id']}")
                r.outcome = ans.outcome.value
                r.answer_support = ans.support_status.value
                r.claim_statuses = [c.support_status.value for c in ans.claims]
                r.cited_chunk_ids = [cit.chunk_id for c in ans.claims for cit in c.citations]
                r.fabricated_citations = sum(1 for x in ans.citation_issues if x.issue == CitationIssueType.UNKNOWN_EVIDENCE_ID)
                r.supported_cited_chunk_ids = [
                    cit.chunk_id for c in ans.claims if c.support_status.value == "SUPPORTED" for cit in c.citations
                ]
                r.confirmed_claims = sum(1 for c in ans.claims if c.support_confirmed)
            except RagError as exc:
                r.outcome = f"ERROR:{exc.code.value}"
        results.append(r)
    return results


def _assessor_name(components: Components) -> str:
    from knot_rag.evidence.judge import LLMJudgeSupportAssessor
    from knot_rag.evidence.support import METHOD

    judged = isinstance(components.rag.assessor, LLMJudgeSupportAssessor)
    return f"{METHOD}{' + LLM judge' if judged else ''} (automatic; not human-judged)"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--corpus", help="Seed an in-memory Chroma with this corpus JSON (offline mode).")
    ap.add_argument("--embedding", choices=["hashing", "env"], default="env")
    ap.add_argument("--provider", choices=["extractive", "env", "none"], default="env")
    ap.add_argument("--min-score", type=float, default=None, help="Score floor used for the answer step.")
    ap.add_argument("--out", help="Write the JSON report here.")
    args = ap.parse_args(argv)

    import os

    env = dict(os.environ)
    env.setdefault("RAG_AUTH_DISABLED", "true")
    settings = Settings.from_env(env)
    if args.embedding == "hashing":
        settings = replace(settings, embedding_backend="hashing")
    if args.provider == "extractive":
        settings = replace(settings, llm=replace(settings.llm, provider="extractive"))
    if args.min_score is not None:
        settings = replace(settings, retrieval=replace(settings.retrieval, min_score=args.min_score))

    chroma_client = None
    if args.corpus:
        import chromadb

        from knot_rag.retrieval.chroma_index import ChromaChunkWriter
        from knot_rag.retrieval.embedding import build_embedder

        settings = replace(settings, chroma_mode="memory", chroma_collection=f"eval_{uuid.uuid4().hex[:8]}")
        chroma_client = chromadb.EphemeralClient()
        corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
        chunks = [IndexedChunk.model_validate(c) for c in corpus["chunks"]]
        emb = build_embedder(settings.embedding_backend, settings.embedding_model, settings.embedding_query_prefix,
                              settings.embedding_document_prefix, settings.embedding_revision)
        ChromaChunkWriter(chroma_client, settings.chroma_collection, emb).upsert(chunks)
        components = build_components(settings, embedder=emb, chroma_client=chroma_client)
    else:
        components = build_components(settings)

    dataset = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    results = evaluate(components, dataset, generate=args.provider != "none")
    report = {
        "dataset": dataset.get("version"),
        "items": len(results),
        "embedding_model": components.embedder.model_id,
        "provider": f"{components.provider.name}:{components.provider.model}" if args.provider != "none" else None,
        "min_score": settings.retrieval.min_score,
        "support_assessor": _assessor_name(components),
        "metrics": summarize(results, DEFAULT_THRESHOLDS),
        "metrics_by_split": {
            split: summarize([r for r in results if r.split == split])
            for split in sorted({r.split for r in results}) if split != "all"
        },
        "per_item": [
            {"id": r.item_id, "category": r.category, "gold_in_candidates": bool(set(r.expected) & set(r.candidate_ids)) if r.expected else None,
             "top_score": r.candidate_scores[0] if r.candidate_scores else None, "outcome": r.outcome,
             "expected_outcome": r.expected_outcome, "support": r.answer_support, "split": r.split}
            for r in results
        ],
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    sys.stdout.write(text + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
