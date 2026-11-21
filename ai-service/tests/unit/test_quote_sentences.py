"""Numbered sentences (quote_id) are whole sentences: a PDF line break inside a sentence does not cut it."""

import pytest

from knot_rag import quiz_engine as qe

# PDF text as extracted: lines break inside sentences.
JAVAC = ("Java kaynak kodu .java uzantılı dosyalara yazılır. Derleyici (javac) bu kodu\n"
         "bytecode'a çevirir ve .class uzantılı dosyalar üretir.")
GOSLING = ("Java, 1990'ların başında Sun Microsystems'te James Gosling liderliğindeki\n"
           "Green Team ekibi tarafından geliştirildi. İlk adı Oak idi.")
TYPES = ("Java'da sekiz ilkel veri tipi vardır: byte, short, int, long, float, double, char ve\n"
         "boolean. Referans tipler ise nesneleri gösterir.")


def reads(text):
    sentences = qe.number_sentences([{"source": 1, "text": text}])
    for s in sentences:
        assert s["text"] in text  # the quote stays an exact piece of the source
    return [s["read"] for s in sentences]


@pytest.mark.parametrize("text, whole", [
    (JAVAC, "Derleyici (javac) bu kodu bytecode'a çevirir ve .class uzantılı dosyalar üretir."),
    (GOSLING, "Java, 1990'ların başında Sun Microsystems'te James Gosling liderliğindeki Green Team ekibi "
              "tarafından geliştirildi."),
    (TYPES, "Java'da sekiz ilkel veri tipi vardır: byte, short, int, long, float, double, char ve boolean."),
])
def test_a_line_break_inside_a_sentence_does_not_cut_it(text, whole):
    assert whole in reads(text)


def test_the_quote_is_the_whole_sentence_as_written_in_the_source():
    sentences = qe.number_sentences([{"source": 1, "text": JAVAC}])
    draft = qe.resolve_quote({"quote_id": 2, "question": "?"}, sentences)
    assert draft["quote"] == "Derleyici (javac) bu kodu\nbytecode'a çevirir ve .class uzantılı dosyalar üretir."
    # The model reads it on one line, with its number.
    assert "[2] Derleyici (javac) bu kodu bytecode'a çevirir" in qe.numbered_sources(sentences)[0]["text"]


def test_a_line_end_hyphen_joins_the_word_for_the_model():
    assert reads("Java, Sun Microsystems tarafından geliş-\ntirildi ve 1995'te yayımlandı.") == [
        "Java, Sun Microsystems tarafından geliştirildi ve 1995'te yayımlandı."]
    assert qe.reflow("bilgi-\n  sayar  ve\tyazılım") == "bilgisayar ve yazılım"
    assert qe.reflow("Ali - Veli") == "Ali - Veli"  # a dash between words is not a line-end hyphen


def test_numbers_and_abbreviations_do_not_end_a_sentence():
    assert reads("Generics, Java 1.5 sürümüyle geldi ve tür güvenliği sağladı. Sonra lambda geldi, Java 8 ile.") == [
        "Generics, Java 1.5 sürümüyle geldi ve tür güvenliği sağladı.", "Sonra lambda geldi, Java 8 ile."]
    assert reads("Sayısal tipler (int, long vb.) Java'da ilkel tiplerdir. Örn. int dört bayttır.") == [
        "Sayısal tipler (int, long vb.) Java'da ilkel tiplerdir.", "Örn. int dört bayttır."]
    assert reads("Dil J. Gosling tarafından tasarlandı. 1990. yılda çalışmalar başladı.") == [
        "Dil J. Gosling tarafından tasarlandı.", "1990. yılda çalışmalar başladı."]


def test_real_ends_still_split_sentence_end_marks_blank_lines_and_list_items():
    assert reads("Bu bir sorudur? Evet bu bir cevaptır! Son cümle burada.") == [
        "Bu bir sorudur?", "Evet bu bir cevaptır!", "Son cümle burada."]
    assert reads("Nesne yönelimli programlama\n\nKalıtım bir sınıfın özelliklerini devralmasıdır.") == [
        "Nesne yönelimli programlama", "Kalıtım bir sınıfın özelliklerini devralmasıdır."]
    assert reads("Ilkel tipler şunlardır\n• tamsayı tipleri\n• ondalıklı tipler") == [
        "Ilkel tipler şunlardır", "• tamsayı tipleri", "• ondalıklı tipler"]
    assert reads('Gosling "Bu dil sade olmalı." dedi. Ekip kabul etti.') == [
        'Gosling "Bu dil sade olmalı." dedi.', "Ekip kabul etti."]


def test_a_quote_used_before_in_its_cut_form_still_leaves_the_whole_sentence_out():
    cut = "bytecode'a çevirir ve .class uzantılı dosyalar üretir."  # an older question's cut quote
    sentences = qe.number_sentences([{"source": 1, "text": JAVAC}], [cut])
    assert [s["read"] for s in sentences] == ["Java kaynak kodu .java uzantılı dosyalara yazılır."]
