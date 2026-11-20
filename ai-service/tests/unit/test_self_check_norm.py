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
