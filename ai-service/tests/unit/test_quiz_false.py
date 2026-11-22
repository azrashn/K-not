"""A false statement made from a true one (quiz_false + quiz_checks.make_false), and cut or garbled options."""

import pytest

from knot_rag import quiz_checks as qc
from knot_rag import quiz_false as qf
from knot_rag import quiz_truth as qt
from knot_rag.quiz_checks import QuizCheckError, check_question

GC = "Çöp toplayıcı (garbage collector), artık kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."
TRUE_GC = "Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."
TYPES = "int tipi 32 bitlik tam sayıları, double tipi ise 64 bitlik ondalıklı sayıları tutar."


def true_result(statement, quote, **over):
    return {"kind": "TRUE_FALSE", "question": statement, "options": ["Doğru", "Yanlış"], "expected": "0",
            "quote": quote, "source_index": 1, "explanation": "Kaynak bunu söyler.", "objective": None, **over}


def test_an_opposite_word_is_swapped_first_and_keeps_the_capital():
    made = qc.make_false(true_result(TRUE_GC, GC))
    assert made["expected"] == "1" and "el ile" in made["question"] and "otomatik" not in made["question"]
    assert made["constructed_false"].startswith("swap:")
    assert not qt.fit(made["question"], GC).states


def test_the_explanation_quotes_the_true_statement_so_it_always_matches_the_key():
    made = qc.make_false(true_result(TRUE_GC, GC))
    assert made["explanation"].startswith("Kaynağa göre doğrusu şöyledir: Çöp toplayıcı")
    en = qc.make_false(true_result("TCP is connection-oriented.", "TCP is connection-oriented: it needs a handshake."),
                       "en")
    assert en["explanation"].startswith("According to the source: TCP is connection-oriented")
    assert "connectionless" in en["question"]


def test_a_number_is_changed_to_one_the_sentence_does_not_have():
    made = qc.make_false(true_result("Java'da int tipi 32 bitlik tam sayıları tutar.", TYPES))
    assert made and made["expected"] == "1"
    assert "32" not in made["question"] or made["constructed_false"].startswith("negate")
    sentence = "Java'nın ilk sürümü 1995 yılında yayımlandı."
    year = qc.make_false(true_result("Java'nın ilk sürümü 1995 yılında yayımlandı.", sentence))
    assert year and "1995" not in year["question"] or year["constructed_false"].startswith(("swap", "negate"))


def test_a_verb_is_negated_when_no_opposite_word_or_number_fits():
    sentence = "BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır."
    made = qc.make_false(true_result("BFS, sırada bekleyen düğümleri tutmak için kuyruk yapısını kullanır.", sentence))
    assert made["constructed_false"].startswith("negate:") and "kullanmaz" in made["question"]


def test_a_closing_copula_becomes_degildir():
    sentence = "Java nesne yönelimli bir programlama dilidir."
    made = qc.make_false(true_result("Java, nesne yönelimli bir programlama dilidir.", sentence))
    assert made["question"].endswith("dili değildir.") or "değil" in made["question"]


def test_nothing_possible_leaves_the_statement_alone():
    sentence = "Yığın yapısında son giren eleman ilk çıkar."
    assert qc.make_false(true_result("Yığın yapısında eleman girişi ve çıkışı tek uçtan gerçekleşir.", sentence)) is None


def test_only_a_true_true_false_question_can_be_made_false():
    assert qc.make_false(true_result(TRUE_GC, GC, expected="1")) is None
    assert qc.make_false(true_result(TRUE_GC, GC, kind="MULTIPLE_CHOICE")) is None


