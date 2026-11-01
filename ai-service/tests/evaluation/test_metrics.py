from knot_rag.evaluation.metrics import ItemResult, summarize, threshold_sweep


def item(i, expected, cands, scores=None, outcome=None, support=None, claims=(), cited=(), fab=0, require_all=False, ctx=None, leak=0):
    return ItemResult(i, "c", list(expected), [], require_all, list(cands), list(scores or [0.5] * len(cands)),
                      list(ctx if ctx is not None else cands), leak, outcome, support, list(claims), list(cited), fab)


def test_denominators_and_unmeasured_metrics():
    items = [item("a", ["g1"], ["g1", "x"]), item("b", ["g2"], ["x"]), item("o", [], ["x"])]
    m = summarize(items)
    assert m["retrieval_success"]["numerator"] == 1 and m["retrieval_success"]["denominator"] == 2
    # Generation was not run: these metrics are unmeasured, not 0.
    for k in ["source_supported_answer_rate", "unsupported_claim_rate", "citation_correctness", "out_of_scope_abstention"]:
        assert m[k]["value"] is None and m[k]["denominator"] == 0
    assert m["source_supported_answer_rate"]["meets_target"] is None


def test_generation_metrics():
    items = [
        item("a", ["g1"], ["g1"], outcome="ANSWERED", support="SUPPORTED", claims=["SUPPORTED", "SUPPORTED"], cited=["g1", "x"]),
        item("b", ["g2"], ["g2"], outcome="PARTIALLY_ANSWERED", support="PARTIALLY_SUPPORTED", claims=["UNSUPPORTED"], cited=[], fab=1),
        item("c", ["g3"], ["g3"], outcome="INSUFFICIENT_EVIDENCE", support="UNSUPPORTED"),
        item("o", [], ["x"], outcome="INSUFFICIENT_EVIDENCE"),
        item("o2", [], ["x"], outcome="ANSWERED", support="SUPPORTED", claims=["SUPPORTED"], cited=["x"]),
    ]
    m = summarize(items)
    assert (m["source_supported_answer_rate"]["numerator"], m["source_supported_answer_rate"]["denominator"]) == (1, 2)
    assert (m["unsupported_claim_rate"]["numerator"], m["unsupported_claim_rate"]["denominator"]) == (1, 4)
    assert (m["citation_integrity"]["numerator"], m["citation_integrity"]["denominator"]) == (3, 4)
    assert (m["citation_correctness"]["numerator"], m["citation_correctness"]["denominator"]) == (1, 2)
    assert (m["out_of_scope_abstention"]["numerator"], m["out_of_scope_abstention"]["denominator"]) == (1, 2)


def test_multi_passage_requires_all_and_leakage_counts():
    items = [item("m", ["a", "b"], ["a", "b"], require_all=True, ctx=["a"]), item("n", ["a"], ["a"], leak=2)]
    m = summarize(items)
    assert m["multi_passage_recall"]["value"] == 0.0
    assert m["scope_leakage"]["numerator"] == 2


def test_threshold_sweep():
    items = [item("a", ["g"], ["g", "x"], [0.6, 0.2]), item("o", [], ["x"], [0.25])]
    rows = {r["min_score"]: r for r in threshold_sweep(items, [0.1, 0.3, 0.7])}
    assert rows[0.1] == {"min_score": 0.1, "retrieval_success": 1.0, "out_of_scope_rejected": 0.0}
    assert rows[0.3]["out_of_scope_rejected"] == 1.0 and rows[0.7]["retrieval_success"] == 0.0
