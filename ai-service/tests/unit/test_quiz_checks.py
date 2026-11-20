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


@pytest.mark.parametrize("labels", [
    ["a) ", "b) ", "c) ", "d) "], ["A) ", "B) ", "C) ", "D) "], ["a. ", "b. ", "c. ", "d. "],
    ["A - ", "B - ", "C - ", "D - "], ["(a) ", "(b) ", "(c) ", "(d) "], ["a)", "b)", "c)", "d)"],
])
@pytest.mark.parametrize("answer", ["{label}Kuyruk", "Kuyruk", "{letter}", "{letter})"])
def test_letter_labels_are_removed_from_options_and_answer(labels, answer):
    """Mac trial: "a) javac, c) jvm, d) jar, b) java" after the shuffle."""
    options = [label + text for label, text in zip(labels, ["Kuyruk", "Yığın", "İkili ağaç", "Karma tablosu"])]
    answer = answer.format(label=labels[0], letter=labels[0].strip(" ()-.")[0])
    q = check_question("MULTIPLE_CHOICE", mc(options=options, answer=answer), EVIDENCE)
    assert sorted(q["options"]) == sorted(["Kuyruk", "Yığın", "İkili ağaç", "Karma tablosu"])
    assert q["options"][int(q["expected"])] == "Kuyruk"


def test_labels_are_kept_when_not_every_option_has_one():
    # "C - dili" alone is a real option, not a label.
    options, answer = qc.strip_option_labels(["C - dili", "Java", "Python", "Go"], "Java")
    assert options == ["C - dili", "Java", "Python", "Go"] and answer == "Java"
    assert qc.strip_option_labels(["C-dili", "a)x", "b)y", "c)z"], "a)x")[0][0] == "C-dili"


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


@pytest.mark.parametrize("statement", [QUOTE, QUOTE.rstrip("."), "  " + QUOTE.upper() + "  "])
def test_the_whole_source_sentence_marked_false_is_corrected_to_true(statement):
    q = check_question("TRUE_FALSE", tf(statement=statement, quote=QUOTE,
                                        explanation="Kaynağa göre bu ifade yanlıştır, çünkü değişmiştir."), EVIDENCE)
    assert q["expected"] == "0"  # Doğru
    assert q[qc.CORRECTIONS_KEY] == [qc.COPIED_FALSE_TO_TRUE]
    assert q["explanation"] == qc.TRUE_COPY_EXPLANATION["tr"]  # not the model's "false" reasoning


def test_part_of_the_source_sentence_marked_false_is_still_rejected():
    # Cut words can change the meaning ("kullanır" → "kullan…"): neither key is safe.
    part = "BFS, sırada bekleyen düğümleri tutmak için kuyruk"
    assert code_of("TRUE_FALSE", tf(statement=part, quote=QUOTE)) == qc.BAD_FORMAT


def test_a_copied_true_statement_and_a_real_false_one_are_not_corrected():
    q = check_question("TRUE_FALSE", tf(statement=QUOTE, is_true=True, quote=QUOTE), EVIDENCE)
    assert q["expected"] == "0" and qc.CORRECTIONS_KEY not in q
    q = check_question("TRUE_FALSE", tf(), EVIDENCE)
    assert q["expected"] == "1" and qc.CORRECTIONS_KEY not in q


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
    assert check_question("SHORT_ANSWER", draft, EVIDENCE, variant="CALCULATION")["expected"] == "33,33"
    assert code_of("SHORT_ANSWER", {**draft, "answer": "33"}, variant="CALCULATION") == qc.CALC_MISMATCH


@pytest.mark.parametrize("text,numbers", [
    ("1.000 kg", [1000.0]),
    ("25.000.000 TL", [25000000.0]),
    ("3,5 saat", [3.5]),
    ("12.345,6 m", [12345.6]),
    ("1.5 kat", [1.5]),           # not a three-digit group: decimal point
    ("12.3456", [12.3456]),
    ("1.000 ve 2,5 ve 7", [1000.0, 2.5, 7.0]),
])
def test_turkish_numbers_use_dot_thousands_and_comma_decimals(text, numbers):
    assert qc._numbers(text, "tr") == numbers


@pytest.mark.parametrize("text,numbers", [
    ("1.000 kg", [1.0]),          # English keeps the previous reading
    ("3,5 h", [3.5]),
    ("2.75 m", [2.75]),
])
def test_english_numbers_keep_the_previous_behaviour(text, numbers):
    assert qc._numbers(text, "en") == numbers


