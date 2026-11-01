"""Validation regressions use model doubles. Real vision is separately tested locally."""

import base64, io, json
import pytest, httpx
from PIL import Image
from fastapi import HTTPException
from knot_rag.unified import Explain
from knot_rag.explanations import explain
from knot_rag.quiz_quality import validate_draft
from knot_rag.visual_context import prepare_image
from knot_rag.generation.providers.base import LLMRequest, LLMResponse, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider


def test_quiz_rejects_two_correct_options_even_if_global_flags_agree(monkeypatch):
    from knot_rag.quiz_quality import quiz
    from knot_rag.unified import QuizDraft

    draft = {
        "question": "Which structure stores pending elements?",
        "objective": "Identify a suitable storage structure.",
        "options": ["queue", "stack", "array", "tree"],
        "expected": "0",
        "quote": "A queue stores pending elements.",
        "source_index": 1,
        "explanation": "The source describes how pending elements are stored.",
        "option_feedback": ["Source-grounded option explanation."] * 4,
    }
    check = {
        "expected": "0",
        **{
            k: True
            for k in [
                "clear",
                "topic_related",
                "answer_supported",
                "single_correct",
                "distractors_valid",
            ]
        },
        "option_judgments": [
            {
                "index": i,
                "correct": i < 2,
                "reason": "This is the independent option evaluation.",
            }
            for i in range(4)
        ],
    }
    monkeypatch.setattr(
        OpenAICompatibleProvider,
        "complete",
        lambda self, request: LLMResponse(
            text=json.dumps(
                check if request.system.startswith("Independently solve") else draft
            )
        ),
    )
    with pytest.raises(HTTPException) as error:
        quiz(
            QuizDraft(
                question="Storage structures",
                kind="MULTIPLE_CHOICE",
                evidence=[{"text": draft["quote"]}],
            )
        )
    assert error.value.status_code == 422


def png():
    b = io.BytesIO()
    Image.new("RGB", (100, 60), "white").save(b, format="PNG")
    return base64.b64encode(b.getvalue()).decode()


def body(**kw):
    return Explain(
        question="Explain the visible example",
        evidence=[
            {
                "id": "a" * 64,
                "text": "Water evaporates when heated.",
                "kind": "PDF",
                "location": {"page": 4},
            }
        ],
        **kw,
    )


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")


