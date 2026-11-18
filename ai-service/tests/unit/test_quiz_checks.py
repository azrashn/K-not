"""Deterministic quiz checks (QUIZ_ENGINE=v2): every failure has a stable code."""

import pytest

from knot_rag import quiz_checks as qc
from knot_rag.quiz_checks import QuizCheckError, check_question

BFS = ("BFS (genişlik öncelikli arama), düğümleri başlangıç düğümüne uzaklıklarına göre katman katman "
       "ziyaret eder. BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır. DFS, yığın veya "
       "özyineleme kullanır.")
PHYSICS = "Ortalama hız, alınan toplam yolun geçen toplam süreye bölünmesiyle bulunur."
EVIDENCE = [{"text": PHYSICS}, {"text": BFS}]
QUOTE = "BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır."


def code_of(kind, draft, **kw):
    with pytest.raises(QuizCheckError) as exc:
        check_question(kind, draft, EVIDENCE, **kw)
    return exc.value.code


def mc(**over):
    return {"question": "BFS bekleyen düğümleri hangi veri yapısında tutar?",
            "options": ["Kuyruk", "Yığın", "İkili ağaç", "Karma tablosu"], "answer": "Kuyruk",
            "quote": QUOTE, "explanation": "Kaynak, BFS'nin bekleyen düğümler için kuyruk kullandığını söyler.",
            **over}


# ── quote ────────────────────────────────────────────────────────────────────────────────────
def test_quote_is_found_in_its_own_source_and_index_is_computed():
    assert qc.find_quote(QUOTE, EVIDENCE) == (2, QUOTE)


def test_quote_tolerates_only_whitespace_and_returns_the_source_text():
    index, exact = qc.find_quote("“BFS, sırada bekleyen\n düğümleri  tutmak için kuyruk kullanır.”", EVIDENCE)
    assert (index, exact) == (2, QUOTE)


@pytest.mark.parametrize("quote", [
    "BFS, sırada bekleyen düğümleri tutmak için yığın kullanır.",  # changed fact
    "BFS sırada bekleyen düğümleri tutmak için kuyruk kullanır.",   # changed punctuation
    "bfs, sırada bekleyen düğümleri tutmak için kuyruk kullanır.",  # changed case
])
def test_a_changed_quote_is_not_found(quote):
    with pytest.raises(QuizCheckError) as exc:
        qc.find_quote(quote, EVIDENCE)
    assert exc.value.code == qc.QUOTE_NOT_FOUND


def test_a_tiny_quote_is_a_format_error():
    assert code_of("MULTIPLE_CHOICE", mc(quote="BFS")) == qc.BAD_FORMAT


# ── multiple choice ──────────────────────────────────────────────────────────────────────────
def test_valid_multiple_choice_is_shuffled_and_the_key_follows_the_answer():
    q = check_question("MULTIPLE_CHOICE", mc(), EVIDENCE)
    assert q["options"][int(q["expected"])] == "Kuyruk"
    assert sorted(q["options"]) == sorted(mc()["options"])
    assert q["source_index"] == 2 and q["quote"] == QUOTE and q["kind"] == "MULTIPLE_CHOICE"


def test_shuffle_is_reproducible_and_does_not_always_keep_the_model_position():
    first = [check_question("MULTIPLE_CHOICE", mc(), EVIDENCE, seed=str(s))["expected"] for s in range(40)]
    again = [check_question("MULTIPLE_CHOICE", mc(), EVIDENCE, seed=str(s))["expected"] for s in range(40)]
    assert first == again
    assert len(set(first)) > 1


def test_answer_matching_ignores_case_and_turkish_dotted_i():
    q = check_question("MULTIPLE_CHOICE", mc(answer="KUYRUK"), EVIDENCE)
    assert q["options"][int(q["expected"])] == "Kuyruk"


