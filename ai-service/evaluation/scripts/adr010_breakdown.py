"""ADR-010 breakdown for a locked dataset (e.g. challenge.v1): Recall@1/3/5, MRR, retrieval success
per dataset `language` and `category`, top-1 scores of out-of-scope items, scope leakage, latency.

Reuses the existing harness unchanged (build_candidate, ChromaChunkWriter/ChromaChunkIndex with the
C-1 EmbeddingConfiguration, runner.evaluate, metrics.*); it only groups the per-item results.

    git show 7bc6bb0:ai-service/evaluation/validation/challenge_v1.json > /tmp/challenge_v1.json
    PYTHONPATH=src python evaluation/scripts/adr010_breakdown.py /tmp/challenge_v1.json \
        hashing-baseline,minilm-l12-multi,e5-small-multi evaluation/reports/adr010-breakdown-<date>.json
"""
import json, statistics, sys, time, uuid, resource
from collections import defaultdict
from dataclasses import replace
from pathlib import Path

import chromadb
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.evaluation.compare_embeddings import build_candidate, resolved_revision
from knot_rag.evaluation.metrics import mrr, recall_at, retrieval_success, scope_leakage, multi_passage_recall
from knot_rag.evaluation.runner import evaluate
from knot_rag.generation.providers import ExtractiveBaselineProvider
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from knot_rag.schemas import EmbeddingConfiguration, IndexedChunk

cands = {c["id"]: c for c in json.loads(Path("evaluation/embedding_candidates.json").read_text())["candidates"]}
dataset = json.loads(Path(sys.argv[1]).read_text())
chunks = [IndexedChunk.model_validate(c) for c in json.loads(Path("tests/fixtures/corpus_v2.json").read_text())["chunks"]]
lang = {i["id"]: i["language"] for i in dataset["items"]}
settings = replace(Settings(auth_disabled=True), chroma_mode="memory")
out = {}
for cid in sys.argv[2].split(","):
    c = cands[cid]
    emb = build_candidate(c); t0 = time.perf_counter(); emb.embed_query("yoklama"); load_s = time.perf_counter() - t0
    cfg = EmbeddingConfiguration(backend=c["backend"], model=c["model"], revision=c.get("revision") if c.get("revision") != "main" else None,
                                 dimension=emb.dimension, query_prefix=c.get("query_prefix", ""), document_prefix=c.get("document_prefix", ""))
    client = chromadb.EphemeralClient(); name = f"adr_{uuid.uuid4().hex[:8]}"
    ChromaChunkWriter(client, name, emb, configuration=cfg, index_version_id="adr010").upsert(chunks)
    col = client.get_collection(name)
    vecs = col.get(limit=5, include=["embeddings"])["embeddings"]
    norms = [round(sum(x * x for x in v) ** 0.5, 4) for v in vecs]
    comps = build_components(settings, index=ChromaChunkIndex(client, name, emb, configuration=cfg), embedder=emb,
                             provider=ExtractiveBaselineProvider())
    items = evaluate(comps, dataset, generate=False)
    lat = []
    for it in dataset["items"]:
        t = time.perf_counter(); emb.embed_query(it["question"]); lat.append((time.perf_counter() - t) * 1000)
    lat.sort()
    def block(sub):
        f = lambda m: m.as_dict()["value"]
        return {"n": len(sub), "n_in_scope": sum(1 for i in sub if i.in_scope), "R@1": f(recall_at(sub, 1)), "R@3": f(recall_at(sub, 3)),
                "R@5": f(recall_at(sub, 5)), "R@8(success)": f(retrieval_success(sub)), "MRR": f(mrr(sub))}
    by_lang = defaultdict(list); by_cat = defaultdict(list)
    for i in items:
        by_lang[lang[i.item_id]].append(i); by_cat[i.category].append(i)
    top1_in = [i.candidate_scores[0] for i in items if i.in_scope and i.candidate_scores]
    top1_out = {i.item_id: i.candidate_scores[0] for i in items if not i.in_scope and i.candidate_scores}
    def grank(i):
        return next((r for r, x in enumerate(i.candidate_ids, 1) if x in i.expected), None)
    out[cid] = {
        "model": c["model"], "config_revision": cfg.revision, "resolved_revision": resolved_revision(c["model"], None) if c["backend"] != "hashing" else None,
        "fingerprint": cfg.fingerprint(), "stamp": {k: v for k, v in col.metadata.items()}, "sample_vector_norms": norms,
        "overall": block(items), "by_language": {k: block(v) for k, v in sorted(by_lang.items())},
        "by_category": {k: block(v) for k, v in sorted(by_cat.items())},
        "multi_passage_all_in_context": multi_passage_recall(items).as_dict()["value"],
        "scope_leakage": scope_leakage(items).as_dict(),
        "top1_score_in_scope": {"min": round(min(top1_in), 4), "median": round(statistics.median(top1_in), 4)},
        "top1_score_out_of_scope": {k: round(v, 4) for k, v in top1_out.items()},
        "per_item": [{"id": i.item_id, "lang": lang[i.item_id], "cat": i.category, "gold_rank": grank(i), "expected": i.expected,
                      "top3": i.candidate_ids[:3], "top1_score": i.candidate_scores[0] if i.candidate_scores else None} for i in items],
        "latency_ms": {"load_s": round(load_s, 2), "p50": round(statistics.median(lat), 2), "p95": round(lat[int(0.95 * (len(lat) - 1))], 2)},
        "max_rss_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024),
    }
    print(cid, json.dumps(out[cid]["overall"]), json.dumps(out[cid]["by_language"]), flush=True)
Path(sys.argv[3]).write_text(json.dumps(out, ensure_ascii=False, indent=1))
