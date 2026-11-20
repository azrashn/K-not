from knot_rag.self_check_rules import antonym_conflict, comparison_conflict, direction_conflict, roles, rule_conflict


def test_antonyms_need_the_rest_of_the_sentence_to_match():
    src = "In slow start TCP increases the sending rate exponentially until the first loss event."
    c = antonym_conflict("In slow start TCP decreases the sending rate exponentially until the first loss event.", src)
    assert c == {"kind": "ANTONYM", "claim": ["decreases"], "source": ["increases"]}
    # same word: no conflict; unrelated sentence with an opposite word: no conflict
    assert antonym_conflict(src, src) is None
    assert antonym_conflict("Cache memory decreases latency a lot.", src) is None
    assert antonym_conflict("UDP is a reliable transport protocol that guarantees delivery.",
                            "UDP is an unreliable transport protocol that guarantees nothing about delivery.") is not None
    assert antonym_conflict("Stack follows FIFO order for push and pop operations.", "A stack follows LIFO order for push and pop operations.")["kind"] == "ANTONYM"


def test_antonyms_turkish_and_double_negation_skipped():
    assert antonym_conflict("TCP gönderim hızını her RTT'de azaltır ve kayıp olayına kadar devam eder.",
                            "TCP gönderim hızını her RTT'de artırır ve kayıp olayına kadar devam eder.") is not None
    # a negated claim against a plain source is the NEGATION rule's job, not this one
    assert antonym_conflict("TCP does not increase the rate every RTT during slow start.",
                            "TCP decreases the rate every RTT during slow start.") is None


def test_direction_swap_in_both_languages():
    assert roles("The client sends a SYN segment to the server.") == ("client", "server")
    assert roles("İstemci sunucuya SYN gönderir.") == ("client", "server")
    assert roles("Sunucu istemciden SYN alır.") == ("client", "server")
    c = direction_conflict("The server sends a SYN segment to the client in the handshake.",
                           "The client sends a SYN segment to the server in the handshake.")
    assert c == {"kind": "DIRECTION", "claim": ["server", "client"], "source": ["client", "server"]}
    assert direction_conflict("Sunucu istemciye SYN segmenti gönderir el sıkışmada.",
                              "İstemci sunucuya SYN segmenti gönderir el sıkışmada.") is not None
    # same direction, or no clear roles: nothing
    assert direction_conflict("The client sends a SYN segment to the server in the handshake.",
                              "The client sends a SYN segment to the server in the handshake.") is None
    assert direction_conflict("The client and the server exchange segments.", "The server and the client exchange segments.") is None


def test_comparison_swapped_or_opposite():
    assert comparison_conflict("UDP is faster than TCP", "TCP is faster than UDP")["kind"] == "COMPARISON"
    assert comparison_conflict("UDP, TCP'den daha hızlıdır", "TCP, UDP'den daha hızlıdır") is not None
    assert comparison_conflict("UDP is faster than TCP", "UDP is slower than TCP") is not None
    assert comparison_conflict("UDP is faster than TCP", "UDP is faster than TCP") is None


def test_rule_conflict_only_on_single_sentences_for_direction():
    assert rule_conflict("a", "b", 0) is None


def test_short_claims_with_one_other_word_need_that_word_in_the_sentence():
    # "TCP is connectionless" against the line that says TCP is connection-oriented
    assert antonym_conflict("TCP is connectionless", "Connection-oriented transport: TCP") is not None
    # the subject is not in the sentence: nothing
    assert antonym_conflict("UDP is connectionless", "Connection-oriented transport: TCP") is None
    # the same word: nothing
    assert antonym_conflict("UDP is connectionless", "Connectionless transport: UDP") is None


def test_damaged_slide_text_still_shows_the_opposite_word():
    assert antonym_conflict("TCP is connectionless", "§Connec8on-oriented transport: TCP") is not None


def test_hyphenated_opposite_word_does_not_count_its_own_parts_as_the_rest_of_the_claim():
    assert antonym_conflict("UDP is connection-oriented", "§Connectionless transport: UDP") is not None