def test_turkish_thousands_in_expressions():
    assert qc.safe_eval("25.000.000 / 1.000", "tr") == 25000
    assert qc.safe_eval("12.345,5 * 2", "tr") == 24691
    assert qc.safe_eval("1.000 * 2", "en") == 2


def test_turkish_calculation_with_thousands_end_to_end():
    draft = calc(question="Bir araç 1.200 km yolu 2,5 saatte alıyor. Ortalama hızı kaç km/sa'tir?",
                 expression="1.200 / 2,5", answer="480 km/sa")
    assert check_question("SHORT_ANSWER", draft, EVIDENCE, variant="CALCULATION")["expected"] == "480"
    big = calc(question="Bir şirket 25.000.000 TL'yi 4 bölüme eşit dağıtıyor. Bölüm başına kaç TL düşer?",
               expression="25.000.000 / 4", answer="6.250.000 TL")
    assert check_question("SHORT_ANSWER", big, EVIDENCE, variant="CALCULATION")["expected"] == "6250000"
    rounded = calc(question="Bir araç 1.000 km yolu 3 saatte alıyor. Ortalama hızı kaç km/sa'tir?",
                   expression="1.000 / 3", answer="333,33")
    assert check_question("SHORT_ANSWER", rounded, EVIDENCE, variant="CALCULATION")["expected"] == "333,33"
    one_decimal = {**rounded, "answer": "333,3"}
    assert check_question("SHORT_ANSWER", one_decimal, EVIDENCE, variant="CALCULATION")["expected"] == "333,3"
    assert code_of("SHORT_ANSWER", {**rounded, "answer": "333,4"}, variant="CALCULATION") == qc.CALC_MISMATCH


def test_english_calculation_keeps_dot_decimals():
    draft = calc(question="A car covers 100 km in 3 hours. What is its average speed in km/h?",
                 expression="100/3", answer="33.33")
    assert check_question("SHORT_ANSWER", draft, EVIDENCE, variant="CALCULATION", language="en")["expected"] == "33.33"


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
    assert len(set(qc.FAILURE_CODES)) == len(qc.FAILURE_CODES) == 17
    assert {qc.TRUNCATED, qc.NOT_SELF_CONTAINED, qc.DUPLICATE_QUOTE} <= set(qc.FAILURE_CODES)


@pytest.mark.parametrize("text,expected", [
    ("Kaynak kuyruğu açıkça anlatır. İkinci cümle gereksizdir.", "Kaynak kuyruğu açıkça anlatır."),
    ("Doğru. Kaynak, BFS'nin kuyruk kullandığını söyler.", "Doğru. Kaynak, BFS'nin kuyruk kullandığını söyler."),
    ("  Satır\nsonları   ve boşluklar sadeleşir.  ", "Satır sonları ve boşluklar sadeleşir."),
    ("Noktasız kısa açıklama", "Noktasız kısa açıklama"),
])
def test_short_explanation_keeps_one_sentence(text, expected):
    assert qc.short_explanation(text) == expected


def test_short_explanation_cuts_a_long_sentence_at_a_word():
    out = qc.short_explanation("kelime " * 60)
    assert len(out) <= qc.EXPLANATION_MAX and out.endswith("kelime…")


# ── open questions ask something ─────────────────────────────────────────────────────────────
OPEN_BASE = {"quote": QUOTE, "explanation": "Kuyruk ilk giren ilk çıkar; bu katman sırasını korur."}


def test_a_plain_statement_is_not_an_open_question():
    draft = {**OPEN_BASE, "question": "BFS, bekleyen düğümleri kuyrukta tutan bir arama yöntemidir."}
    with pytest.raises(QuizCheckError) as exc:
        check_question("OPEN", draft, EVIDENCE)
    assert exc.value.code == qc.BAD_FORMAT and "plain statement" in exc.value.detail


@pytest.mark.parametrize("question", [
    "BFS neden kuyruk kullanır?",
    "BFS neden kuyruk kullanır ? ",
    "BFS'nin kuyruk kullanmasının ziyaret sırasına etkisini açıklayınız.",
    "BFS ile DFS'nin bekleyen düğümleri tutma biçimini karşılaştırınız.",
    "BFS'nin kuyruk kullanımına bir örnek veriniz.",
    "BFS kuyruğu nasıl kullanır, kısaca yazın.",
    "BFS KUYRUĞU NEDEN KULLANIR, AÇIKLAYINIZ",
    "Explain why BFS keeps waiting nodes in a queue.",
])
def test_a_question_or_an_instruction_is_an_open_question(question):
    assert check_question("OPEN", {**OPEN_BASE, "question": question}, EVIDENCE)["question"] == question.strip()


