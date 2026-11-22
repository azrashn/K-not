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
    # The line before a blank line is a heading: left out, not merged.
    assert reads("Nesne yönelimli programlama\n\nKalıtım bir sınıfın özelliklerini devralmasıdır.") == [
        "Kalıtım bir sınıfın özelliklerini devralmasıdır."]
    assert reads("Ilkel tipler şunlardır\n• tamsayı tipleri\n• ondalıklı tipler") == [
        "Ilkel tipler şunlardır", "• tamsayı tipleri", "• ondalıklı tipler"]
    assert reads('Gosling "Bu dil sade olmalı." dedi. Ekip kabul etti.') == [
        'Gosling "Bu dil sade olmalı." dedi.', "Ekip kabul etti."]


CHAPTER = ("2. Java Tarihçesi\n"
           "Java, 1990'ların başında Sun Microsystems'te James Gosling liderliğindeki\n"
           "Green Team ekibi tarafından geliştirildi.\n"
           "3. Nesne Yönelimli Programlama\n"
           "Java nesne yönelimli bir programlama dilidir. Her şey bir sınıfın içinde yazılır.\n"
           "Temel Kavramlar\n"
           "Sınıf, nesnelerin şablonudur.\n"
           "\n"
           "Kalıtım ve çok biçimlilik\n"
           "\n"
           "Kalıtım bir sınıfın başka bir sınıftan özellik almasıdır.")


def test_heading_lines_are_their_own_unit_and_never_a_quote():
    assert reads(CHAPTER) == [
        "Java, 1990'ların başında Sun Microsystems'te James Gosling liderliğindeki Green Team ekibi "
        "tarafından geliştirildi.",
        "Java nesne yönelimli bir programlama dilidir.",  # not "3. Nesne Yönelimli Programlama Java nesne …"
        "Her şey bir sınıfın içinde yazılır.",
        "Sınıf, nesnelerin şablonudur.",
        "Kalıtım bir sınıfın başka bir sınıftan özellik almasıdır.",
    ]
    headings = [CHAPTER[a:b] for a, b in qe.heading_spans(CHAPTER)]
    assert headings == ["2. Java Tarihçesi", "3. Nesne Yönelimli Programlama", "Temel Kavramlar",
                        "Kalıtım ve çok biçimlilik"]
    # A heading has no number, so the model cannot name it as quote_id.
    sentences = qe.number_sentences([{"source": 1, "text": CHAPTER}])
    assert not any("Programlama Java" in s["read"] or s["read"] in headings for s in sentences)


def test_the_three_whole_sentence_examples_still_hold_under_headings():
    for text, whole in [
        ("1. Derleme\n" + JAVAC, "Derleyici (javac) bu kodu bytecode'a çevirir ve .class uzantılı dosyalar üretir."),
        ("Tarihçe\n" + GOSLING, "Java, 1990'ların başında Sun Microsystems'te James Gosling liderliğindeki Green "
                                "Team ekibi tarafından geliştirildi."),
        ("4. Veri Tipleri\n" + TYPES, "Java'da sekiz ilkel veri tipi vardır: byte, short, int, long, float, double, "
                                      "char ve boolean."),
    ]:
        out = reads(text)
        assert whole in out and not any(o.startswith(text.split("\n")[0]) for o in out)


def test_a_short_line_inside_a_sentence_is_not_a_heading():
    # Continued in lower case on the next line: part of the sentence.
    assert reads("Java Sanal Makinesi\nbytecode'u çalıştırır.") == ["Java Sanal Makinesi bytecode'u çalıştırır."]
    # The line above has no ending: the short line goes on with that sentence.
    assert reads("Java kaynak dosyaları önce javac ile derlenir ve sonra\nJVM üzerinde\nçalıştırılır.") == [
        "Java kaynak dosyaları önce javac ile derlenir ve sonra JVM üzerinde çalıştırılır."]
    # A line ending a sentence is never a heading, however short.
    assert reads("Kısa bir cümle.\nBaşka bir cümle burada.") == ["Kısa bir cümle.", "Başka bir cümle burada."]


def test_a_quote_used_before_in_its_cut_form_still_leaves_the_whole_sentence_out():
    cut = "bytecode'a çevirir ve .class uzantılı dosyalar üretir."  # an older question's cut quote
    sentences = qe.number_sentences([{"source": 1, "text": JAVAC}], [cut])
    assert [s["read"] for s in sentences] == ["Java kaynak kodu .java uzantılı dosyalara yazılır."]
