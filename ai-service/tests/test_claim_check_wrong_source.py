from knot_rag.claim_check import check_claims


def test_claim_cited_to_wrong_source_is_found_in_other_evidence():
    evidence = [
        {"text": "Transport layer protocols include TCP and UDP, which provide logical communication between processes."},
        {"text": "The network layer forwards datagrams from one host to another using routing tables."},
    ]
    claims = [{"text": "Taşıma katmanı TCP ve UDP protokollerini kullanır (transport layer).", "sources": [2]}]
    out, summary = check_claims(claims, evidence)
    support = out[0]["support"]
    assert support["label"] == "PARTIAL"
    assert support["missing_terms"] == []
    assert support["reason"] == "WRONG_SOURCE_CITED"
    assert support["suggested_sources"] == [1]
    assert support["cited_sources"] == [2]


def test_claim_unsupported_everywhere_stays_unsupported():
    evidence = [{"text": "The network layer forwards datagrams using routing tables."}]
    claims = [{"text": "Quantum entanglement transfers photons across satellites instantly.", "sources": [1]}]
    out, _ = check_claims(claims, evidence)
    assert out[0]["support"]["label"] in ("UNSUPPORTED", "PARTIAL")
    assert out[0]["support"].get("reason") != "WRONG_SOURCE_CITED"