def test_answer_must_be_one_of_the_options():
    assert code_of("MULTIPLE_CHOICE", mc(answer="Bağlı liste")) == qc.ANSWER_NOT_IN_OPTIONS


def test_options_must_be_distinct_after_normalization():
    assert code_of("MULTIPLE_CHOICE", mc(options=["Kuyruk", "kuyruk.", "Yığın", "Ağaç"])) == qc.DUPLICATE_OPTIONS


def test_exactly_four_options():
    assert code_of("MULTIPLE_CHOICE", mc(options=["Kuyruk", "Yığın", "Ağaç"])) == qc.BAD_FORMAT


def test_options_must_be_a_list_of_strings():
    assert code_of("MULTIPLE_CHOICE", mc(options={"A": "Kuyruk"})) == qc.SCHEMA_MISMATCH


def test_conspicuously_long_correct_option_is_rejected():
    long = "Kuyruk, çünkü ilk giren ilk çıkar ve katmanlar sırayla işlenir ve böylece en kısa yol bulunur"
    assert code_of("MULTIPLE_CHOICE", mc(options=[long, "Yığın", "Ağaç", "Liste"], answer=long)) == qc.BAD_FORMAT


def test_stem_must_not_give_the_answer_away():
    assert code_of("MULTIPLE_CHOICE", mc(question="BFS kuyruk ile hangi düğümleri tutar?")) == qc.ANSWER_LEAKED


def test_answer_needs_a_root_in_the_quote():
    draft = mc(options=["Bağlı liste", "Yığın", "İkili ağaç", "Karma tablosu"], answer="Bağlı liste")
    assert code_of("MULTIPLE_CHOICE", draft) == qc.ANSWER_NOT_IN_SOURCE


def test_root_match_survives_turkish_suffixes_and_softening():
    assert qc.shares_root("kuyruk", "Bekleyen düğümler kuyruğa eklenir.")
    assert qc.shares_root("ağaç", "Bu ağacın kökü siyahtır.")
    assert not qc.shares_root("yığın", "Bekleyen düğümler kuyruğa eklenir.")
    assert not qc.shares_root("ve bir", "ve bir şey")  # stop words are not meaningful


def test_missing_explanation_is_rejected():
    assert code_of("MULTIPLE_CHOICE", mc(explanation="")) == qc.BAD_FORMAT
    assert code_of("MULTIPLE_CHOICE", {k: v for k, v in mc().items() if k != "explanation"}) == qc.SCHEMA_MISMATCH


def test_objective_is_optional():
    assert check_question("MULTIPLE_CHOICE", mc(), EVIDENCE)["objective"] is None
    assert check_question("MULTIPLE_CHOICE", mc(objective="BFS veri yapısı"), EVIDENCE)["objective"] == "BFS veri yapısı"


# ── true / false ─────────────────────────────────────────────────────────────────────────────
def tf(**over):
    return {"statement": "DFS, bekleyen düğümleri tutmak için kuyruk kullanır.", "is_true": False,
            "quote": "DFS, yığın veya özyineleme kullanır.", "explanation": "Kaynağa göre DFS yığın veya özyineleme kullanır.",
            **over}


def test_true_false_options_and_key_are_built_by_the_server():
    q = check_question("TRUE_FALSE", tf(), EVIDENCE)
    assert q["options"] == ["Doğru", "Yanlış"] and q["expected"] == "1"
    q = check_question("TRUE_FALSE", tf(statement=QUOTE, is_true=True, quote=QUOTE), EVIDENCE, language="en")
    assert q["options"] == ["True", "False"] and q["expected"] == "0"


def test_false_statement_cannot_be_the_source_sentence():
    assert code_of("TRUE_FALSE", tf(statement=QUOTE, quote=QUOTE)) == qc.BAD_FORMAT


def test_is_true_must_be_boolean():
    assert code_of("TRUE_FALSE", tf(is_true="false")) == qc.SCHEMA_MISMATCH


