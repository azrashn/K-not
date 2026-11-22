"""Does the chosen sentence support a statement or an option? (quiz_truth, no model)"""

import pytest

from knot_rag import quiz_checks as qc
from knot_rag import quiz_truth as qt
from knot_rag.quiz_checks import QuizCheckError, check_question

# The cases a student met in the live test: a false statement keyed "true".
TCP_SENTENCE = "Connection-oriented transport: TCP"
TCP_FALSE = "TCP is a connectionless transport protocol used for reliable data transmission."
GC_SENTENCE = ("Çöp toplayıcı (garbage collector), artık kullanılmayan nesnelerin belleğini otomatik olarak "
               "geri kazanır.")
GC_FALSE = "Java'da artık kullanılmayan nesnelerin belleği el ile serbest bırakılır."
JAVA_OS = "Bu sayede aynı program farklı işletim sistemlerinde değişiklik yapmadan çalışabilir."


@pytest.mark.parametrize("statement,sentence", [
    (TCP_FALSE, TCP_SENTENCE),
    (GC_FALSE, GC_SENTENCE),
    ("TCP is connectionless.", "TCP is connection-oriented: it needs a handshake first."),
    ("Java does not need a compiler.", "The Java compiler (javac) turns source code into bytecode."),
    ("Java'da int tipi 64 bit tutar ve 99 sayısı kullanılır.", "int tipi 32 bitlik tam sayıları tutar."),
    ("UDP is reliable.", "UDP is not reliable: it gives no delivery guarantee."),
])
def test_a_statement_the_sentence_contradicts_or_does_not_carry_is_not_stated(statement, sentence):
    assert not qt.fit(statement, sentence).states


@pytest.mark.parametrize("statement,sentence", [
    ("Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır.", GC_SENTENCE),
    ("Java programları farklı işletim sistemlerinde çalışabilir.", JAVA_OS),
    ("Java'da int tipi 32 bitlik tam sayıları tutar.",
     "int tipi 32 bitlik tam sayıları, double tipi ise 64 bitlik kayan noktalı sayıları tutar."),
    ("UDP is connectionless.", "UDP is connectionless and adds no handshake."),
    ("UDP is not reliable.", "UDP is not reliable: it gives no delivery guarantee."),
])
def test_a_statement_the_sentence_says_is_stated(statement, sentence):
    fit = qt.fit(statement, sentence)
    assert fit.states, fit.describe()


def test_an_opposite_affix_is_caught_both_ways():
    assert qt.fit("TCP is connectionless.", "TCP needs a connection first.").conflicts
    assert qt.fit("TCP needs a connection first.", "TCP is connectionless.").conflicts
    assert not qt.fit("UDP is connectionless.", "UDP is connectionless; TCP needs a connection.").conflicts


def test_microsoft_is_not_microsystems():
    assert not qt.same_word("microsoft", "microsystems")
    assert qt.same_word("belleği", "belleğini") and qt.same_word("program", "programları")
    assert not qt.same_word("tcp", "tcpip") and not qt.same_word("32", "321")


@pytest.mark.parametrize("text,language", [
    ("Which concept in the transport layer allows multiple streams to share one connection?", "en"),
    ("What action does the sender perform?", "en"),
    ("Taşıma katmanının temel amacı nedir?", "tr"),
    ("Java'nın ilk sürümü hangi yıl yayımlandı?", "tr"),
    ("Bir gönderici cihazın görevi nedir?", "tr"),
    ("TCP", None),
    ("UDP baglantisizdir", None),
])
def test_the_language_of_a_stem_is_guessed_only_when_it_is_plain(text, language):
    assert qt.guess_language(text) == language


# ── through the checks ───────────────────────────────────────────────────────────────────────
def tf(statement, is_true, quote):
    return {"statement": statement, "is_true": is_true, "quote": quote,
            "explanation": "Kaynak cümleye göre bu ifade böyledir."}


def code_of(kind, draft, quote, **kw):
    with pytest.raises(QuizCheckError) as exc:
        check_question(kind, draft, [{"text": quote}], **kw)
    return exc.value.code


