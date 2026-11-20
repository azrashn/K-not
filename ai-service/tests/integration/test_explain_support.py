"""The explanation carries a per-claim source check next to the answer."""

import json

import pytest

from knot_rag.explanations import explain
from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.unified import Explain

EVIDENCE = [
    {"id": "a" * 64, "text": "Genişlik öncelikli arama bir kuyruk kullanır ve düğümleri seviye seviye ziyaret eder.", "kind": "PDF", "location": {"page": 1}},
    {"id": "b" * 64, "text": "Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışmaz.", "kind": "PDF", "location": {"page": 2}},
]


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")


def run(monkeypatch, claims):
    monkeypatch.setattr(OpenAICompatibleProvider, "complete",
                        lambda self, request: LLMResponse(text=json.dumps({"claims": claims, "clarification": ""})))
    return explain(Explain(question="BFS ve Dijkstra nedir?", evidence=EVIDENCE))


def test_every_claim_gets_a_support_check_and_a_summary(monkeypatch):
    result = run(monkeypatch, [
        {"text": "Genişlik öncelikli arama bir kuyruk kullanır.", "sources": [1]},
        {"text": "Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışır.", "sources": [2]},
    ])
    assert result["status"] == "GENERATED_UNVERIFIED"
    assert [c["support"]["label"] for c in result["claims"]] == ["SUPPORTED", "UNSUPPORTED"]
    assert result["claims"][1]["support"]["reason"] == "NEGATION_MISMATCH"
    assert result["support_summary"]["total"] == 2 and result["support_summary"]["verified"] is False
    # the check does not change the answer text or the cited numbers
    assert "[1]" in result["answer"] and "[2]" in result["answer"]
    assert [c["sources"] for c in result["claims"]] == [[1], [2]]


def test_a_check_never_turns_an_answer_into_a_verified_one(monkeypatch):
    result = run(monkeypatch, [{"text": "Genişlik öncelikli arama bir kuyruk kullanır.", "sources": [1]}])
    assert result["status"] == "GENERATED_UNVERIFIED"
    assert all(c["support"]["verified"] is False for c in result["claims"])
