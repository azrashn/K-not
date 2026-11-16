"""An exam-style hint shapes the question writer's prompt only; the source-bound checks still apply."""

import json

from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.quiz_quality import quiz
from knot_rag.unified import QuizDraft
from tests.integration.test_quiz_planning import TEXT, payloads

HINT = "Sınav stili (yalnız üslup ve biçim için): 4 soru; çoktan seçmeli 4."


def run_with(monkeypatch, style_hint):
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")
    monkeypatch.setattr("knot_rag.quiz_quality.review_feedback", lambda provider, draft, *args: draft)
    plan, draft, review = payloads()
    seen = []

    def complete(self, request):
        seen.append(request)
        data = plan if request.system.startswith("Plan one") else review if request.system.startswith("Independently solve") else draft
        return LLMResponse(text=json.dumps(data))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    body = QuizDraft(question="Queue removal ordering", kind="MULTIPLE_CHOICE",
                     evidence=[{"text": TEXT}], language="en", style_hint=style_hint)
    return quiz(body), seen


def test_writer_prompt_carries_the_style_hint(monkeypatch):
    result, seen = run_with(monkeypatch, HINT)
    writer = [r for r in seen if r.system.startswith("Write the question")]
    assert writer and HINT in writer[0].system
    assert result["quote"] in TEXT and result["source_index"] == 1


def test_without_a_hint_the_writer_prompt_is_unchanged(monkeypatch):
    _, seen = run_with(monkeypatch, None)
    writer = [r for r in seen if r.system.startswith("Write the question")]
    assert writer and "Sınav stili" not in writer[0].system


def test_hint_is_rejected_when_too_long(monkeypatch):
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        QuizDraft(question="x" * 10, kind="TRUE_FALSE", evidence=[{"text": TEXT}], style_hint="a" * 1300)
