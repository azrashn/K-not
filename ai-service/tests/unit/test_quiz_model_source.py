"""Which model writes quiz questions: QUIZ_LLM_*, then UNIFIED_LLM_*, then the answer model (LLM_*)."""

import logging

import pytest
from fastapi import HTTPException

from knot_rag import quiz_checks as qc
from knot_rag import quiz_engine as qe
from knot_rag import quiz_quality

NAMES = ("QUIZ_LLM_BASE_URL", "QUIZ_LLM_MODEL", "UNIFIED_LLM_BASE_URL", "UNIFIED_LLM_MODEL",
         "LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY")


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in NAMES:
        monkeypatch.delenv(name, raising=False)


def answer_model(monkeypatch, provider="openai_compatible", url="http://localhost:11434/v1", model="qwen2.5:7b-instruct", key="sk-local"):
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.setenv("LLM_BASE_URL", url)
    monkeypatch.setenv("LLM_MODEL", model)
    monkeypatch.setenv("LLM_API_KEY", key)


def startup_line(caplog):
    with caplog.at_level(logging.INFO, logger="knot_rag.quiz_engine"):
        qe.log_model_settings()
    return caplog.records[-1].getMessage()


def test_openai_compatible_answer_model_is_used_when_quiz_and_unified_are_empty(monkeypatch, caplog):
    answer_model(monkeypatch)
    m = qe.quiz_model()
    assert (m.url, m.model, m.api_key, m.source, m.note) == (
        "http://localhost:11434/v1", "qwen2.5:7b-instruct", "sk-local", "LLM", "")
    assert qe.model_settings() == ("http://localhost:11434/v1", "qwen2.5:7b-instruct")
    line = startup_line(caplog)
    assert "configured=true source=LLM model=qwen2.5:7b-instruct base_url=http://localhost:11434/v1 local=True" in line
    assert "sk-local" not in line


def test_provider_name_is_case_and_space_tolerant(monkeypatch):
    answer_model(monkeypatch, provider="  OpenAI_Compatible ")
    assert qe.quiz_model().source == "LLM" and qe.quiz_model().configured


@pytest.mark.parametrize("unified", [True, False])
def test_quiz_or_unified_settings_still_win_over_the_answer_model(monkeypatch, unified):
    answer_model(monkeypatch)
    prefix = "UNIFIED_LLM" if unified else "QUIZ_LLM"
    monkeypatch.setenv(f"{prefix}_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv(f"{prefix}_MODEL", "small")
    m = qe.quiz_model()
    assert (m.url, m.model, m.source, m.api_key) == ("http://127.0.0.1:11436/v1", "small", prefix, "")


@pytest.mark.parametrize("provider", ["extractive", "mock", ""])
def test_extractive_or_missing_provider_is_not_configured_with_the_fix_in_the_note(monkeypatch, caplog, provider):
    answer_model(monkeypatch, provider=provider)
    if not provider:
        monkeypatch.delenv("LLM_PROVIDER")
    m = qe.quiz_model()
    assert not m.configured and m.note == qe.QUIZ_MODEL_NOT_CONFIGURED
    assert m.note == "ai-service/.env içinde LLM_PROVIDER=openai_compatible ve model ayarı gerekli"
    line = startup_line(caplog)
    assert "configured=false" in line and qe.QUIZ_MODEL_NOT_CONFIGURED in line


def test_openai_compatible_without_a_model_is_not_configured(monkeypatch):
    answer_model(monkeypatch, model="")
    m = qe.quiz_model()
    assert not m.configured and m.source == "LLM" and m.note == qe.QUIZ_MODEL_NOT_CONFIGURED


def test_v2_route_503_carries_the_note(monkeypatch):
    answer_model(monkeypatch, provider="extractive")
    with pytest.raises(HTTPException) as err:
        qe.quiz_v2(None)  # refused before the request is read
    assert err.value.status_code == 503 and err.value.detail["code"] == qc.MODEL_UNREACHABLE
    assert err.value.detail["message"] == f"Local quiz model is not configured: {qe.QUIZ_MODEL_NOT_CONFIGURED}"


def test_a_remote_answer_model_is_still_refused_for_quizzes(monkeypatch):
    answer_model(monkeypatch, url="https://api.example.com/v1")
    with pytest.raises(HTTPException) as err:
        qe.quiz_v2(None)
    assert "not local (https://api.example.com/v1)" in err.value.detail["message"]


def test_v2_passes_the_answer_model_key_to_the_provider(monkeypatch):
    answer_model(monkeypatch)
    seen = {}

    def fake_generate(req, provider):
        seen["key"], seen["model"] = provider._api_key, provider._model
        return {"ok": True}

    monkeypatch.setattr(qe, "generate", fake_generate)
    assert qe.quiz_v2(object()) == {"ok": True}
    assert seen == {"key": "sk-local", "model": "qwen2.5:7b-instruct"}


def test_legacy_quiz_uses_the_same_choice_and_note(monkeypatch):
    answer_model(monkeypatch, provider="extractive")
    with pytest.raises(HTTPException) as err:
        quiz_quality.quiz(None)
    assert err.value.status_code == 503 and qe.QUIZ_MODEL_NOT_CONFIGURED in err.value.detail
