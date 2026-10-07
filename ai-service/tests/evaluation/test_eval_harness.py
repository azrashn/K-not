"""Runs the labelled evaluation set end-to-end on a real in-memory Chroma with the offline
hashing embedder. Asserts safety invariants strictly; retrieval quality only as a regression
floor for this baseline (the production multilingual model must be measured separately)."""

import json

import pytest

from knot_rag.bootstrap import build_components
from knot_rag.evaluation.metrics import summarize
from knot_rag.evaluation.runner import evaluate
from knot_rag.generation.providers import ExtractiveBaselineProvider
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from tests.fakes import FIXTURES

pytestmark = pytest.mark.evaluation


@pytest.fixture
def results(settings, embedder, corpus, chroma_client, collection_name):
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    comps = build_components(settings, index=ChromaChunkIndex(chroma_client, collection_name, embedder),
                             embedder=embedder, provider=ExtractiveBaselineProvider())
    dataset = json.loads((FIXTURES / "eval_dataset.json").read_text(encoding="utf-8"))
    return evaluate(comps, dataset)


def test_no_scope_leakage_and_no_private_or_foreign_documents(results):
    m = summarize(results)
    assert m["scope_leakage"]["numerator"] == 0
    forbidden = ("doc-vy-notlar-mehmet", "doc-os-hafta5", "doc-vy-zararli")
    for r in results:
        assert not any(c.startswith(forbidden) for c in r.candidate_ids + r.cited_chunk_ids), r.item_id


def test_citations_always_resolve(results):
    assert summarize(results)["citation_integrity"]["value"] == 1.0


def test_hashing_baseline_retrieval_regression_floor(results):
    # Measured 22/23 when this test was written; floor leaves room for corpus edits.
    assert summarize(results)["retrieval_success"]["value"] >= 0.75
