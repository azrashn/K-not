"""Regression tests with model doubles; real Ollama checks are reported separately."""

import json

import pytest
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMResponse, ProviderTimeoutError, ProviderResponseError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.quiz_quality import bind_excerpt, quiz, source_excerpts
from knot_rag.structured import quiz_schema
from knot_rag.unified import QuizDraft


TEXT = "A queue removes elements in first-in-first-out order. A stack uses last-in-first-out order."


def draft(quote_id="q1"):
    return {
        "question": "Which structure removes the earliest added element first?",
        "objective": "Distinguish element removal ordering.",
        "options": ["queue", "stack", "heap", "tree"],
        "expected": "0",
        "quote_id": quote_id,
        "explanation": "A queue removes elements in the order they were added.",
        "option_feedback": ["Source-based feedback for this particular option."] * 4,
    }


def review(correct=(0,)):
    return {
        "expected": "0",
        **{key: True for key in (
            "clear", "topic_related", "answer_supported", "single_correct", "distractors_valid"
        )},
        "option_judgments": [
            {"index": i, "correct": i in correct, "reason": "Independent evaluation of this option."}
            for i in range(4)
        ],
    }


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.setattr('knot_rag.quiz_quality.completion_plan', lambda *args: None)
    # This suite isolates source binding and blind answer checks.
    monkeypatch.setattr('knot_rag.quiz_quality.review_feedback', lambda provider,draft,*args: draft)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")
    # These existing regressions isolate citation binding/review. The complete
    # planner + writer contract is exercised in test_quiz_planning.py.
    monkeypatch.setattr("knot_rag.quiz_quality.plan_question", lambda *args: {
        "quote_id": "q1", "answer_phrase": "queue", "objective": "Distinguish ordering behavior."
    })


def body():
    return QuizDraft(question="Storage order", kind="MULTIPLE_CHOICE", evidence=[{"text": TEXT}])


def test_exact_multilingual_excerpt_keeps_original_source_position():
    text = "Kuyruk: ilk giren ilk çıkar.\nAğırlık = 3,5; O(V + E)."
    excerpts = source_excerpts([{"text": ""}, {"text": text}])
    bound = bind_excerpt(draft(), excerpts)
    assert bound["quote"] == text
    assert bound["source_index"] == 2
    assert "quote_id" not in bound


@pytest.mark.parametrize("changed", [
    {"quote_id": "invented"}, {"quote_id": []},
    {"quote": "Translated or changed facts"}, {"source_index": 4},
])
def test_model_cannot_replace_or_invent_the_citation(changed):
    with pytest.raises(ValueError):
        bind_excerpt({**draft(), **changed}, source_excerpts([{"text": TEXT}]))


def test_long_excerpts_are_bounded_exact_substrings_without_losing_formula():
    text = ("Explanation with whitespace.\n" * 65) + "Distance is 3, not 30."
    excerpts = source_excerpts([{"text": text}])
    assert len(excerpts) <= 3
    assert all(8 <= len(e["quote"]) <= 1200 and e["quote"] in text for e in excerpts.values())
    assert any("Distance is 3, not 30." in e["quote"] for e in excerpts.values())
    schema = quiz_schema("MULTIPLE_CHOICE", 1, excerpts)
    assert schema["properties"]["quote_id"]["enum"] == list(excerpts)
    assert "quote" not in schema["properties"]
    assert "source_index" not in schema["properties"]


def test_invalid_selection_is_repaired_then_blindly_reviewed(monkeypatch):
    requests = []
    responses = iter([draft("unknown"), draft(), review()])

    def complete(self, request):
        requests.append(request)
        return LLMResponse(text=json.dumps(next(responses)))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    result = quiz(body())
    assert result["quote"] == TEXT and result["source_index"] == 1
    assert result["quality"]["independent_model_review"] is True
    assert result["quality"]["truth_verified"] is False
    assert len(requests) == 3
    assert "Unknown source excerpt" in requests[1].user
    audit = json.loads(requests[-1].user)
    assert audit["source"] == result["quote"]
    assert audit["options"] == [{"index": i, "text": text} for i, text in enumerate(result["options"])]
    assert "expected" not in audit and "explanation" not in audit


def test_second_attempt_cannot_bypass_ambiguous_option_rejection(monkeypatch):
    calls = []

    def complete(self, request):
        calls.append(request)
        return LLMResponse(text=json.dumps(
            review(correct=(0, 1)) if request.system.startswith("Independently solve") else draft()
        ))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    with pytest.raises(HTTPException) as error:
        quiz(body())
    assert error.value.status_code == 422
    assert len(calls) == 6


def test_provider_failure_is_not_misreported_as_question_quality(monkeypatch):
    calls = []

    def complete(self, request):
        calls.append(request)
        raise ProviderTimeoutError("provider timed out")

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    with pytest.raises(HTTPException) as error:
        quiz(body())
    assert error.value.status_code == 503
    assert len(calls) == 1


def test_truncated_model_output_is_repaired_without_publishing_partial_text(monkeypatch):
    responses = iter([None, draft(), review()])

    def complete(self, request):
        value = next(responses)
        if value is None:
            raise ProviderResponseError("provider output truncated (max tokens)")
        return LLMResponse(text=json.dumps(value))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    assert quiz(body())["quote"] == TEXT
