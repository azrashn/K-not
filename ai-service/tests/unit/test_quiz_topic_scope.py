"""A topic that names a section keeps the questions inside that section (quiz_engine.number_sentences)."""

from knot_rag import quiz_engine as qe

PAGE = (
    "1. Java'nın Tarihçesi\n"
    "Java, 1990'ların başında Sun Microsystems'te geliştirildi. İlk sürümü 1995 yılında yayımlandı.\n\n"
    "2. Derleme ve Çalıştırma\n"
    "Java kaynak kodu .java dosyalarına yazılır. Derleyici bu kodu bytecode'a çevirir.\n"
    "JVM bytecode'u her platformda çalıştırır.\n\n"
    "3. Nesne Yönelimli Programlama\n"
    "Program sınıflardan oluşur ve her nesne bir sınıfın örneğidir."
)
SOURCES = [{"source": 1, "text": PAGE}]


def texts(sentences):
    return [s["read"] for s in sentences]


def test_a_topic_that_names_a_section_keeps_only_that_sections_sentences():
    got = texts(qe.number_sentences(SOURCES, topic="Derleme ve çalıştırma"))
    assert got and all("bytecode" in t or ".java" in t for t in got)
    assert not any("1995" in t or "sınıfın" in t for t in got)


def test_the_topic_matches_by_words_not_by_exact_text():
    got = texts(qe.number_sentences(SOURCES, topic="java'nın tarihçesi"))
    assert any("1995" in t for t in got) and not any("bytecode" in t for t in got)


def test_a_topic_that_is_no_heading_keeps_every_sentence():
    whole = texts(qe.number_sentences(SOURCES))
    assert texts(qe.number_sentences(SOURCES, topic="çöp toplayıcı")) == whole


def test_without_a_topic_nothing_is_cut():
    assert len(qe.number_sentences(SOURCES)) == len(qe.number_sentences(SOURCES, topic=""))


def test_a_section_too_short_for_the_request_gives_fewer_sentences_not_other_sections():
    # "Nesne Yönelimli Programlama" has one sentence: that is all there is to ask from, never the others.
    got = texts(qe.number_sentences(SOURCES, topic="nesne yönelimli programlama"))
    assert got == ["Program sınıflardan oluşur ve her nesne bir sınıfın örneğidir."]


def test_a_heading_at_the_end_of_a_page_takes_the_opening_lines_of_the_next_page():
    page1 = "Giriş\n\n4. Veri Tipleri\nJava'da sekiz ilkel veri tipi vardır.\n\n5. Bellek Yönetimi"
    page2 = ("JVM bellek yönetimini üstlenir. Nesneler heap bölgesinde tutulur.\n\n"
             "6. İstisna Yönetimi\nProgram çalışırken oluşan hatalara istisna denir.")
    pages = [{"source": 1, "text": page1}, {"source": 2, "text": page2}]
    got = texts(qe.number_sentences(pages, topic="Bellek Yönetimi"))
    assert got and all("JVM" in t or "heap" in t for t in got)
    assert not any("istisna" in t or "ilkel" in t for t in got)


def test_a_heading_with_no_text_at_the_end_and_no_next_page_leaves_nothing_to_ask():
    page = "4. Veri Tipleri\nJava'da sekiz ilkel veri tipi vardır.\n\n5. Bellek Yönetimi"
    assert qe.number_sentences([{"source": 1, "text": page}], topic="Bellek Yönetimi") == []


def test_a_title_above_another_heading_does_not_count_as_the_topic():
    page = "Java Programlama - Ders Notları\n\n1. Tarihçe\nJava 1995 yılında yayımlandı. Oak adı verilmişti."
    got = texts(qe.number_sentences([{"source": 1, "text": page}], topic="Java"))
    assert len(got) == 2  # "Java" names only the empty title: nothing is cut


def test_a_source_without_headings_is_kept_beside_a_matching_one():
    plain = {"source": 2, "text": "Çöp toplayıcı kullanılmayan nesnelerin belleğini geri kazanır."}
    got = qe.number_sentences([SOURCES[0], plain], topic="Derleme ve çalıştırma")
    assert any(s["source"] == 2 for s in got) and not any("1995" in s["read"] for s in got)


def test_a_source_with_other_headings_is_dropped_when_another_source_has_the_topic():
    other = {"source": 2, "text": "1. Veri Tipleri\nJava'da sekiz ilkel veri tipi vardır.\n\n2. Bellek\nHeap nesneleri tutar."}
    got = qe.number_sentences([SOURCES[0], other], topic="Derleme ve çalıştırma")
    assert {s["source"] for s in got} == {1}
