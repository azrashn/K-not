from knot_rag.config import SupportSettings
from knot_rag.evidence import EvidenceMapper, HeuristicSupportAssessor, aggregate_status, lexical_coverage
from knot_rag.generation.generator import ModelAnswer
from knot_rag.schemas import CitationIssueType, RetrievedEvidence, SourceLocation, SupportStatus

E1 = RetrievedEvidence(
    evidence_id="E1", chunk_id="doc-vy-notlar:v1:003", document_id="doc-vy-notlar", course_id="c",
    document_title="Notlar", document_type="notes", indexing_version="v1",
    location=SourceLocation(page_start=3, char_start=1000, char_end=1200), label="Notlar · s.3",
    text="Dört temel rotasyon vardır: LL, RR, LR ve RL. LL ve RR tek rotasyon; LR ve RL çift rotasyon gerektirir.", rank=1,
)
E2 = RetrievedEvidence(
    evidence_id="E2", chunk_id="doc-vy-hafta4:v1:003", document_id="doc-vy-hafta4", course_id="c",
    document_title="Slaytlar", document_type="slide", indexing_version="v1", location=SourceLocation(page_start=18),
    label="Slayt · s.18", text="AVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu ikili arama ağacıdır.", rank=2,
)


def run(claims, question=None, settings=None):
    # Default question = the first claim itself, so relevance (S7) does not interfere with
    # tests that target other rules.
    ans = ModelAnswer.model_validate({"status": "answered", "claims": claims})
    mapped = EvidenceMapper().map(ans, [E1, E2])
    a = HeuristicSupportAssessor(settings or SupportSettings())
    return mapped, a.assess_all(mapped, question or claims[0]["text"])


