"""Reproducible retrieval comparison of embedding models (no LLM involved).

    python -m knot_rag.evaluation.compare_embeddings \
        --candidates evaluation/embedding_candidates.json \
        --corpus tests/fixtures/corpus_v2.json --dataset tests/fixtures/eval_dataset_v2.json \
        --out evaluation/reports/embeddings-<date>.json

For every candidate the corpus is indexed into a fresh in-memory Chroma collection with that
model (documents with its passage prefix), and the labelled questions are retrieved with the
production RetrievalService/ContextBuilder. A candidate that cannot be loaded (package not
installed, model not downloadable, no network) is reported as BLOCKED with the reason — no
numbers are produced for it. Quality metrics are deterministic for a given model revision;
latency figures depend on hardware and are reported separately.
"""

from __future__ import annotations

import argparse
import json
import platform
import statistics
import sys
import time
import uuid
from collections import defaultdict
from dataclasses import replace
from importlib import metadata
from pathlib import Path
from typing import Any

from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.evaluation.metrics import ItemResult, mrr, multi_passage_recall, recall_at, retrieval_success, scope_leakage, threshold_sweep
from knot_rag.evaluation.runner import DEFAULT_THRESHOLDS, evaluate
from knot_rag.generation.providers import ExtractiveBaselineProvider
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from knot_rag.retrieval.embedding import Embedder, build_embedder
from knot_rag.schemas import IndexedChunk


def _version(pkg: str) -> str | None:
    try:
        return metadata.version(pkg)
    except metadata.PackageNotFoundError:
        return None


def environment() -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "packages": {p: _version(p) for p in ("chromadb", "sentence-transformers", "torch", "transformers", "pydantic")},
    }


def resolved_revision(model: str, revision: str | None) -> str | None:
    """Commit hash of the cached model snapshot, if huggingface_hub can tell."""
    try:
        from huggingface_hub import try_to_load_from_cache

        path = try_to_load_from_cache(model, "config.json", revision=revision or "main")
        if isinstance(path, str) and "/snapshots/" in path:
            return path.split("/snapshots/")[1].split("/")[0]
    except Exception:
        return None
    return None


def build_candidate(c: dict[str, Any]) -> Embedder:
    return build_embedder(
        c["backend"], c.get("model", ""), c.get("query_prefix", ""), c.get("document_prefix", ""),
        c.get("revision"), c.get("dimension", 512),
    )


def per_category(items: list[ItemResult]) -> dict[str, dict[str, Any]]:
    groups: dict[str, list[ItemResult]] = defaultdict(list)
    for i in items:
        groups[i.category].append(i)
    return {
        cat: {"retrieval_success": retrieval_success(g).as_dict()["value"], "n_in_scope": sum(1 for i in g if i.in_scope)}
        for cat, g in sorted(groups.items())
    }


def run_candidate(c: dict[str, Any], chunks: list[IndexedChunk], dataset: dict[str, Any], settings: Settings) -> dict[str, Any]:
    base: dict[str, Any] = {k: c.get(k) for k in ("id", "backend", "model", "revision", "query_prefix", "document_prefix", "notes")}
    try:
        emb = build_candidate(c)
        emb.embed_query("yoklama")  # forces model load; fails fast if unavailable
        dim = emb.dimension
    except Exception as exc:  # noqa: BLE001 - every load failure is reported, never hidden
        return {**base, "status": "BLOCKED", "reason": f"{type(exc).__name__}: {str(exc)[:300]}"}

    import chromadb

    client = chromadb.EphemeralClient()
    name = f"cmp_{uuid.uuid4().hex[:10]}"
    t0 = time.perf_counter()
    ChromaChunkWriter(client, name, emb).upsert(chunks)
    index_s = time.perf_counter() - t0

    comps = build_components(settings, index=ChromaChunkIndex(client, name, emb), embedder=emb, provider=ExtractiveBaselineProvider())
    items = evaluate(comps, dataset, generate=False)

    lat = []
    for it in dataset["items"]:
        t = time.perf_counter()
        emb.embed_query(it["question"])
        lat.append((time.perf_counter() - t) * 1000)
    lat.sort()

    return {
        **base,
        "status": "OK",
        "model_id": emb.model_id,
        "dimension": dim,
        "resolved_revision": resolved_revision(c["model"], c.get("revision")) if c["backend"] == "sentence_transformers" else None,
        "quality": {
            "retrieval_success": retrieval_success(items).as_dict(),
            "recall_at_1": recall_at(items, 1).as_dict(),
            "recall_at_3": recall_at(items, 3).as_dict(),
            "mrr": mrr(items).as_dict(),
            "multi_passage_recall": multi_passage_recall(items).as_dict(),
            "scope_leakage": scope_leakage(items).as_dict(),
            "by_category": per_category(items),
            "by_split": {
                s: retrieval_success([i for i in items if i.split == s]).as_dict()
                for s in sorted({i.split for i in items})
            },
            "threshold_sweep": threshold_sweep(items, DEFAULT_THRESHOLDS),
        },
        "performance": {
            "index_seconds": round(index_s, 3),
            "query_ms_p50": round(statistics.median(lat), 2),
            "query_ms_p95": round(lat[int(0.95 * (len(lat) - 1))], 2),
            "note": "hardware dependent; not comparable across machines",
        },
    }


def markdown(report: dict[str, Any]) -> str:
    rows = ["| candidate | status | dim | retrieval success | R@1 | R@3 | MRR | leakage | p50 ms |", "|---|---|---|---|---|---|---|---|---|"]
    for r in report["results"]:
        if r["status"] != "OK":
            rows.append(f"| {r['id']} | BLOCKED — {r['reason'][:80]} | | | | | | | |")
            continue
        q = r["quality"]
        f = lambda m: f"{m['value']:.3f}" if m["value"] is not None else "—"  # noqa: E731
        rows.append(
            f"| {r['id']} | OK | {r['dimension']} | {f(q['retrieval_success'])} | {f(q['recall_at_1'])} | {f(q['recall_at_3'])} "
            f"| {f(q['mrr'])} | {q['scope_leakage']['numerator']} | {r['performance']['query_ms_p50']} |"
        )
    return "\n".join(rows)


def compare(candidates: list[dict[str, Any]], chunks: list[IndexedChunk], dataset: dict[str, Any], settings: Settings) -> dict[str, Any]:
    return {
        "dataset": dataset.get("version"),
        "corpus_chunks": len(chunks),
        "retrieval_settings": settings.retrieval.__dict__,
        "environment": environment(),
        "results": [run_candidate(c, chunks, dataset, settings) for c in candidates],
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--only", help="Comma-separated candidate ids.")
    ap.add_argument("--out")
    args = ap.parse_args(argv)

    cands = json.loads(Path(args.candidates).read_text(encoding="utf-8"))["candidates"]
    if args.only:
        wanted = set(args.only.split(","))
        cands = [c for c in cands if c["id"] in wanted]
    chunks = [IndexedChunk.model_validate(c) for c in json.loads(Path(args.corpus).read_text(encoding="utf-8"))["chunks"]]
    dataset = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    settings = replace(Settings(auth_disabled=True), chroma_mode="memory")
    report = compare(cands, chunks, dataset, settings)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    sys.stdout.write(markdown(report) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
