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
