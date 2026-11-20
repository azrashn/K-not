from knot_rag.self_check_norm import canon


def test_single_and_compound_number_words():
    assert canon("three duplicate ACKs") == "3 duplicate ACKs"
    assert canon("üç tekrarlı ACK") == "3 tekrarlı ACK"
    assert canon("twenty five packets") == "25 packets"
    assert canon("yirmi beş paket") == "25 paket"
    assert canon("three hundred segments") == "300 segments"
    assert canon("iki yüz elli") == "250"
    assert canon("Dört") == "4"


def test_ambiguous_words_are_left_alone():
    s = "Bir protokol on the wire, one by one."
    assert canon(s) == s


def test_adjacent_unrelated_numbers_stay_apart():
    assert canon("two three") == "2 3"
    assert canon("five, six") == "5, 6"


def test_ocr_ligatures_are_repaired_only_towards_words_the_claim_contains():
    from knot_rag.self_check_norm import repair_ocr

    vocab = {"initially", "connection", "letters", "after", "timeout", "additional", "congestion", "until"}
    src = "•ini$ally cwnd; connec8on le@ers ajer /meout addi9onal conges8on unCl"
    out = repair_ocr(src, vocab)
    for word in vocab:
        assert word in out
    # words the claim does not contain are left exactly as they are
    assert repair_ocr("incremen$ng mul8plexing", {"initially"}) == "incremen$ng mul8plexing"
    assert repair_ocr("3-way hand$hake", {"handshake"}) == "3-way hand$hake"


def test_units_written_in_different_ways_are_one_unit():
    from knot_rag.self_check_norm import canon

    assert "byte" in canon("64 bayttır") and "byte" in canon("64 bytes") and "byte" in canon("64 B")
    assert canon("1500 bayt") == canon("1500 bytes") == canon("1500 B") == "1500 byte"
    assert canon("5 milisaniye") == canon("5 ms") == "5 millisecond"
    assert canon("2 megabayt") == canon("2 MB") == "2 megabyte"
    # ordinary words and sentences are left alone
    assert canon("the second packet is late") == "the second packet is late"


def test_words_with_a_reversing_affix_are_found():
    from knot_rag.self_check_norm import polar_words

    assert polar_words(["tcp", "connectionless", "reliable"]) == ["connectionless"]
    assert polar_words(["unreliable", "baglantisiz", "nonpreemptive", "connection", "union", "network"]) == ["unreliable", "baglantisiz", "nonpreemptive"]
    assert polar_words(["wireless"]) == ["wireless"]
    assert polar_words(["unit", "uniform", "internet", "input"]) == []
