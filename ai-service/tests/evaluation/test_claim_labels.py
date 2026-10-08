"""Blind labelling sheet and claim-level metrics (no human labels exist yet; these tests use
synthetic labels only to check the arithmetic and the blindness of the sheet)."""

import json

import pytest

from knot_rag.config import Settings
from knot_rag.evaluation import claim_labels as cl
from knot_rag.evaluation.runner import offline_components
from tests.fakes import FIXTURES

pytestmark = pytest.mark.evaluation


@pytest.fixture(scope="module")
def exported():
    dataset = json.loads((FIXTURES / "eval_dataset_v2.json").read_text(encoding="utf-8"))
    dataset["items"] = [i for i in dataset["items"] if i["id"] in {"d01", "d03", "o01"}]
    s = Settings.from_env({"RAG_AUTH_DISABLED": "true", "EMBEDDING_BACKEND": "hashing", "LLM_PROVIDER": "extractive"})
    return cl.export_rows(offline_components(s, str(FIXTURES / "corpus_v2.json")), dataset)


def test_sheet_is_blind_and_complete(exported):
    sheet, key = exported
    text = json.dumps(sheet, ensure_ascii=False)
    for label in ("SIKI", "GEVEŞEK", "KOPUK", "support_label", "outcome"):
        assert label not in text
    claims = [r for r in sheet if r["kind"] == "claim"]
    assert claims and all(r["citations"] and r["citations"][0]["passage"] for r in claims)
    assert {(r["item_id"], r["claim_id"]) for r in claims} == {(k["item_id"], k["claim_id"]) for k in key if k["kind"] == "claim"}
    assert sheet[0]["kind"] == "header" and "outside knowledge" in sheet[0]["instructions"]


def test_unlabelled_sheet_reports_unmeasured_metrics(exported):
    m = cl.score(*exported)
    assert m["labelled_claims"] == 0 and m["unlabelled_claims"] > 0
    assert m["supported_claim_rate"]["value"] is None and m["system_vs_human"]["cohen_kappa"] is None


def _sheet():
    claim = lambda i, c, sup, cites: {"kind": "claim", "item_id": i, "claim_id": c, "human": {"support": sup, "citations_correct": cites}}
    sheet = [
        claim("a", "c1", "SUPPORTED", {"c1-1": True}),
        claim("a", "c2", "UNSUPPORTED", {"c2-1": False}),
        claim("b", "c1", "PARTIALLY_SUPPORTED", {"c1-1": True, "c1-2": None}),
        claim("b", "c2", "SUPPORTED", {"c2-1": True}),
        claim("c", "c1", None, {"c1-1": None}),
        claim("c", "c2", "maybe", {}),
        {"kind": "answer", "item_id": "a", "human": {"complete": True}},
        {"kind": "answer", "item_id": "b", "human": {"complete": False}},
    ]
    key = [
        {"kind": "claim", "item_id": "a", "claim_id": "c1", "support_label": "SIKI"},
        {"kind": "claim", "item_id": "a", "claim_id": "c2", "support_label": "SIKI"},  # wrong SIKI
        {"kind": "claim", "item_id": "b", "claim_id": "c1", "support_label": "GEVEŞEK"},
        {"kind": "claim", "item_id": "b", "claim_id": "c2", "support_label": "KOPUK"},  # overly strict
        {"kind": "claim", "item_id": "c", "claim_id": "c1", "support_label": "SIKI"},
    ]
    return sheet, key


def test_metric_arithmetic_with_denominators():
    m = cl.score(*_sheet())
    assert m["labelled_claims"] == 4 and m["unlabelled_claims"] == 1 and m["invalid_labels"] == 1
    assert m["supported_claim_rate"] == {"value": 0.5, "numerator": 2, "denominator": 4}
    assert m["unsupported_claim_rate"]["numerator"] == 1
    assert m["citation_precision"] == {"value": 0.75, "numerator": 3, "denominator": 4}
    assert m["incorrect_siki_rate"] == {"value": 0.5, "numerator": 1, "denominator": 2}
    assert m["overly_strict_rate"] == {"value": 0.5, "numerator": 1, "denominator": 2}
    assert m["answer_completeness"] == {"value": 0.5, "numerator": 1, "denominator": 2}
    assert m["system_vs_human"]["agreement"]["numerator"] == 2


def test_kappa():
    assert cl.cohen_kappa([("A", "A"), ("B", "B")], ["A", "B"]) == 1.0
    assert cl.cohen_kappa([], ["A"]) is None
    assert cl.cohen_kappa([("A", "A"), ("A", "B"), ("B", "A"), ("B", "B")], ["A", "B"]) == 0.0
