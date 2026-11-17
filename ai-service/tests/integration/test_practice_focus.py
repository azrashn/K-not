"""Practice-set controls: focus, difficulty and repeat avoidance reach the writer and planner."""

import copy
import json

import pytest
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.quiz_focus import FOCUSES, focus_instruction, looks_like_code
from knot_rag.quiz_planning import is_repeat_of
from knot_rag.quiz_quality import quiz
from knot_rag.unified import QuizDraft

TEXT = (
    "A queue removes items in first-in-first-out order. "
    "A stack removes the last added item first. "
    "Heaps keep the largest value at the root."
)
FIFO = "A queue removes items in first-in-first-out order."


def payloads(fact_id="q1.s2"):
    plan = {"topic_supported": True, "fact_id": fact_id, "objective": "Distinguish removal ordering."}
    draft = {
        "quote_id": "q1", "question": "Which structure removes the last added item first?",
        "objective": plan["objective"], "options": {"A": "queue", "B": "stack", "C": "heap", "D": "tree"},
        "expected": "B", "explanation": "The source says a stack removes the last added item first.",
        "option_feedback": {key: "Rationale for option " + key + " in the source." for key in "ABCD"},
    }
    review = {"expected": "1", "clear": True, "topic_related": True, "answer_supported": True,
              "single_correct": True, "distractors_valid": True,
              "option_judgments": [{"index": i, "correct": i == 1, "reason": "The cited passage supports this assessment."} for i in range(4)]}
    return plan, draft, review


@pytest.fixture(autouse=True)
def local(monkeypatch):
    monkeypatch.setattr("knot_rag.quiz_quality.review_feedback", lambda provider, draft, *args: draft)
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_LLM_MODEL", raising=False)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")


def run(monkeypatch, text=TEXT, focus=None, difficulty=None, avoid_focus=(), avoid_questions=(), change=None):
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
    body = QuizDraft(
        question="Removal order in queues and stacks", kind="MULTIPLE_CHOICE", evidence=[{"text": text}],
        language="en", focus=focus, difficulty=difficulty,
        avoid_focus_texts=list(avoid_focus), avoid_questions=list(avoid_questions),
    )
    return quiz(body), seen


def test_focus_and_difficulty_are_in_the_writer_instructions(monkeypatch):
    result, seen = run(monkeypatch, focus="application", difficulty="hard")
    writer = next(r for r in seen if r.system.startswith("Write the question"))
    assert "Difficulty HARD" in writer.system
    assert "Question focus (application)" in writer.system
    assert result["focus"] == "application"
    assert result["difficulty"] == "hard"
    assert result["quality"]["pipeline_version"] == "source-fact-feedback-v2"


def test_no_focus_keeps_the_previous_writer_contract(monkeypatch):
    result, seen = run(monkeypatch)
    writer = next(r for r in seen if r.system.startswith("Write the question"))
    assert "Question focus" not in writer.system
    assert result["focus"] is None and result["difficulty"] is None


def test_non_definition_focus_never_uses_source_recall_completion(monkeypatch):
    # Every writer attempt returns an invalid answer index, so the loop retries and would reach
    # the recall-completion step on attempt 2 if it were allowed for this focus.
    plan, draft, review = copy.deepcopy(payloads())
    seen = []

    def complete(self, request):
        seen.append(request)
        if request.system.startswith("Plan one"):
            # Pick whichever fact the planner still offers, as a real model would.
            offered = json.loads(request.user)["facts"][0]["fact_id"]
            return LLMResponse(text=json.dumps({**plan, "fact_id": offered}))
        if request.system.startswith("Independently solve"):
            return LLMResponse(text=json.dumps(review))
        if request.system.startswith("Select ONE meaningful") or request.system.startswith("Create THREE"):
            raise AssertionError("recall completion must not run for focus=relation")
        return LLMResponse(text=json.dumps({**draft, "expected": "Z"}))

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    body = QuizDraft(question="q", kind="MULTIPLE_CHOICE", evidence=[{"text": TEXT}], language="en", focus="relation")
    with pytest.raises(HTTPException):
        quiz(body)
    writers = [r for r in seen if r.system.startswith("Write the question")]
    assert len(writers) == 3


def test_facts_already_taught_by_the_set_are_not_offered_to_the_planner(monkeypatch):
    result, seen = run(monkeypatch, avoid_focus=[FIFO], focus="definition",
                       change=lambda p, d, r: p.update(fact_id="q1.s2"))
    planner = json.loads(next(r for r in seen if r.system.startswith("Plan one")).user)
    texts = [fact["text"] for fact in planner["facts"]]
    assert FIFO not in texts
    assert all("first-in-first-out" not in t for t in texts)
    assert result["focus_text"] == "A stack removes the last added item first."


def test_avoided_questions_are_listed_for_the_writer(monkeypatch):
    _, seen = run(monkeypatch, avoid_questions=["Which structure removes the earliest added item first?"])
    writer = json.loads(next(r for r in seen if r.system.startswith("Write the question")).user)
    assert writer["already_asked"] == ["Which structure removes the earliest added item first?"]


def test_code_output_is_refused_when_the_sources_have_no_code(monkeypatch):
    with pytest.raises(HTTPException) as error:
        run(monkeypatch, focus="code_output")[0]()
    assert error.value.status_code == 422


def test_code_output_runs_when_the_source_shows_code(monkeypatch):
    code = "for (int i = 0; i < 3; i++) {\n  sum += i;\n}\nreturn sum;\n"
    result, _ = run(monkeypatch, text=code, focus="code_output", difficulty="hard")
    assert result["focus"] == "code_output"


def test_focus_names_are_a_closed_set():
    assert set(FOCUSES) == {"definition", "relation", "difference", "application", "scenario", "code_output"}
    assert focus_instruction(None, None) == ""
    assert focus_instruction("nonsense", "nonsense") == ""
    assert "Difficulty EASY" in focus_instruction(None, "easy")


def test_repeat_detection_uses_shared_content_words():
    assert is_repeat_of("Queue removes items in first in first out order.", [FIFO])
    assert not is_repeat_of("Heaps keep the largest value at the root.", [FIFO])
    assert not is_repeat_of("...", [FIFO])


def test_code_detection_needs_several_code_markers():
    assert looks_like_code("int main() {\n  return 0;\n}\nif (x) {\n  y();\n}")
    assert not looks_like_code("A queue removes items in first-in-first-out order.")