# ── stems understandable on their own ────────────────────────────────────────────────────────
@pytest.mark.parametrize("kind,draft", [
    ("TRUE_FALSE", tf(statement="Bu yöntem bekleyen düğümleri tutmak için kuyruk kullanır.")),
    ("TRUE_FALSE", tf(statement="O, bekleyen düğümleri tutmak için kuyruk kullanır.")),
    ("TRUE_FALSE", tf(statement="Ardından bekleyen düğümler kuyrukta tutulur.")),
    ("TRUE_FALSE", tf(statement="Daha sonra bekleyen düğümler kuyrukta tutulur.")),
    ("TRUE_FALSE", tf(statement="“Böylece bekleyen düğümler kuyrukta tutulur.”")),
    ("MULTIPLE_CHOICE", mc(question="Bunlar bekleyen düğümleri hangi veri yapısında tutar?")),
    ("SHORT_ANSWER", {"question": "Şu algoritma bekleyen düğümleri hangi yapıda tutar?", "answer": "kuyruk",
                      "quote": QUOTE, "explanation": "Kaynak, BFS'nin kuyruk kullandığını söyler."}),
    ("OPEN", {**OPEN_BASE, "question": "Bu yaklaşımın ziyaret sırasına etkisini açıklayınız."}),
])
def test_a_stem_that_points_at_an_earlier_sentence_is_rejected(kind, draft):
    with pytest.raises(QuizCheckError) as exc:
        check_question(kind, draft, EVIDENCE)
    assert exc.value.code == qc.NOT_SELF_CONTAINED


@pytest.mark.parametrize("text", [
    "O(n log n) karmaşıklığa sahip sıralama algoritması hangisidir?",
    "Oyun ağacında BFS hangi yapıyı kullanır?",
    "Bulut bilişimde BFS hangi yapıyı kullanır?",
    "Sonraki düğüm kuyruktan alınır mı?",
    "Burak'ın kodunda BFS hangi yapıyı kullanır?",
])
def test_a_stem_that_names_its_subject_is_self_contained(text):
    qc.check_self_contained(text)  # no exception


def test_a_cloze_stem_is_the_source_sentence_and_is_not_checked():
    evidence = [{"text": "Bu nedenle BFS, bekleyen düğümleri tutmak için kuyruk kullanır."}]
    draft = {"quote": evidence[0]["text"], "answer": "kuyruk", "explanation": "Kaynak, BFS'nin kuyruk kullandığını söyler."}
    assert check_question("CLOZE", draft, evidence)["kind"] == "CLOZE"


# ── Turkish roots in repeat avoidance (Azra's report: "açalım/açmak", "sürecinde/sürecinin") ─────
@pytest.mark.parametrize("a, b", [
    ("açalım", "açmak"), ("sürecinde", "sürecinin"), ("bellek", "belleği"), ("kuyruk", "kuyruğu"),
    ("ağaç", "ağacı"), ("derledi", "derlemek"), ("Bellek", "BELLEĞİ"), ("aracı", "araç"),
])
def test_inflections_of_one_word_share_a_root(a, b):
    assert qc.same_root(a, b) and qc.same_root(b, a)


@pytest.mark.parametrize("a, b", [
    ("dizi", "dizin"), ("veri", "verim"), ("açık", "açmak"), ("kedi", "kemik"), ("bellek", "bytecode"),
])
def test_different_words_do_not_share_a_root(a, b):
    assert not qc.same_root(a, b)


def test_a_short_root_counts_only_when_both_words_are_verbs():
    assert qc.same_root("açalım", "açmak")       # both verb endings: aç-
    assert not qc.same_root("açalım", "açı")     # açı is a noun: no 2-letter root comparison


def test_repeats_that_differ_only_in_suffixes_are_detected():
    assert qc.is_duplicate_stem("Java dosyasını nasıl açalım?", ["Java dosyasını açmak için ne yapılır?"])
    assert qc.is_duplicate_stem("Derleme sürecinde hangi araç kullanılır?",
                                ["Derleme sürecinin hangi aracı kullanılır?"])
    assert not qc.is_duplicate_stem("Derleme sürecinde hangi araç kullanılır?",
                                    ["Çöp toplayıcı belleği ne zaman boşaltır?"])


# ── one source sentence carries one question ─────────────────────────────────────────────────
def test_a_sentence_used_by_an_earlier_question_is_rejected():
    assert code_of("MULTIPLE_CHOICE", mc(), used_quotes=[QUOTE]) == qc.DUPLICATE_QUOTE
    assert code_of("MULTIPLE_CHOICE", mc(), used_quotes=["  bfs, sırada bekleyen düğümleri tutmak için kuyruk "
                                                         "kullanır"]) == qc.DUPLICATE_QUOTE
    assert check_question("MULTIPLE_CHOICE", mc(), EVIDENCE, used_quotes=[PHYSICS])["quote"] == QUOTE


