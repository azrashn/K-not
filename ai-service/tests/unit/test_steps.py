import json

from knot_rag.generation.providers.base import ProviderError
from knot_rag.steps import (
    MAX_STEPS,
    build_request,
    generate_steps,
    quote_in_sources,
    step_schema,
    validate_steps,
)

EVIDENCE = [
    {"id": "a" * 64, "kind": "VIDEO", "text": "n sıfırdan küçükken x(n) sıfırdır.", "location": {"kind": "video", "start_ms": 290000}},
    {"id": "b" * 64, "kind": "PDF", "text": "y(n) = x(n) + 2x(n-1) olarak tanımlanır.", "location": {"kind": "page", "page": 3}},
]


def step(**over):
    base = {"board": "x(n) = 0, n < 0", "speech": "Tanıma bakalım.", "formula": "", "mark": "none", "source_ids": [1], "quote": ""}
    return {**base, **over}


def out(*steps, summary="Özet."):
    return json.dumps({"steps": list(steps), "summary": summary}, ensure_ascii=False)


def test_strict_schema_requires_every_field_but_allows_empty_sources_and_quote():
    schema = step_schema(2)
    item = schema["properties"]["steps"]["items"]
    assert set(item["required"]) == {"board", "speech", "formula", "mark", "source_ids", "quote"}
    assert item["additionalProperties"] is False
    assert item["properties"]["source_ids"]["minItems"] == 0
    assert item["properties"]["source_ids"]["items"]["maximum"] == 2
    assert "minLength" not in item["properties"]["quote"]
    assert schema["properties"]["steps"]["maxItems"] == MAX_STEPS
    assert build_request("soru", EVIDENCE).response_schema == schema


def test_valid_steps_get_real_evidence_ids_not_model_text():
    steps, summary, errors = validate_steps(
        json.loads(out(step(source_ids=[2, 2], formula="$y(0)=x(0)$", mark="underline", quote="olarak  TANIMLANIR"))),
        EVIDENCE,
    )
    assert errors == []
    assert summary == "Özet."
    assert steps == [{
        "board": "x(n) = 0, n < 0", "speech": "Tanıma bakalım.", "formula": "y(0)=x(0)", "mark": "underline",
        "sources": ["b" * 64], "source_ids": [2], "quote": "olarak  TANIMLANIR",
    }]


def test_sourceless_step_is_dropped_and_invented_quote_removed():
    steps, _, errors = validate_steps(
        json.loads(out(step(source_ids=[]), step(source_ids=[9]), step(board="Kural", quote="kaynakta olmayan cümle"))),
        EVIDENCE,
    )
    assert errors == []
    assert [s["board"] for s in steps] == ["Kural"]
    assert "quote" not in steps[0]


def test_quote_must_come_from_a_cited_excerpt():
    assert quote_in_sources("x(n) sıfırdır", [EVIDENCE[0]["text"]])
    assert not quote_in_sources("x(n) sıfırdır", [EVIDENCE[1]["text"]])
    steps, _, _ = validate_steps(json.loads(out(step(source_ids=[2], quote="x(n) sıfırdır"))), EVIDENCE)
    assert "quote" not in steps[0]


def test_broken_shapes_are_errors():
    assert validate_steps("x", EVIDENCE)[2]
    assert validate_steps({"steps": []}, EVIDENCE)[2]
    assert validate_steps(json.loads(out(step(mark="glow"))), EVIDENCE)[2]
    assert validate_steps(json.loads(out(step(board=""))), EVIDENCE)[2]
    assert validate_steps(json.loads(out(*[step()] * (MAX_STEPS + 1))), EVIDENCE)[2]
    # every step lost its source: nothing grounded is left
    assert validate_steps(json.loads(out(step(source_ids=[]))), EVIDENCE)[2] == ["no step cites a valid source number"]


class Model:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_good_output_needs_one_call():
    model = Model(out(step()))
    result = generate_steps(model, "y(0) neden 1?", EVIDENCE)
    assert result["steps_status"] == "MODEL" and len(result["steps"]) == 1
    assert len(model.requests) == 1
    assert model.requests[0].timeout_seconds == 60


def test_broken_output_is_repaired_once():
    model = Model("not json", out(step()))
    result = generate_steps(model, "soru", EVIDENCE)
    assert result["steps_status"] == "REPAIRED"
    repair = json.loads(model.requests[1].user)
    assert repair["previous_output"] == "not json"
    assert repair["errors"] == ["output is not a JSON object"]


def test_broken_twice_gives_no_steps():
    model = Model("{}", out(step(source_ids=[])))
    assert generate_steps(model, "soru", EVIDENCE) == {"steps": [], "summary": "", "steps_status": "INVALID"}
    assert len(model.requests) == 2


def test_provider_failure_or_timeout_gives_no_steps():
    assert generate_steps(Model(ProviderError("timeout")), "soru", EVIDENCE)["steps_status"] == "FAILED"
    assert generate_steps(Model("{}", ProviderError("timeout")), "soru", EVIDENCE)["steps_status"] == "FAILED"


def test_the_repair_only_gets_the_time_left_of_one_budget():
    now = [0.0]
    clock = lambda: now[0]  # noqa: E731

    class Slow(Model):
        def __call__(self, request):
            now[0] += 40
            return super().__call__(request)

    model = Slow("{}", out(step()))
    assert generate_steps(model, "soru", EVIDENCE, timeout_seconds=60, clock=clock)["steps_status"] == "REPAIRED"
    assert model.requests[1].timeout_seconds == 20

    now[0] = 0.0
    assert generate_steps(Slow2(now), "soru", EVIDENCE, timeout_seconds=60, clock=clock)["steps_status"] == "FAILED"


class Slow2(Model):
    """First call uses 57 of 60 seconds: no time left for a repair."""

    def __init__(self, now):
        super().__init__("{}")
        self.now = now

    def __call__(self, request):
        self.now[0] += 57
        return super().__call__(request)


def test_no_evidence_no_call():
    model = Model()
    assert generate_steps(model, "soru", [])["steps_status"] == "SKIPPED"
    assert model.requests == []