# ── cloze ────────────────────────────────────────────────────────────────────────────────────
def test_cloze_blank_is_written_by_the_server():
    q = check_question("CLOZE", {"quote": QUOTE, "answer": "kuyruk",
                                 "explanation": "BFS bekleyen düğümleri kuyrukta tutar."}, EVIDENCE)
    assert q["question"] == qc.CLOZE_PREFIX["tr"] + "\nBFS, sırada bekleyen düğümleri tutmak için _____ kullanır."
    assert q["expected"] == "kuyruk" and q["options"] == []


def test_cloze_answer_must_occur_exactly_once_in_the_quote():
    base = {"explanation": "Kaynaktaki terim tamamlanır."}
    assert code_of("CLOZE", {**base, "quote": QUOTE, "answer": "yığın"}) == qc.ANSWER_NOT_IN_SOURCE
    # "katman katman": a blank in one of two places is ambiguous
    assert code_of("CLOZE", {**base, "quote": BFS[:160], "answer": "katman"}) == qc.BAD_FORMAT
    once = "DFS, yığın veya özyineleme kullanır."
    assert check_question("CLOZE", {**base, "quote": once, "answer": "yığın"}, EVIDENCE)["expected"] == "yığın"


def test_cloze_must_hide_a_meaningful_term_not_most_of_the_sentence():
    base = {"quote": QUOTE, "explanation": "Kaynaktaki terim tamamlanır."}
    assert code_of("CLOZE", {**base, "answer": "için"}) == qc.BAD_FORMAT
    assert code_of("CLOZE", {**base, "answer": "sırada bekleyen düğümleri tutmak için kuyruk"}) == qc.BAD_FORMAT
    assert code_of("CLOZE", {**base, "answer": "kuyruk", "options": ["a"]}) == qc.BAD_FORMAT


# ── short answer ─────────────────────────────────────────────────────────────────────────────
def test_short_answer_must_be_in_the_quote_and_not_in_the_question():
    base = {"question": "BFS bekleyen düğümleri hangi yapıda tutar?", "quote": QUOTE,
            "explanation": "Kaynak kuyruk kullanıldığını söyler."}
    assert check_question("SHORT_ANSWER", {**base, "answer": "Kuyruk"}, EVIDENCE)["expected"] == "Kuyruk"
    assert code_of("SHORT_ANSWER", {**base, "answer": "yığın"}) == qc.ANSWER_NOT_IN_SOURCE
    assert code_of("SHORT_ANSWER", {**base, "question": "BFS kuyruk ile neyi tutar, açıklayınız?",
                                    "answer": "kuyruk"}) == qc.ANSWER_LEAKED


# ── open ─────────────────────────────────────────────────────────────────────────────────────
def test_open_question_has_no_key_and_needs_a_source_quote():
    base = {"question": "BFS'nin kuyruk kullanmasının ziyaret sırasına etkisini açıklayın.", "quote": QUOTE,
            "explanation": "Kuyruk ilk giren ilk çıkar; bu katman sırasını korur."}
    q = check_question("OPEN", base, EVIDENCE)
    assert q["expected"] == "" and q["options"] == []
    assert code_of("OPEN", {**base, "answer": "Kuyruk"}) == qc.BAD_FORMAT
    assert code_of("OPEN", {**base, "quote": "BFS her zaman en hızlı algoritmadır."}) == qc.QUOTE_NOT_FOUND


# ── calculation ──────────────────────────────────────────────────────────────────────────────
def calc(**over):
    return {"question": "Bir araç 120 km yolu 2,5 saatte alıyor. Ortalama hızı kaç km/sa'tir?",
            "expression": "120 / 2,5", "answer": "48 km/sa", "quote": PHYSICS,
            "explanation": "Ortalama hız toplam yol bölü toplam süredir: 120/2,5 = 48.", **over}


