"""The blind review can run on a different local model than the writer, and the result says so."""

import json

import pytest
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.quiz_quality import quiz
from knot_rag.unified import QuizDraft
from tests.integration.test_quiz_planning import TEXT, payloads


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.setattr("knot_rag.quiz_quality.review_feedback", lambda provider, draft, *args: draft)
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_LLM_MODEL", raising=False)
    monkeypatch.delenv("QUIZ_REVIEW_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_REVIEW_LLM_MODEL", raising=False)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "writer-model")


def run(monkeypatch):
    plan, draft, review = payloads()
    seen = []

    def complete(self, request):
        seen.append((self.model, request.system[:20]))
        data = plan if request.system.startswith("Plan one") else review if request.system.startswith("Independently solve") else draft
        return LLMResponse(text=json.dumps(data))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    body = QuizDraft(question="Queue removal ordering", kind="MULTIPLE_CHOICE", evidence=[{"text": TEXT}], language="en")
    return quiz(body), seen


def test_without_a_review_model_the_writer_reviews_and_the_result_says_it_is_not_separate(monkeypatch):
    result, seen = run(monkeypatch)
    assert {m for m, _ in seen} == {"writer-model"}
    assert result["quality"]["reviewer"] == "writer-model"
    assert result["quality"]["reviewer_is_separate_model"] is False


def test_a_configured_review_model_does_the_blind_review_only(monkeypatch):
    monkeypatch.setenv("QUIZ_REVIEW_LLM_MODEL", "reviewer-model")
    result, seen = run(monkeypatch)
    reviews = [m for m, system in seen if system.startswith("Independently solve")]
    writes = [m for m, system in seen if system.startswith("Write the question")]
    assert reviews == ["reviewer-model"] and writes == ["writer-model"]
    assert result["quality"]["reviewer"] == "reviewer-model"
    assert result["quality"]["reviewer_is_separate_model"] is True


def test_a_review_endpoint_must_be_local(monkeypatch):
    monkeypatch.setenv("QUIZ_REVIEW_LLM_BASE_URL", "https://api.example.com/v1")
    monkeypatch.setenv("QUIZ_REVIEW_LLM_MODEL", "x")
    with pytest.raises(HTTPException) as exc:
        run(monkeypatch)
    assert exc.value.status_code == 503


def test_a_review_url_without_a_model_is_refused(monkeypatch):
    monkeypatch.setenv("QUIZ_REVIEW_LLM_BASE_URL", "http://127.0.0.1:11437/v1")
    with pytest.raises(HTTPException) as exc:
        run(monkeypatch)
    assert exc.value.status_code == 503