@pytest.mark.parametrize("statement,sentence", [
    (TRUE_GC, GC),
    ("Java, nesne yönelimli bir programlama dilidir.", "Java nesne yönelimli bir programlama dilidir."),
    ("TCP güvenilir veri aktarımı sağlar.", "TCP, süreçler arasında güvenilir veri aktarımı sağlar."),
    ("UDP bağlantısızdır ve el sıkışma yapmaz.", "UDP bağlantısızdır; gönderici ile alıcı arasında el sıkışma yapılmaz."),
])
def test_every_candidate_that_is_kept_is_no_longer_stated_by_the_sentence(statement, sentence):
    made = qc.make_false(true_result(statement, sentence))
    if made:  # a statement with nothing to change is allowed to stay true
        assert not qt.fit(made["question"], sentence).states or qt.fit(made["question"], sentence).new_terms


def test_the_candidates_never_repeat_the_original():
    got = list(qf.candidates(TRUE_GC, GC))
    assert got and all(text.strip() != TRUE_GC for text, _ in got)


# ── options cut out of a sentence ────────────────────────────────────────────────────────────
SOURCE = "Java'da sekiz ilkel veri tipi vardır: byte, short, int, long, float, double, char ve boolean."


def mc(options, answer):
    return {"question": "Java'da hangi ilkel veri tipi iki değer alır?", "options": options, "answer": answer,
            "quote": SOURCE, "explanation": "Kaynak boolean tipinden söz eder."}


@pytest.mark.parametrize("bad", [
    "g, float, double, char ve boolean veri tipleridir",     # starts mid-word
    "ve boolean veri tipi iki değer alır",                    # starts with a conjunction
    "boolean veri tipi iki değer alır ve",                    # stops on a conjunction
    "int tipi 3-than 32 bitlik ondalıklı sayıları tutar",    # a made-up word
])
def test_an_option_that_looks_cut_or_garbled_is_refused(bad):
    options = ["boolean veri tipi iki değer alır", bad, "string veri tipi metin tutar", "char veri tipi harf tutar"]
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", mc(options, options[0]), [{"text": SOURCE}])
    assert exc.value.code == qc.BAD_FORMAT and "option 2" in exc.value.detail


def test_whole_options_pass():
    options = ["boolean", "string", "karakter", "tarih"]
    assert check_question("MULTIPLE_CHOICE", mc(options, "boolean"), [{"text": SOURCE}])["options"]


def test_a_hyphenated_number_word_that_the_source_has_is_not_garbled():
    source = SOURCE + " Bellek 8-bit kelimelerle ölçülür."
    options = ["boolean", "8-bit kelimeler", "string", "karakter"]
    draft = {**mc(options, "boolean"), "quote": SOURCE}
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": source}])["options"]


# ── the stem must say which statement to pick ────────────────────────────────────────────────
STATEMENTS_SOURCE = "String ise ilkel bir tip değildir; karakter dizilerini tutan bir sınıftır."


def statement_options(question):
    options = ["String ilkel bir tip değildir ve karakter dizisi tutar", "String tipi iki değer alan mantıksal bir veridir",
               "String tipi 64 bitlik tam sayıları tutan bir veridir", "String tipi yalnızca sayısal ifadeleri saklayan bir sınıftır"]
    return {"question": question, "options": options, "answer": options[0], "quote": STATEMENTS_SOURCE,
            "explanation": "Kaynak, String'in ilkel olmadığını söyler."}


@pytest.mark.parametrize("question", [
    "String veri tipi hakkında ne söylenir?",
    "Aşağıdakilerden hangisi String veri tipiyle ilgili doğrudan bilgi verir?",
    "String tipi nasıl bir veridir?",
])
def test_a_stem_that_does_not_say_which_statement_to_pick_gets_the_cue_with_the_topic(question):
    options = statement_options(question)["options"]
    fixed, changed = qc.with_truth_cue(question, options, "Veri Tipleri")
    assert changed and fixed == "Veri Tipleri ile ilgili aşağıdakilerden hangisi doğrudur?"
    en, _ = qc.with_truth_cue(question, options, "Data types", "en")
    assert en == "Which of the following is true about Data types?"


