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
    assert summary == {"SUPPORTED": 1, "PARTIAL": 0, "UNSUPPORTED": 1, "UNCHECKED": 0, "ANCHORED": 0, "total": 2, "method": "lexical-v4", "verified": False}
    assert "support" not in claims[0]  # input is not mutated


def test_reworded_claim_with_linking_verbs_and_hyphenated_terms_is_supported():
    source = ("Internet services: web, streaming video, multi-media teleconferencing, email, games, "
              "e-commerce, social media, interconnected appliances.")
    claim = "Services include web, streaming video, multimedia teleconferencing, email, games, e-commerce, social media, and interconnected appliances."
    out = check_claim(claim, [source])
    assert out["label"] == "SUPPORTED", out
    assert out["missing_terms"] == []


def test_light_words_do_not_hide_a_genuinely_missing_term():
    source = "Transport services allow communication between application processes on different hosts."
    claim = "Transport services enable communication between application processes using quantum encryption."
    out = check_claim(claim, [source])
    assert "quantum" in out["missing_terms"] and "encryption" in out["missing_terms"]
    assert out["label"] != "SUPPORTED"
    assert "enable" not in out["missing_terms"] and "using" not in out["missing_terms"]


def test_a_turkish_claim_over_an_english_source_is_not_called_unsupported():
    source = "Transport layer provides logical communication between application processes running on different hosts."
    claim = "Taşıma katmanı, farklı bilgisayarlarda çalışan uygulama süreçleri arasında mantıksal iletişim sağlar."
    out = check_claim(claim, [source])
    assert out["label"] == "UNCHECKED" and out["reason"] == "DIFFERENT_LANGUAGE"


def test_a_translated_claim_still_has_its_numbers_checked():
    source = "TCP uses a three-way handshake and a 20 byte header."
    claim = "TCP üç yönlü el sıkışma ve 40 baytlık başlık kullanır."
    out = check_claim(claim, [source])
    assert out["label"] == "PARTIAL" and out["unmatched_numbers"] == ["40"]


CRC = ("Cyclic redundancy check (CRC): more powerful error-detection coding. D: data bits (given, think of these as binary data). "
       "G: bit pattern (generator), of r+1 bits. goal: choose r CRC bits, R, such that <D,R> exactly divisible by G (mod 2).")


def test_a_translation_whose_acronyms_and_kept_terms_are_in_the_source_is_anchored():
    claim = "Cyclic Redundancy Check (CRC), bir hata tespit yöntemi olup gönderilen verinin doğruluğunu kontrol etmek için kullanılır."
    out = check_claim(claim, [CRC])
    assert out["label"] == "ANCHORED" and "CRC" in out["matched_terms"]


def test_a_translation_with_an_invented_acronym_is_flagged():
    claim = "Bu yöntem, veriyle birlikte eklenen ECC ve CRC bitlerini kullanır."
    out = check_claim(claim, [CRC])
    assert out["label"] == "PARTIAL" and out["missing_terms"] == ["ECC"]


def test_single_letter_variables_are_not_treated_as_terms():
    from knot_rag.claim_check import anchor_terms
    assert anchor_terms("Gönderen, veri (D) ile birlikte bir bit deseni (G) kullanarak r adet CRC biti hesaplar.") == ["CRC"]
