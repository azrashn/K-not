"""/explain adds board steps in a separate call; the written answer never changes because of it."""

import json

import pytest
from fastapi.testclient import TestClient

from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.generation.providers.base import LLMResponse, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider

TOKEN = "unified-test-token"
EVIDENCE = [{"id": "a" * 64, "text": "Water changes to vapour when heated.", "kind": "PDF", "location": {"kind": "page", "page": 1}}]
CLAIMS = '{"claims":[{"text":"Water changes to vapour.","sources":[1]}]}'
STEPS = json.dumps({
    "steps": [{"board": "Water → vapour", "speech": "Heated water changes to vapour.", "formula": "", "mark": "underline",
               "source_ids": [1], "quote": "changes to vapour"}],
    "summary": "Heated water becomes vapour.",
})


def run(monkeypatch, *replies, env=None):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-model")
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    queue, seen = list(replies), []

    def complete(self, request):
        seen.append(request)
        reply = queue.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return LLMResponse(text=reply)

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    app = create_app(build_components(Settings(internal_api_token=TOKEN, embedding_backend="hashing", chroma_mode="memory")))
    with TestClient(app) as c:
        r = c.post("/api/v1/knowledge/explain", headers={"Authorization": f"Bearer {TOKEN}"},
                   json={"question": "What happens to water?", "evidence": EVIDENCE})
    assert r.status_code == 200
    return r.json(), seen


def test_steps_come_from_a_second_call_with_real_source_ids(monkeypatch):
    body, seen = run(monkeypatch, CLAIMS, STEPS)
    assert body["status"] == "GENERATED_UNVERIFIED"
    assert body["answer"] == "Water changes to vapour. [1]"
    assert body["steps_status"] == "MODEL"
    assert body["steps"] == [{"board": "Water → vapour", "speech": "Heated water changes to vapour.", "formula": None,
                              "mark": "underline", "sources": ["a" * 64], "source_ids": [1], "quote": "changes to vapour"}]
    assert body["steps_summary"] == "Heated water becomes vapour."
    assert len(seen) == 2 and seen[1].timeout_seconds == 60
    assert seen[1].response_schema["properties"]["steps"]["items"]["required"][-2:] == ["source_ids", "quote"]


def test_broken_steps_are_repaired_once(monkeypatch):
    body, seen = run(monkeypatch, CLAIMS, "not json", STEPS)
    assert body["steps_status"] == "REPAIRED" and len(body["steps"]) == 1
    assert len(seen) == 3


@pytest.mark.parametrize("replies,status", [
    (("{}", "{}"), "INVALID"),
    ((ProviderError("timed out"),), "FAILED"),
    ((RuntimeError("unexpected"),), "FAILED"),
])
def test_failed_steps_leave_the_answer_unchanged(monkeypatch, replies, status):
    body, _ = run(monkeypatch, CLAIMS, *replies)
    assert body["status"] == "GENERATED_UNVERIFIED" and body["answer"] == "Water changes to vapour. [1]"
    assert body["steps"] == [] and body["steps_status"] == status


def test_steps_can_be_switched_off(monkeypatch):
    body, seen = run(monkeypatch, CLAIMS, env={"UNIFIED_STEPS_ENABLED": "false"})
    assert body["steps_status"] == "SKIPPED" and len(seen) == 1


def test_no_model_no_step_call(monkeypatch):
    monkeypatch.delenv("UNIFIED_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("UNIFIED_LLM_MODEL", raising=False)
    app = create_app(build_components(Settings(internal_api_token=TOKEN, embedding_backend="hashing", chroma_mode="memory")))
    with TestClient(app) as c:
        body = c.post("/api/v1/knowledge/explain", headers={"Authorization": f"Bearer {TOKEN}"},
                      json={"question": "What happens to water?", "evidence": EVIDENCE}).json()
    # The backend builds evidence steps for this case (no model was used).
    assert body["status"] == "SOURCE_EXCERPTS" and "steps" not in body