@pytest.mark.parametrize("question", [
    "Aşağıdakilerden hangisi String veri tipi için doğrudur?",
    "String veri tipiyle ilgili hangisi yanlıştır?",
])
def test_a_stem_with_the_cue_and_questions_over_short_options_are_left_alone(question):
    options = statement_options(question)["options"]
    assert qc.with_truth_cue(question, options, "Veri Tipleri") == (question, False)
    assert qc.with_truth_cue("Java hangi yıl yayımlandı?", ["1995", "1990", "2000", "1985"], "Java") == (
        "Java hangi yıl yayımlandı?", False)


# ── an answer that plainly is one of the options ──────────────────────────────────────────────
def test_an_answer_written_with_another_ending_or_a_dropped_word_is_the_option_it_means():
    options = ["String ilkel bir tip değildir ve karakter dizisi tutar", "String mantıksal bir veridir",
               "String tam sayıları tutan bir veridir", "String yalnızca sayısal ifadeleri saklar"]
    assert qc.closest_option("String ilkel bir tip değildir", options) == 0
    assert qc.closest_option("String ilkel tip değildir ve karakter dizisi tutar", options) == 0
    assert qc.closest_option("Java programlama dili", options) is None
    # two options equally close: no winner, the answer stays "not among the options"
    assert qc.closest_option("String veridir", ["String mantıksal veridir", "String sayısal veridir"]) is None


def test_such_an_answer_keeps_the_question_instead_of_failing_it():
    draft = statement_options("Aşağıdakilerden hangisi String için doğrudur?")
    draft["answer"] = "String ilkel bir tip değildir"
    q = check_question("MULTIPLE_CHOICE", draft, [{"text": STATEMENTS_SOURCE}])
    assert q["options"][int(q["expected"])] == "String ilkel bir tip değildir ve karakter dizisi tutar"


# ── a later try: the correct option may be the longest ────────────────────────────────────────
def test_a_later_try_lets_a_long_correct_option_through():
    source = "Java'da çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."
    long_one = "Kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır"
    draft = {"question": "Çöp toplayıcı ne yapar?", "quote": source, "explanation": "Kaynak bunu söyler.",
             "options": [long_one, "Dosyaları derleyip çalıştırır", "Sınıf tanımlarını silip yazar",
                         "Veriyi diske yazıp saklar"], "answer": long_one}
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", draft, [{"text": source}])
    assert exc.value.code == qc.BAD_FORMAT and "longest" in exc.value.detail
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": source}], relaxed=True)["options"]


@pytest.mark.parametrize("question", [
    "Aşağıdakilerden hangisi String veri tipi için doğrudur?",
    "String veri tipiyle ilgili hangisi yanlıştır?",
    "Aşağıdakilerden hangisi String için geçerli değildir?",
])
def test_a_question_that_names_the_kind_passes(question):
    assert check_question("MULTIPLE_CHOICE", statement_options(question), [{"text": STATEMENTS_SOURCE}])["options"]


def test_short_options_need_no_cue():
    source = "Java, 1995 yılında yayımlandı."
    draft = {"question": "Java'nın ilk sürümü hangi yıl yayımlandı?", "options": ["1995", "1990", "2000", "1985"],
             "answer": "1995", "quote": source, "explanation": "Kaynak 1995 der."}
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": source}])["options"]


def test_an_option_cut_at_ya_da_is_refused():
    options = ["boolean tipi yalnızca true ya", "boolean tipi sadece sayı alır", "boolean tipi metin tutar",
               "boolean tipi tarih saklar"]
    draft = {"question": "Java'da boolean veri tipiyle ilgili hangisi doğrudur?", "options": options, "answer": options[0],
             "quote": "boolean tipi yalnızca true ya da false değerlerini alabilir.", "explanation": "Kaynak bunu söyler."}
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", draft, [{"text": draft["quote"]}])
    assert exc.value.code == qc.BAD_FORMAT and "cut out" in exc.value.detail


