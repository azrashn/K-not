"""Claims are checked against the passages they cite: words, numbers and polarity."""

from knot_rag.claim_check import check_claim, check_claims

SOURCE = "Genişlik öncelikli arama bir kuyruk kullanır ve düğümleri seviye seviye ziyaret eder."
DIJKSTRA = "Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışmaz."


def test_a_claim_made_of_source_words_is_supported():
    r = check_claim("Genişlik öncelikli arama kuyruk kullanır.", [SOURCE])
    assert r["label"] == "SUPPORTED"
    assert r["coverage"] >= 0.7 and r["missing_terms"] == []
    assert r["verified"] is False


def test_a_claim_with_unrelated_words_is_unsupported_and_lists_them():
    r = check_claim("Derinlik öncelikli arama özyineleme ile ağaç budama yapar.", [SOURCE])
    assert r["label"] == "UNSUPPORTED"
    assert "özyineleme" in r["missing_terms"]


def test_an_added_term_makes_it_partial_not_supported():
    r = check_claim("Genişlik öncelikli arama bir kuyruk ve ayrıca öncelik sırası kullanır.", [SOURCE])
    assert r["label"] == "PARTIAL"
    assert r["reason"] == "TERMS_NOT_IN_SOURCE"


def test_a_number_that_is_not_in_the_source_is_flagged():
    r = check_claim("Genişlik öncelikli arama bir kuyruk kullanır ve 7 düğümü ziyaret eder.", [SOURCE])
    assert r["label"] == "PARTIAL"
    assert r["unmatched_numbers"] == ["7"]


def test_a_flipped_polarity_is_unsupported():
    r = check_claim("Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışır.", [DIJKSTRA])
    assert r["negation_mismatch"] is True
    assert r["label"] == "UNSUPPORTED"
    assert r["reason"] == "NEGATION_MISMATCH"


def test_the_same_negation_is_not_a_mismatch():
    r = check_claim("Dijkstra algoritması negatif kenar ağırlıkları ile doğru çalışmaz.", [DIJKSTRA])
    assert r["negation_mismatch"] is False
    assert r["label"] == "SUPPORTED"


def test_a_very_short_claim_is_not_judged():
    r = check_claim("Kuyruk.", [SOURCE])
    assert r["label"] == "PARTIAL" and r["reason"] == "TOO_SHORT_TO_CHECK" and r["coverage"] is None


def test_each_claim_is_checked_only_against_the_sources_it_cites():
    evidence = [{"text": SOURCE}, {"text": DIJKSTRA}]
    claims = [
        {"text": "Genişlik öncelikli arama kuyruk kullanır.", "sources": [1]},
        {"text": "Genişlik öncelikli arama kuyruk kullanır.", "sources": [2]},  # cites the wrong passage
    ]
    checked, summary = check_claims(claims, evidence)
    assert [c["support"]["label"] for c in checked] == ["SUPPORTED", "UNSUPPORTED"]
    assert summary == {"SUPPORTED": 1, "PARTIAL": 0, "UNSUPPORTED": 1, "total": 2, "method": "lexical-v1", "verified": False}
    assert "support" not in claims[0]  # input is not mutated