def test_the_false_tcp_statement_cannot_be_keyed_true():
    # English statement in an English quiz: the live bug (key "Doğru", explanation "connection-oriented").
    draft = tf(TCP_FALSE, True, TCP_SENTENCE)
    assert code_of("TRUE_FALSE", draft, TCP_SENTENCE, language="en") == qc.KEY_NOT_SUPPORTED


def test_the_false_memory_statement_cannot_be_keyed_true():
    assert code_of("TRUE_FALSE", tf(GC_FALSE, True, GC_SENTENCE), GC_SENTENCE) == qc.KEY_NOT_SUPPORTED


def test_the_same_statements_are_accepted_when_keyed_false():
    assert check_question("TRUE_FALSE", tf(GC_FALSE, False, GC_SENTENCE), [{"text": GC_SENTENCE}])["expected"] == "1"
    q = check_question("TRUE_FALSE", tf(TCP_FALSE, False, TCP_SENTENCE), [{"text": TCP_SENTENCE}], language="en")
    assert q["expected"] == "1"


def test_a_true_paraphrase_is_accepted_and_a_false_one_that_the_sentence_still_states_is_not():
    true = "Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."
    assert check_question("TRUE_FALSE", tf(true, True, GC_SENTENCE), [{"text": GC_SENTENCE}])["expected"] == "0"
    assert code_of("TRUE_FALSE", tf(true, False, GC_SENTENCE), GC_SENTENCE) == qc.KEY_NOT_SUPPORTED


def test_a_false_statement_must_still_be_about_the_sentence():
    unrelated = "Python dilinde girinti blokları belirler ve süslü parantez gerekmez."
    assert code_of("TRUE_FALSE", tf(unrelated, False, GC_SENTENCE), GC_SENTENCE) == qc.KEY_NOT_SUPPORTED


def mc(question, options, answer, quote):
    return {"question": question, "options": options, "answer": answer, "quote": quote,
            "explanation": "Kaynak cümle bunu söyler."}


def test_an_option_the_sentence_contradicts_cannot_be_the_key():
    draft = mc("Java'da kullanılmayan nesnelerin belleği nasıl boşaltılır?",
               ["Bellek el ile serbest bırakılır", "Bellek derleyici ile silinir", "Bellek diskte saklanır",
                "Bellek hep sabit tutulur"],
               "Bellek el ile serbest bırakılır", GC_SENTENCE)
    assert code_of("MULTIPLE_CHOICE", draft, GC_SENTENCE) == qc.KEY_NOT_SUPPORTED


def test_two_options_the_sentence_states_equally_are_two_right_answers():
    sentence = "Java, Sun Microsystems tarafından geliştirildi ve Oracle tarafından satın alındı."
    draft = mc("Java ile ilgili hangisi doğrudur?",
               ["Sun Microsystems tarafından geliştirildi", "Oracle tarafından satın alındı",
                "Microsoft tarafından geliştirildi", "IBM tarafından geliştirildi"],
               "Sun Microsystems tarafından geliştirildi", sentence)
    assert code_of("MULTIPLE_CHOICE", draft, sentence) == qc.KEY_NOT_SUPPORTED


def test_microsoft_does_not_count_as_stated_by_a_sentence_about_microsystems():
    sentence = "Java, 1995 yılında Sun Microsystems tarafından geliştirildi."
    draft = mc("Java hangi kuruluşta geliştirildi?", ["Sun Microsystems", "Microsoft", "Oracle", "IBM"],
               "Sun Microsystems", sentence)
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": sentence}])["options"]


def test_a_stem_in_the_wrong_language_is_refused():
    draft = tf("TCP is connection-oriented and needs a handshake.", True,
               "TCP is connection-oriented and needs a handshake first.")
    assert code_of("TRUE_FALSE", draft, draft["quote"], language="tr") == qc.WRONG_LANGUAGE
    assert code_of("TRUE_FALSE", tf("TCP bağlantı yönelimlidir ve el sıkışma gerektirir.", True,
                                    "TCP bağlantı yönelimlidir ve önce el sıkışma gerektirir."),
                   "TCP bağlantı yönelimlidir ve önce el sıkışma gerektirir.", language="en") == qc.WRONG_LANGUAGE