def test_original_pixels_and_crop_reach_local_vision_transport():
    data, meta = prepare_image(
        png(), {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}
    )
    assert (meta["width"], meta["height"]) == (50, 30)
    seen = []

    def transport(r):
        seen.append(json.loads(r.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": '{"claims":[]}'}, "finish_reason": "stop"}
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(transport)) as c:
        OpenAICompatibleProvider(
            "http://127.0.0.1:11436/v1", "test", client=c
        ).complete(LLMRequest(system="s", user="u", images=(data,)))
    assert seen[0]["messages"][1]["content"][1]["image_url"]["url"] == data
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider("http://127.0.0.1:11436/v1", "test").complete(
            LLMRequest(system="s", user="u", images=("https://untrusted/image.png",))
        )


def test_bad_image_or_region_is_rejected_before_generation():
    with pytest.raises(HTTPException):
        prepare_image("not base64")
    with pytest.raises(HTTPException):
        prepare_image(png(), {"x": 0.9, "y": 0, "width": 0.5, "height": 1})


def test_incomplete_visual_reconstruction_cannot_publish_a_confident_sequence(
    monkeypatch,
):
    monkeypatch.setattr(
        OpenAICompatibleProvider,
        "complete",
        lambda *a: LLMResponse(
            text=json.dumps(
                {"claims": [{"text": "An invented traversal order", "sources": [1]}]}
            )
        ),
    )
    r = explain(body(image_base64=png(), image_source_id="a" * 64))
    assert r["status"] == "CLARIFICATION"
    assert "invented" not in r["answer"]
    assert r["claims"] == []


def test_visual_second_pass_rejection_is_honored(monkeypatch):
    def complete(self, request):
        return LLMResponse(
            text=json.dumps(
                {
                    "all_parts_answered": False,
                    "relations_supported": False,
                    "missing_conditions": ["start condition"],
                }
                if request.system.startswith("Audit")
                else {
                    "claims": [{"text": "An ambiguous result", "sources": [1]}],
                    "visual_observation": {
                        "observations": ["Visible labels X,Y"],
                        "uncertainties": [],
                        "needs_clarification": False,
                    },
                }
            )
        )

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    assert (
        explain(body(image_base64=png(), image_source_id="a" * 64))["visual_analysis"][
            "quality_gate"
        ]
        == "MODEL_AUDIT_REJECTED"
    )


@pytest.mark.parametrize("mode", ["short", "detailed", "step_by_step", "example"])
def test_response_mode_changes_the_actual_generation_contract(monkeypatch, mode):
    seen = []

    def complete(self, request):
        seen.append(request)
        n = 3 if mode in ("detailed", "step_by_step") else 2 if mode == "example" else 1
        return LLMResponse(
            text=json.dumps(
                {
                    "claims": [
                        {
                            "text": f"A different grounded explanation step {i+1}.",
                            "sources": [1],
                        }
                        for i in range(n)
                    ]
                }
            )
        )

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    r = explain(body(response_mode=mode, conversation_context="Previous explanation."))
    assert json.loads(seen[0].user)["response_mode"] == mode
    assert r["answer"] != "Previous explanation."
    if mode == "step_by_step":
        assert r["answer"].startswith("1. ")


def test_short_mode_does_not_silently_repeat_the_prior_answer(monkeypatch):
    monkeypatch.setattr(
        OpenAICompatibleProvider,
        "complete",
        lambda *a: LLMResponse(
            text='{"claims":[{"text":"Same explanation.","sources":[1]}]}'
        ),
    )
    assert (
        explain(
            body(response_mode="short", conversation_context="Same explanation. [1]")
        )["status"]
        == "MODE_NOT_SATISFIED"
    )


def test_short_mode_only_keeps_complete_generated_sentences(monkeypatch):
    first = "Substitution expresses the integral using a new variable."
    monkeypatch.setattr(
        OpenAICompatibleProvider,
        "complete",
        lambda *a: LLMResponse(
            text=json.dumps(
                {
                    "claims": [
                        {
                            "text": first + " " + "Additional detail " * 80 + ".",
                            "sources": [1],
                        }
                    ]
                }
            )
        ),
    )
    result = explain(body(response_mode="short"))
    assert result["status"] == "GENERATED_UNVERIFIED"
    assert result["answer"] == first + " [1]"


def test_mcq_rejects_duplicate_ambiguous_and_answer_leaking_options():
    d = {
        "question": "Which structure is used for storage?",
        "objective": "Identify the appropriate data structure.",
        "options": ["queue", "stack", "array", "tree"],
        "expected": "0",
        "quote": "A queue stores pending elements.",
        "source_index": 1,
        "explanation": "The source explains the storage mechanism.",
        "option_feedback": ["Reason supported by source."] * 4,
    }
    validate_draft(d, "MULTIPLE_CHOICE", [{"text": d["quote"]}])
    for changed in [
        {"options": ["queue", "QUEUE", "array", "tree"]},
        {"options": ["queue", "queue structure", "array", "tree"]},
        {"quote": "A fabricated quote."},
        {"objective": "Learn why queue is the correct answer."},
    ]:
        with pytest.raises(ValueError):
            validate_draft({**d, **changed}, "MULTIPLE_CHOICE", [{"text": d["quote"]}])


def test_quote_whitespace_is_canonicalized_to_actual_source_without_changing_facts():
    d = {
        "question": "Which structure stores pending elements?",
        "objective": "Identify a suitable storage structure.",
        "options": ["queue", "stack", "array", "tree"],
        "expected": "0",
        "quote": "A queue stores pending elements.",
        "source_index": 1,
        "explanation": "The source explains pending storage.",
        "option_feedback": ["Grounded option explanation."] * 4,
    }
    source = "A queue\n stores pending elements."
    assert validate_draft(d, "MULTIPLE_CHOICE", [{"text": source}])["quote"] == source


def test_overlapping_video_repeat_keeps_original_citation_bounds():
    from knot_rag.unified import duplicate_evidence

    a = {
        "material_id": "video-a",
        "kind": "VIDEO",
        "text": "Variable substitution integration differentiable function differential integrand constant antiderivative chain verification worked example.",
        "location": {"start_ms": 10000, "end_ms": 20000},
    }
    b = {
        **a,
        "text": a["text"] + " Reasoning.",
        "location": {"start_ms": 13000, "end_ms": 22000},
    }
    assert duplicate_evidence(a, b)
    assert not duplicate_evidence(
        a, {**b, "location": {"start_ms": 100000, "end_ms": 109000}}
    )
    assert a["location"] == {"start_ms": 10000, "end_ms": 20000}
