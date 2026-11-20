from knot_rag.self_check_norm import canon


def test_single_and_compound_number_words():
    assert canon("three duplicate ACKs") == "3 duplicate ACKs"
    assert canon("üç tekrarlı ACK") == "3 tekrarlı ACK"
    assert canon("twenty five bytes") == "25 bytes"
    assert canon("yirmi beş bayt") == "25 bayt"
    assert canon("three hundred segments") == "300 segments"
    assert canon("iki yüz elli") == "250"
    assert canon("Dört") == "4"


def test_ambiguous_words_are_left_alone():
    s = "Bir protokol on the wire, one by one."
    assert canon(s) == s


def test_adjacent_unrelated_numbers_stay_apart():
    assert canon("two three") == "2 3"
    assert canon("five, six") == "5, 6"