def test_duplicate_quote_is_a_failure_code():
    assert qc.DUPLICATE_QUOTE in qc.FAILURE_CODES


# ── multiple choice: one question, options alike (Azra's report: the Java question) ─────────────
JAVA = "Java, 1995 yılında Sun Microsystems tarafından geliştirildi."
JAVA_EVIDENCE = [{"text": JAVA}]


def java(**over):
    return {"question": "Java hangi kuruluşta geliştirildi?",
            "options": ["Sun Microsystems", "Microsoft", "Oracle", "IBM"], "answer": "Sun Microsystems",
            "quote": JAVA, "explanation": "Kaynak, Java'yı Sun Microsystems'in geliştirdiğini söyler.", **over}


def java_error(**over):
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", java(**over), JAVA_EVIDENCE)
    return exc.value


def test_the_java_question_from_the_report_fails_on_all_three_rules():
    report = java(question="Java hangi dönemde ve hangi kuruluşta geliştirildi?",
                  options=["1995 yılında Sun Microsystems bünyesinde", "Microsoft", "Oracle", "IBM"],
                  answer="1995 yılında Sun Microsystems bünyesinde")
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", report, JAVA_EVIDENCE)
    assert exc.value.code == qc.BAD_FORMAT
    correct, wrong = report["answer"], ["Microsoft", "Oracle", "IBM"]
    with pytest.raises(QuizCheckError, match="two things"):
        qc.check_option_balance(report["question"], correct, wrong)
    with pytest.raises(QuizCheckError, match="longest"):
        qc.check_option_balance("Java hangi kuruluşta geliştirildi?", correct, wrong)
    with pytest.raises(QuizCheckError, match="number"):
        qc.check_option_balance("Java hangi kuruluşta geliştirildi?", "Sun 1995", wrong)


@pytest.mark.parametrize("question", [
    "Java hangi dönemde ve hangi kuruluşta geliştirildi?",
    "Java ne zaman ve kim tarafından geliştirildi?",
    "Which company developed Java and when was it released?",
])
def test_a_question_asking_two_things_is_rejected(question):
    error = java_error(question=question)
    assert error.code == qc.BAD_FORMAT and "two things" in error.detail


@pytest.mark.parametrize("question", [
    "Java ve C# arasındaki ortak özellik hangisidir?",   # one question word, "ve" joins two nouns
    "Java hangi kuruluşta geliştirildi?",
    "Hangi kuruluş Java'yı geliştirdi ve dağıttı?",      # "ve" joins two verbs, one question
    "Hangi element ve kimyasal bileşik sudur?",          # kimyasal is not "kim"
])
def test_a_single_question_with_ve_is_accepted(question):
    qc.check_option_balance(question, "Sun Microsystems", ["Microsoft", "Oracle", "IBM"])


def test_the_correct_option_may_not_be_clearly_the_longest():
    # Not 4x the shortest option (the older balance rule), but 1.5x and 16 characters over the longest wrong one.
    error = java_error(options=["Sun Microsystems mühendis ekibi", "Microsoft Corp.", "Oracle Labs", "IBM Research"],
                       answer="Sun Microsystems mühendis ekibi")
    assert error.code == qc.BAD_FORMAT and "longest" in error.detail


def test_a_longer_correct_option_within_the_limits_is_accepted():
    # Over 1.5x but only a few characters longer (short options); long but within 1.5x.
    qc.check_option_balance("Hangi yapı?", "Kuyruk", ["Yığn", "Ağaç", "Liste"])
    qc.check_option_balance("Hangi kuruluş?", "Sun Microsystems Inc.", ["Microsoft Corp.", "Oracle Corp.", "IBM Corp."])


def test_only_the_correct_option_with_a_number_is_rejected():
    error = java_error(question="Java ilk sürümü hangi yılda çıktı?",
                       options=["1995", "Sun döneminde", "Oracle döneminde", "IBM döneminde"], answer="1995")
    assert error.code == qc.BAD_FORMAT and "number" in error.detail


def test_options_of_the_same_type_pass():
    q = check_question("MULTIPLE_CHOICE", java(question="Java hangi yılda geliştirildi?",
                                               options=["1995", "1985", "2001", "1979"], answer="1995"),
                       JAVA_EVIDENCE)
    assert sorted(q["options"]) == ["1979", "1985", "1995", "2001"]
    assert check_question("MULTIPLE_CHOICE", java(), JAVA_EVIDENCE)["quote"] == JAVA
