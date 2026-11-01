"""The comparison harness must produce identical quality numbers on repeated runs and must
report unavailable models as BLOCKED instead of producing numbers."""

import json

import pytest

from knot_rag.config import Settings
from knot_rag.evaluation.compare_embeddings import compare, markdown
from tests.fakes import FIXTURES

pytestmark = pytest.mark.evaluation

CANDS = [
    {"id": "hash-512", "backend": "hashing", "model": "h", "dimension": 512},
    {"id": "hash-128", "backend": "hashing", "model": "h", "dimension": 128},
    {"id": "unavailable", "backend": "sentence_transformers", "model": "knot-test/does-not-exist", "revision": "main"},
]


@pytest.fixture(scope="module")
def inputs():
    from knot_rag.schemas import IndexedChunk

    chunks = [IndexedChunk.model_validate(c) for c in json.loads((FIXTURES / "corpus_v2.json").read_text(encoding="utf-8"))["chunks"]]
    dataset = json.loads((FIXTURES / "eval_dataset_v2.json").read_text(encoding="utf-8"))
    return chunks, dataset, Settings(auth_disabled=True, chroma_mode="memory")


def test_quality_metrics_are_deterministic(inputs):
    a = compare(CANDS[:1], *inputs)["results"][0]["quality"]
    b = compare(CANDS[:1], *inputs)["results"][0]["quality"]
    assert a == b
    assert a["scope_leakage"]["numerator"] == 0
    assert set(a["by_split"]) == {"calibration", "held_out"}


def test_unavailable_model_is_blocked_without_numbers(inputs):
    report = compare(CANDS, *inputs)
    blocked = report["results"][2]
    assert blocked["status"] == "BLOCKED" and "quality" not in blocked and blocked["reason"]
    assert [r["status"] for r in report["results"][:2]] == ["OK", "OK"]
    assert report["results"][0]["dimension"] == 512 and report["results"][1]["dimension"] == 128
    assert "BLOCKED" in markdown(report)
