import json

from knot_rag.self_check_judge import judge

PASSAGE = "Process B waits for process A before it releases the lock, so A always runs first."


def reply(items):
    return lambda request: json.dumps({"results": items})


def test_contradiction_needs_a_quote_that_is_really_in_the_passage():
    pairs = [("Process A waits for process B before it releases the lock.", PASSAGE)]
    ok = judge(pairs, reply([{"index": 0, "verdict": "CONTRADICTS", "quote": "Process B waits for process A"}]))
    assert ok == [{"verdict": "CONTRADICTS", "quote": "Process B waits for process A"}]
    # invented quote -> the model's opinion is dropped, never shown
    fake = judge(pairs, reply([{"index": 0, "verdict": "CONTRADICTS", "quote": "A never waits for anyone at all"}]))
    assert fake == [{"verdict": "UNSURE", "quote": ""}]
    empty = judge(pairs, reply([{"index": 0, "verdict": "CONTRADICTS", "quote": ""}]))
    assert empty == [{"verdict": "UNSURE", "quote": ""}]


def test_supports_and_failures():
    pairs = [("B waits for A.", PASSAGE), ("x", PASSAGE)]
    out = judge(pairs, reply([{"index": 0, "verdict": "SUPPORTS", "quote": "ignored"}, {"index": 1, "verdict": "NOPE", "quote": ""}]))
    assert out == [{"verdict": "SUPPORTS", "quote": ""}, None]
    assert judge(pairs, lambda r: "garbage") == [None, None]
    assert judge([], reply([])) == []

    def boom(request):
        raise ValueError("x")

    assert judge(pairs, boom) == [None, None]


def test_a_contradiction_must_hold_up_when_asked_alone():
    pairs = [("Process A waits for process B.", PASSAGE), ("B waits for A.", PASSAGE)]
    calls = []

    def model(request):
        calls.append(request.user.count('"index"'))
        if len(calls) == 1:  # batch: cries wolf on both
            return json.dumps({"results": [
                {"index": 0, "verdict": "CONTRADICTS", "quote": "Process B waits for process A"},
                {"index": 1, "verdict": "CONTRADICTS", "quote": "Process B waits for process A"}]})
        if len(calls) == 2:  # alone: the first stands, ...
            return json.dumps({"results": [{"index": 0, "verdict": "CONTRADICTS", "quote": "Process B waits for process A"}]})
        return json.dumps({"results": [{"index": 0, "verdict": "SUPPORTS", "quote": ""}]})  # ... the second does not

    out = judge(pairs, model)
    assert out[0]["verdict"] == "CONTRADICTS" and out[1] == {"verdict": "UNSURE", "quote": ""}
    assert calls == [2, 1, 1]
