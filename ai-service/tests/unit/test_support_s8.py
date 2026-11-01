"""Rule S8 (citation-lexical-v3): a SIKI claim may not contain content terms that occur in none
of its cited passages. Regression for the offline perturbation harness findings."""

from dataclasses import replace

from knot_rag.config import SupportSettings
from knot_rag.evidence.support import unsupported_terms
from knot_rag.schemas import SupportStatus
from tests.unit.test_evidence import E1, E2, run

AVL = "AVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır."


def test_verbatim_claim_has_no_unsupported_terms_and_stays_siki():
    _, (d,) = run([{"text": AVL, "evidence_ids": ["E2"], "quote": AVL.rstrip(".")}])
    assert d.assessment.unsupported_terms == [] and d.status == SupportStatus.SUPPORTED


def test_swapped_entity_absent_from_the_source_blocks_siki():
    claim = AVL.replace("AVL", "Kırmızı-siyah")
    _, (d,) = run([{"text": claim, "evidence_ids": ["E2"], "quote": AVL.rstrip(".")}])
    assert "kirmizi" in d.assessment.unsupported_terms or "kırmızı" in " ".join(d.assessment.unsupported_terms)
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED and "kaynakta geçmeyen" in d.explanation


def test_appended_unsupported_clause_blocks_siki():
    claim = AVL.rstrip(".") + " ve bu yaklaşım veritabanı indekslerinde varsayılan olarak kullanılır."
    _, (d,) = run([{"text": claim, "evidence_ids": ["E2"], "quote": AVL.rstrip(".")}])
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED
    assert {"veritabani", "indekslerinde"} & {t.replace("ı", "i") for t in d.assessment.unsupported_terms}


def test_suffix_variants_and_document_titles_count_as_supported():
    # "rotasyonlar" ~ "rotasyon" (stem), "Notlar" is the document title.
    assert unsupported_terms("Notlar: dört temel rotasyonlar vardır", [E1]) == []


def test_numbers_are_left_to_rule_s4():
    assert unsupported_terms("Dört temel rotasyon vardır: 7", [E1]) == []


def test_tolerance_is_configurable():
    claim = AVL.replace("AVL", "Kırmızı-siyah")
    s = replace(SupportSettings(), max_unsupported_terms=2)
    _, (d,) = run([{"text": claim, "evidence_ids": ["E2"], "quote": AVL.rstrip(".")}], settings=s)
    assert d.status == SupportStatus.SUPPORTED  # explicit opt-out restores v2 behaviour


def test_known_limit_swap_within_the_same_passage_is_not_caught():
    # Bag-of-words: "sağ ... sağ" uses only terms the passage contains. Needs semantic checking.
    claim = AVL.replace("sol ve sağ", "sağ ve sağ")
    _, (d,) = run([{"text": claim, "evidence_ids": ["E2"], "quote": AVL.rstrip(".")}])
    assert d.assessment.unsupported_terms == [] and d.status == SupportStatus.SUPPORTED


def test_e2_fixture_is_unchanged():
    assert E2.text == AVL