def test_fully_supported_claim_with_verified_quote_and_highlight():
    mapped, (d,) = run([{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": ["E1"], "quote": "dört temel rotasyon vardır: LL, RR, LR ve RL"}])
    c = mapped[0].citations[0]
    assert d.status == SupportStatus.SUPPORTED
    assert c.quote_verified and c.chunk_id == "doc-vy-notlar:v1:003" and c.location.page_start == 3
    assert E1.text[c.highlight.chunk_char_start:c.highlight.chunk_char_end] == "Dört temel rotasyon vardır: LL, RR, LR ve RL"
    assert c.highlight.document_char_start == 1000 + c.highlight.chunk_char_start
    assert d.assessment.semantically_verified is False


def test_no_document_offsets_when_chunk_offset_unknown():
    mapped, _ = run([{"text": "Fark en fazla 1 olabilir.", "evidence_ids": ["E2"], "quote": "farkın en fazla 1"}])
    h = mapped[0].citations[0].highlight
    assert h is not None and h.document_char_start is None


def test_fabricated_evidence_id_is_removed_and_reported():
    mapped, (d,) = run([{"text": "AVL 1972'de bulundu.", "evidence_ids": ["E99"], "quote": "1972"}])
    assert mapped[0].citations == []
    assert mapped[0].issues[0].issue == CitationIssueType.UNKNOWN_EVIDENCE_ID
    assert d.status == SupportStatus.UNSUPPORTED


def test_mixed_real_and_fabricated_ids_cannot_be_fully_supported():
    mapped, (d,) = run([{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": ["E1", "E7"], "quote": "Dört temel rotasyon vardır"}])
    assert [c.evidence_id for c in mapped[0].citations] == ["E1"]
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED


def test_quote_not_found_is_reported_and_not_supported():
    mapped, (d,) = run([{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": ["E1"], "quote": "beş temel rotasyon"}])
    assert mapped[0].issues[0].issue == CitationIssueType.QUOTE_NOT_FOUND
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED


def test_model_marked_partial_caps_status():
    _, (d,) = run([{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": ["E1"], "quote": "Dört temel rotasyon vardır", "support": "partial"}])
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED


def test_number_mismatch_caps_status():
    _, (d,) = run([{"text": "AVL ağacında yükseklik farkı en fazla 2 olabilir.", "evidence_ids": ["E2"], "quote": "en fazla 1"}])
    assert not d.assessment.numbers_consistent
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED


def test_irrelevant_citation_is_unsupported():
    _, (d,) = run([{"text": "Hash tablosunda çakışma zincirleme ile çözülür.", "evidence_ids": ["E2"]}])
    assert d.status == SupportStatus.UNSUPPORTED


def test_claim_without_citation_is_unsupported():
    _, (d,) = run([{"text": "Kırmızı-siyah ağaçta yükseklik en fazla 2·log(n+1).", "evidence_ids": []}])
    assert d.status == SupportStatus.UNSUPPORTED


def test_lexical_coverage_handles_turkish_suffixes():
    assert lexical_coverage("rotasyonlar uygulanır", ["rotasyon uygulanması"]) == 1.0
    assert lexical_coverage("", ["x"]) == 0.0


def test_aggregate_status():
    S, P, U = SupportStatus.SUPPORTED, SupportStatus.PARTIALLY_SUPPORTED, SupportStatus.UNSUPPORTED
    assert aggregate_status([S, S]) == S
    assert aggregate_status([S, U]) == P
    assert aggregate_status([P]) == P
    assert aggregate_status([U, U]) == U
    assert aggregate_status([]) == U


# ── v2 rules ────────────────────────────────────────────────────────────────────────
E3 = RetrievedEvidence(
    evidence_id="E3", chunk_id="sort:1", document_id="sort", course_id="c", document_title="Kitap",
    document_type="textbook", indexing_version="v1", location=SourceLocation(page_start=43), label="Kitap · s.43",
    text="Birleştirme sıralaması her durumda O(n log n) sürer. Birleştirme sıralaması kararlı bir sıralama algoritmasıdır. "
         "Hızlı sıralama ise yerinde çalışır.", rank=1,
)


def run3(claims, question):
    ans = ModelAnswer.model_validate({"status": "answered", "claims": claims})
    mapped = EvidenceMapper().map(ans, [E3])
    return mapped, HeuristicSupportAssessor(SupportSettings()).assess_all(mapped, question)


def test_s3_claim_cannot_borrow_words_from_other_sentences_of_the_chunk():
    # Quote is real, but the claim's content ("yerinde", "kararlı") comes from other sentences.
    _, (d,) = run3([{"text": "Hızlı sıralama yerinde çalışır, kararlıdır ve her durumda O(n log n) sürer.", "evidence_ids": ["E3"],
                     "quote": "Hızlı sıralama ise yerinde çalışır"}], "Hızlı sıralama kararlı mıdır?")
    assert d.assessment.lexical_coverage >= 0.6  # v1 would have rated this SIKI
    assert d.assessment.quote_coverage < 0.6 and d.status == SupportStatus.PARTIALLY_SUPPORTED


def test_s3_limit_single_borrowed_word_still_passes():
    # Documented limitation: S3 catches substantial borrowing only; one wrong word in five
    # stays above the 0.6 threshold. The semantic judge exists for this case.
    _, (d,) = run3([{"text": "Hızlı sıralama yerinde çalışır ve kararlıdır.", "evidence_ids": ["E3"], "quote": "Hızlı sıralama ise yerinde çalışır"}],
                   "Hızlı sıralama yerinde çalışır mı, kararlı mıdır?")
    assert d.assessment.quote_coverage == 0.8 and d.status == SupportStatus.SUPPORTED


def test_s5_negation_mismatch_is_not_supported():
    _, (d,) = run3([{"text": "Birleştirme sıralaması kararlı bir sıralama algoritması değildir.", "evidence_ids": ["E3"],
                     "quote": "Birleştirme sıralaması kararlı bir sıralama algoritmasıdır"}], "Birleştirme sıralaması kararlı mıdır?")
    assert not d.assessment.negation_consistent
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED and "olumsuzluk" in d.explanation


def test_s7_true_but_irrelevant_quote_is_not_siki():
    # The Dijkstra failure mode from eval.v1 (o02).
    _, (d,) = run3([{"text": "Birleştirme sıralaması her durumda O(n log n) sürer.", "evidence_ids": ["E3"],
                     "quote": "Birleştirme sıralaması her durumda O(n log n) sürer"}], "Dijkstra algoritmasının zaman karmaşıklığı nedir?")
    assert d.assessment.quote_verified and d.assessment.question_relevance < 0.34
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED and d.capped_by_hard_rule


def test_s7_relative_relevance_demotes_tangential_extra_claims():
    claims = [
        {"text": "Birleştirme sıralaması kararlı bir sıralama algoritmasıdır.", "evidence_ids": ["E3"], "quote": "Birleştirme sıralaması kararlı bir sıralama algoritmasıdır"},
        {"text": "Birleştirme sıralaması her durumda O(n log n) sürer.", "evidence_ids": ["E3"], "quote": "Birleştirme sıralaması her durumda O(n log n) sürer"},
    ]
    _, (lead, extra) = run3(claims, "Birleştirme sıralaması kararlı bir algoritma mıdır?")
    assert lead.status == SupportStatus.SUPPORTED
    assert extra.status == SupportStatus.PARTIALLY_SUPPORTED


def test_heuristic_siki_is_never_semantically_verified():
    _, (d,) = run3([{"text": "Birleştirme sıralaması kararlı bir sıralama algoritmasıdır.", "evidence_ids": ["E3"],
                     "quote": "Birleştirme sıralaması kararlı bir sıralama algoritmasıdır"}], "Birleştirme sıralaması kararlı mıdır?")
    assert d.status == SupportStatus.SUPPORTED
    assert d.assessment.verification.value == "HEURISTIC" and d.assessment.semantically_verified is False