def test_calculation_is_recomputed_and_stored_as_short_answer_variant():
    q = check_question("SHORT_ANSWER", calc(), EVIDENCE, variant="CALCULATION")
    assert (q["kind"], q["variant"], q["expected"], q["source_index"]) == ("SHORT_ANSWER", "CALCULATION", "48", 1)


def test_wrong_arithmetic_is_rejected():
    assert code_of("SHORT_ANSWER", calc(answer="50"), variant="CALCULATION") == qc.CALC_MISMATCH


def test_rounded_answer_is_accepted_to_its_stated_decimals():
    draft = calc(question="Bir araç 100 km yolu 3 saatte alıyor. Ortalama hızı kaç km/sa'tir?",
                 expression="100/3", answer="33,33")
    assert check_question("SHORT_ANSWER", draft, EVIDENCE, variant="CALCULATION")["expected"] == "33.33"
    assert code_of("SHORT_ANSWER", {**draft, "answer": "33"}, variant="CALCULATION") == qc.CALC_MISMATCH


def test_every_number_in_the_expression_must_be_given_in_the_question():
    assert code_of("SHORT_ANSWER", calc(expression="150 / 2,5", answer="60"), variant="CALCULATION") == qc.CALC_DATA_MISSING
    # halves and percentages may appear without being stated
    draft = calc(question="Bir araç 120 km yolu 1 saatte, aynı yolu 3 saatte dönüşte alıyor. Gidişteki hız ile dönüş hızının ortalaması?",
                 expression="(120/1 + 120/3) / 2", answer="80")
    assert check_question("SHORT_ANSWER", draft, EVIDENCE, variant="CALCULATION")["expected"] == "80"


@pytest.mark.parametrize("expression", [
    "__import__('os').system('x')", "abs(-3)", "x * 2", "2 ** 1000", "1 / 0", "9" * 200, "120 if 1 else 2",
])
def test_unsafe_or_unbounded_expressions_are_rejected(expression):
    with pytest.raises(QuizCheckError) as exc:
        qc.safe_eval(expression)
    assert exc.value.code == qc.BAD_FORMAT


def test_safe_eval_understands_common_symbols():
    assert qc.safe_eval("3 × 4 − 2 ÷ 2 + 2^3") == 19
    assert qc.safe_eval("-(1,5 + 0,5)") == -2


def test_answer_with_two_numbers_is_ambiguous():
    assert code_of("SHORT_ANSWER", calc(answer="48 veya 50"), variant="CALCULATION") == qc.BAD_FORMAT


def test_calculation_is_only_a_short_answer_variant():
    assert code_of("MULTIPLE_CHOICE", calc(), variant="CALCULATION") == qc.SCHEMA_MISMATCH
    assert code_of("SHORT_ANSWER", calc(), variant="PROOF") == qc.SCHEMA_MISMATCH


# ── dispatcher / repeats ─────────────────────────────────────────────────────────────────────
def test_non_object_draft_and_unknown_kind():
    assert code_of("MULTIPLE_CHOICE", ["x"]) == qc.SCHEMA_MISMATCH
    assert code_of("ESSAY", mc()) == qc.SCHEMA_MISMATCH


def test_near_duplicate_stems_are_detected():
    assert qc.is_duplicate_stem("BFS bekleyen düğümleri hangi veri yapısında tutar?",
                                ["Bekleyen düğümleri BFS hangi veri yapısında tutar"])
    assert not qc.is_duplicate_stem("DFS hangi yapıyı kullanır?", ["Ortalama hız nasıl hesaplanır?"])
    assert not qc.is_duplicate_stem("ve bir", ["ve bir"])


def test_duplicate_stem_rejects_a_repeated_question():
    existing = ["BFS bekleyen düğümleri hangi veri yapısında tutar?"]
    assert code_of("MULTIPLE_CHOICE", mc(), existing_stems=existing) == qc.DUPLICATE_STEM


def test_failure_codes_are_unique_strings():
    assert len(set(qc.FAILURE_CODES)) == len(qc.FAILURE_CODES) == 14
