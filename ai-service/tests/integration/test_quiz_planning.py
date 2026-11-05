"""Model doubles for the full planned, source-bound question contract."""

import copy
import json

import pytest
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.quiz_payload import normalize_choice_payload, parse_quiz_payload
from knot_rag.quiz_quality import quiz
from knot_rag.unified import QuizDraft

TEXT = "A queue removes items in first-in-first-out order. A stack removes the last added item first."


def payloads():
    plan = {"topic_supported": True, "quote_id": "q1", "objective": "Distinguish removal ordering.", "answer_phrase": "queue"}
    draft = {
        "quote_id": "q1", "question": "Which structure removes the earliest added item first?",
        "objective": plan["objective"], "options": {"D": "tree", "B": "stack", "A": "queue", "C": "heap"},
        "expected": "A", "explanation": "The source describes first-in-first-out behavior.",
        "option_feedback": {key: "This is the independent rationale for option " + key for key in "ABCD"},
    }
    review = {"expected": "0", "clear": True, "topic_related": True, "answer_supported": True,
              "single_correct": True, "distractors_valid": True,
              "option_judgments": [{"index": i, "correct": i == 0, "reason": "The cited passage supports this assessment."} for i in range(4)]}
    return plan, draft, review


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_LLM_MODEL", raising=False)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")


def run(monkeypatch, change=None):
    plan, draft, review = copy.deepcopy(payloads())
    if change:
        change(plan, draft, review)
    seen = []

    def complete(self, request):
        seen.append(request)
        data = (plan if request.system.startswith("Plan one") else
                review if request.system.startswith("Independently solve") else draft)
        return LLMResponse(text=json.dumps(data))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    body = QuizDraft(question="Queue removal ordering", kind="MULTIPLE_CHOICE", evidence=[{"text": TEXT}], language="en")
    return lambda: quiz(body), seen


def test_planned_question_named_answers_and_feedback_remain_aligned(monkeypatch):
    generate, seen = run(monkeypatch)
    result = generate()
    assert len(seen) == 3
    assert result["options"] == ["queue", "stack", "heap", "tree"]
    assert result["expected"] == "0"
    assert result["option_feedback"][0].endswith("A")
    assert result["quote"] == TEXT
    assert result["quality"]["pipeline_version"] == "source-plan-named-choices-v1"
    assert result["quality"]["truth_verified"] is False
    writer = json.loads(seen[1].user)
    assert writer["plan"]["answer_phrase"] == "queue"
    review = json.loads(seen[2].user)
    assert "expected" not in review and "plan" not in review


def test_unsupported_topic_abstains_before_writing_a_question(monkeypatch):
    generate, seen = run(monkeypatch, lambda p, d, r: p.update(topic_supported=False, answer_phrase=""))
    with pytest.raises(HTTPException) as error:
        generate()
    assert error.value.status_code == 422
    assert error.value.detail["code"] == "QUIZ_TOPIC_NOT_FOUND"
    assert len(seen) == 1


@pytest.mark.parametrize("change", [
    lambda p, d, r: p.update(answer_phrase="An invented answer"),
    lambda p, d, r: d.update(expected="B"),
    lambda p, d, r: d["options"].update(B="queue"),
    lambda p, d, r: r["option_judgments"][1].update(correct=True),
    lambda p, d, r: d.update(quote_id="invented"),
])
def test_source_plan_does_not_bypass_existing_rejection_gates(monkeypatch, change):
    generate, _ = run(monkeypatch, change)
    with pytest.raises(HTTPException) as error:
        generate()
    assert error.value.status_code == 422


def test_upstream_parser_handles_fenced_json_without_evaluating_code():
    assert parse_quiz_payload('```json\n{"question":"Example?"}\n```') == {"question": "Example?"}
    assert parse_quiz_payload('prefix {"question":"Example?"} trailing prose') == {"question": "Example?"}
    assert parse_quiz_payload('__import__("os").system("echo nope")') == {}


def test_named_keys_are_not_silently_truncated_or_reordered():
    _, draft, _ = payloads()
    draft["options"]["Alternative"] = draft["options"].pop("A")
    with pytest.raises(ValueError):
        normalize_choice_payload(draft)
