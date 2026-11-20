"""The acceptance measurement itself: data is valid and the report counts what it should."""

import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException

SPEC = importlib.util.spec_from_file_location("quiz_acceptance", Path(__file__).resolve().parents[2] / "evaluation" / "quiz_acceptance.py")
qa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qa)


def test_the_labelled_set_is_valid_and_every_topic_is_stated_in_its_source():
    cases = qa.load_cases()
    assert len(cases) >= 10
    for c in cases:
        assert c["kind"] in qa.KINDS
        assert len(c["text"]) > 40


def test_accepted_rejected_and_unavailable_are_counted_apart():
    cases = [{"id": f"c{i}", "kind": "MULTIPLE_CHOICE", "topic": "t", "text": "Kaynak metin burada geçer."} for i in range(4)]
    replies = iter([
        {"question": "Q?", "quote": "Kaynak metin"},
        HTTPException(422, "Quiz failed source/clarity/answer/distractor quality validation"),
        HTTPException(503, "Local quiz model unavailable"),
        {"question": "Q?", "quote": "uydurma alıntı"},
    ])

    def run(case, language):
        r = next(replies)
        if isinstance(r, Exception):
            raise r
        return r

    report = qa.evaluate(cases, run)
    assert (report["accepted"], report["rejected"], report["unavailable"]) == (1, 2, 1)
    assert report["accept_rate"] == 0.33
    assert [r["outcome"] for r in report["rows"]] == ["ACCEPTED", "REJECTED", "UNAVAILABLE", "REJECTED"]
    assert "quality validation" in report["rows"][1]["reason"]


def test_an_accepted_quote_must_come_from_the_source():
    report = qa.evaluate([{"id": "x", "kind": "OPEN", "topic": "t", "text": "Gerçek kaynak cümlesi."}],
                         lambda c, l: {"question": "Q?", "quote": "başka bir cümle"})
    assert report["accepted"] == 0


def test_main_exits_with_the_threshold_result(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(qa, "real_quiz", lambda case, language: {"question": "Q?", "quote": case["text"][:20]})
    assert qa.main(["--min-accept", "0.9", "--out", str(tmp_path / "r.json")]) == 0
    assert (tmp_path / "r.json").exists()
    monkeypatch.setattr(qa, "real_quiz", lambda case, language: (_ for _ in ()).throw(HTTPException(422, "no")))
    assert qa.main(["--min-accept", "0.5"]) == 1
    monkeypatch.setattr(qa, "real_quiz", lambda case, language: (_ for _ in ()).throw(HTTPException(503, "down")))
    assert qa.main([]) == 2