def test_a_size_becomes_its_neighbouring_size_not_a_strange_number():
    sentence = "int tipi 32 bitlik tam sayıları, double tipi ise 64 bitlik ondalıklı sayıları tutar."
    made = qc.make_false(true_result("Java'da int tipi 32 bitlik tam sayıları tutar.", sentence))
    assert made and "64 bitlik" in made["question"] and "33" not in made["question"]
    assert not qt.fit(made["question"], sentence).states  # 64 belongs to the double


def test_a_used_sentence_may_carry_a_second_question_in_a_relaxed_try():
    draft = statement_options("Aşağıdakilerden hangisi String için doğrudur?")
    used = [STATEMENTS_SOURCE]
    with pytest.raises(QuizCheckError) as exc:
        check_question("MULTIPLE_CHOICE", draft, [{"text": STATEMENTS_SOURCE}], used_quotes=used)
    assert exc.value.code == qc.DUPLICATE_QUOTE
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": STATEMENTS_SOURCE}], used_quotes=used, relaxed=True)


# ── a multiple-choice question built from one true statement ──────────────────────────────────
COURSE = ("Java, 1995 yılında yayımlandı. Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri "
          "kazanır. Java nesne yönelimli bir programlama dilidir. JVM, bytecode'u her platformda çalıştırır.")
GC_TRUE = "Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."


def test_three_different_false_variants_come_from_the_statement_and_the_other_sentences():
    pool = qc.evidence_sentences([{"text": COURSE}])
    got = qf.false_variants(GC_TRUE, GC_TRUE, pool)
    assert len(got) == 3 and len({g.lower() for g in got}) == 3 and GC_TRUE not in got
    assert any("el ile" in g for g in got) and any("kazanmaz" in g for g in got)
    for variant in got[:2]:
        assert not qt.fit(variant, GC_TRUE).states


def test_a_multiple_choice_question_is_built_with_the_true_statement_as_the_only_right_option():
    built = qc.build_choice(true_result(GC_TRUE, GC_TRUE), "Bellek Yönetimi", "tr", [{"text": COURSE}])
    assert built["kind"] == "MULTIPLE_CHOICE" and built["constructed_choice"] is True
    assert built["question"] in [t.format(topic="Bellek Yönetimi") for t in qc.CHOICE_STEMS["tr"]]
    assert len(built["options"]) == 4 and built["options"][int(built["expected"])] == GC_TRUE
    assert built["explanation"].startswith("Kaynağa göre doğru ifade şudur: Çöp toplayıcı")
    others = [o for i, o in enumerate(built["options"]) if i != int(built["expected"])]
    assert all(not qt.fit(o, GC_TRUE).states or qt.fit(o, GC_TRUE).new_terms for o in others[:2])


def test_the_built_options_are_the_same_every_time_for_the_same_statement():
    a = qc.build_choice(true_result(GC_TRUE, GC_TRUE), "Bellek", "tr", [{"text": COURSE}])
    b = qc.build_choice(true_result(GC_TRUE, GC_TRUE), "Bellek", "tr", [{"text": COURSE}])
    assert a["options"] == b["options"] and a["expected"] == b["expected"]


def test_nothing_is_built_when_three_false_options_cannot_be_made_or_the_result_is_not_true():
    plain = "Yığın yapısında elemanlar tek uçtan eklenir ve silinir."  # nothing the server knows how to change
    assert qc.build_choice(true_result(plain, plain), "Bellek", "tr", [{"text": plain}]) is None
    assert qc.build_choice(true_result(GC_TRUE, GC_TRUE, expected="1"), "Bellek", "tr", [{"text": COURSE}]) is None


def test_a_sentence_cut_from_the_middle_of_another_one_is_not_used_for_an_option():
    pool = ["verilere yalnızca metotlar aracılığıyla erişilmesini sağlar.", "Java nesne yönelimli bir programlama dilidir.",
            "JVM, bytecode'u her platformda çalıştırır."]
    got = qf.false_variants(GC_TRUE, GC_TRUE, pool)
    assert got and not any(g.startswith("verilere") for g in got)