@pytest.mark.parametrize("text,expected", [
    ("Kaynak [3] buna doğrudan işaret eder.", ""),
    ("Çöp toplayıcı belleği geri kazanır. Kaynak [9] buna işaret eder.", "Çöp toplayıcı belleği geri kazanır."),
    ("Çöp toplayıcı belleği otomatik olarak geri kazanır.", "Çöp toplayıcı belleği otomatik olarak geri kazanır."),
])
def test_a_source_number_the_student_never_sees_is_not_shown_in_the_explanation(text, expected):
    assert qc.short_explanation(text) == expected


SOURCE_TEXT = ("Bytecode, Java Sanal Makinesi (JVM) tarafından çalıştırılır. JDK (Java Development Kit) derleyiciyi "
               "ve geliştirme araçlarını içerir. JRE (Java Runtime Environment) ise programları çalıştırmak için "
               "gereken JVM'yi ve kütüphaneleri içerir.")


def test_a_wrong_option_that_is_a_true_sentence_of_the_source_makes_two_right_answers():
    draft = mc("Java programının çalıştırılmasıyla ilgili hangisi doğrudur?",
               ["JRE programları çalıştırmak için gereken JVM'yi ve kütüphaneleri içerir",
                "Bytecode, Java Sanal Makinesi (JVM) tarafından çalıştırılır",
                "Derleyici bytecode dosyalarını silip yeniden yazar",
                "Kütüphaneler programın kendi içinde derlenir"],
               "JRE programları çalıştırmak için gereken JVM'yi ve kütüphaneleri içerir",
               "JRE (Java Runtime Environment) ise programları çalıştırmak için gereken JVM'yi ve kütüphaneleri içerir.")
    assert code_of("MULTIPLE_CHOICE", draft, SOURCE_TEXT) == qc.KEY_NOT_SUPPORTED


def test_short_options_are_not_judged_as_facts():
    sentence = "Java, 1995 yılında Sun Microsystems tarafından geliştirildi."
    draft = mc("Java hangi kuruluşta geliştirildi?", ["Sun Microsystems", "Microsoft", "Oracle", "IBM"],
               "Sun Microsystems", sentence)
    assert check_question("MULTIPLE_CHOICE", draft, [{"text": sentence + " Oracle, Sun'ı sonradan satın aldı."}])


TYPES_SENTENCE = "int tipi 32 bitlik tam sayıları, double tipi ise 64 bitlik ondalıklı sayıları tutar."


def test_a_number_tied_to_the_wrong_part_of_the_sentence_is_a_conflict():
    # 64 is in the sentence, but it is the double's size, not the int's.
    fit = qt.fit("Java'da int tipi 64 bitlik tam sayıları tutar.", TYPES_SENTENCE)
    assert not fit.states and any("belongs to another part" in c for c in fit.conflicts)
    assert qt.misplaced_numbers("Java'da int tipi 64 bitlik tam sayıları tutar.", TYPES_SENTENCE) == ["64"]


@pytest.mark.parametrize("statement", [
    "Java'da int tipi 32 bitlik tam sayıları tutar.",
    "double tipi 64 bitlik ondalıklı sayıları tutar.",
    "Java'da double tipi ise 64 bitlik ondalıklı sayıları tutar.",
    "int tipi 32 bitlik tam sayıları, double tipi ise 64 bitlik ondalıklı sayıları tutar.",
])
def test_a_number_beside_its_own_words_is_not_misplaced(statement):
    assert qt.misplaced_numbers(statement, TYPES_SENTENCE) == []


def test_a_number_with_too_few_words_around_it_is_not_judged():
    assert qt.misplaced_numbers("1995 yılında.", "Java 1995 yılında yayımlandı.") == []
