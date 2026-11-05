"""Math symbols must survive duplicate and source checks; no real LLM in this suite."""
import pytest
from knot_rag.quiz_quality import canonical, validate_draft

def draft(options):
    return dict(question="Which expression computes the sum of two values?",
                objective="Identify the requested operation.", options=options, expected="0",
                quote="The sum is x+y; the difference is x-y.", source_index=1,
                explanation="The source defines addition as the sum of the values.",
                option_feedback=["This operation is evaluated against the source."]*4)

def test_four_operators_are_distinct_and_publishable():
    options=["x+y", "x-y", "x*y", "x/y"]
    assert len({canonical(x) for x in options})==4
    d=draft(options)
    validate_draft(d,"MULTIPLE_CHOICE",[{"text":d['quote']}])

def test_spacing_does_not_disguise_duplicate_expression():
    d=draft(["x+y", "x + y", "x*y", "x/y"])
    with pytest.raises(ValueError,match="Duplicate"):
        validate_draft(d,"MULTIPLE_CHOICE",[{"text":d['quote']}])

def test_changed_operator_cannot_ground_a_short_answer():
    d={**draft([]),"expected":"x*y"}
    with pytest.raises(ValueError,match="source-grounded"):
        validate_draft(d,"SHORT_ANSWER",[{"text":d['quote']}])
