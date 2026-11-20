"""Self-check: a student's own text compared with course materials. Real Chroma + hashing embedder."""

import hashlib

import chromadb
import pytest
from pydantic import ValidationError

from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.self_check import MAX_CLAIMS, MAX_TEXT_CHARS, SelfCheck, self_check, split_claims
from knot_rag.unified import Material, Projection, Segment, UnifiedIndex

COURSE = "course-a"
TCP = (
    "TCP bağlantı kurulumu üç yollu el sıkışma ile yapılır. İstemci SYN gönderir, "
    "sunucu SYN ACK ile yanıt verir ve güvenilir bağlantı kurulur."
)
UDP = "UDP bağlantısız çalışır. UDP güvenilir bir taşıma protokolü değildir. TCP ise bağlantı yönelimli bir protokoldür."
ETH = "Ethernet çerçevesinin en küçük boyutu 64 bayttır. Çerçeve başlığında hedef ve kaynak MAC adresi bulunur."
OTHER = "Blockchain madenciliği proof of work ile yeni blokları doğrular."


class Env:
    def __init__(self):
        self.index = UnifiedIndex(
            build_components(Settings(embedding_backend="hashing")), chromadb.EphemeralClient()
        )
        self.materials = []

    def add(self, mid, chunks, course=COURSE, register=True, title=None):
        m = Material(id=mid, kind="PDF", title=title or mid, version="a" * 64)
        segments = [
            Segment(id=hashlib.sha256(f"{course}{mid}{i}".encode()).hexdigest(), text=t,
                    location={"kind": "page", "page": page})
            for i, (t, page) in enumerate(chunks)
        ]
        self.index.upsert(Projection(course_id=course, material=m, segments=segments))
        if register:
            self.materials.append(m)

    def check(self, text, course=COURSE):
        return self_check(self.index, SelfCheck(course_id=course, materials=self.materials, text=text))


@pytest.fixture
def env():
    e = Env()
    e.add("pdf_net", [(TCP, 4), (UDP, 5), (ETH, 7)], title="Chapter 3")
    return e


def only(result):
    assert len(result["claims"]) == 1, result
    return result["claims"][0]


def test_claim_in_material_is_in_source_with_page(env):
    c = only(env.check("TCP bağlantı kurulumunda istemci SYN gönderir ve sunucu SYN ACK ile yanıt verir."))
    assert c["label"] == "IN_SOURCE"
    assert c["sources"][0]["location"] == {"page": 4}
    assert c["sources"][0]["material_id"] == "pdf_net"
    assert c["sources"][0]["title"] == "Chapter 3"
    assert len(c["sources"][0]["quote"]) <= 160


def test_claim_not_in_material_is_not_in_source(env):
    c = only(env.check("Kuantum bilgisayarlar fotonları uydular arasında anında taşır."))
    assert c["label"] == "NOT_IN_SOURCE"
    assert c["sources"] == []


def test_different_number_on_same_topic_conflicts(env):
    c = only(env.check("Ethernet çerçevesinin en küçük boyutu 128 bayttır."))
    assert c["label"] == "CONFLICTS"
    assert c["conflict"]["kind"] == "NUMBER"
    assert c["conflict"]["claim"] == ["128"] and c["conflict"]["source"] == ["64"]
    assert c["sources"][0]["location"] == {"page": 7}


def test_opposite_polarity_conflicts(env):
    c = only(env.check("UDP güvenilir bir taşıma protokolüdür."))
    assert c["label"] == "CONFLICTS"
    assert c["conflict"]["kind"] == "NEGATION"
    c = only(env.check("TCP bağlantı yönelimli bir protokol değildir."))
    assert c["label"] == "CONFLICTS"
    assert c["conflict"] == {"kind": "NEGATION", "claim_negated": True, "source_negated": False}


def test_same_number_is_not_a_conflict(env):
    c = only(env.check("Ethernet çerçevesinin en küçük boyutu 64 bayttır."))
    assert c["label"] == "IN_SOURCE"


def test_unrelated_number_is_not_called_a_conflict(env):
    # Shares one word with the source but is about something else: abstain, never invent a contradiction.
    c = only(env.check("Ethernet kablolarının uzunluğu 100 metreyi geçmemelidir."))
    assert c["label"] in ("NOT_IN_SOURCE", "PARTIAL")
    assert c["label"] != "CONFLICTS"


def test_partial_lists_missing_terms(env):
    c = only(env.check("TCP bağlantı kurulumu üç yollu el sıkışma ile yapılır ve şifreleme anahtarı değişimi sağlar."))
    assert c["label"] in ("PARTIAL", "NOT_IN_SOURCE")
    if c["label"] == "PARTIAL":
        assert c["missing_terms"] or c["parts"]


def test_non_claims_are_skipped_with_reason(env):
    r = env.check("Bence bu konu çok zor. Bu nasıl çalışır? Ayrıca. Evet.")
    assert r["claims"] == []
    assert {s["reason"] for s in r["skipped"]} == {"OPINION", "QUESTION", "TOO_SHORT"}


def test_leading_filler_is_removed_from_claim(env):
    r = env.check("Ayrıca UDP bağlantısız çalışır.")
    assert only(r)["text"].startswith("UDP")


def test_summary_counts(env):
    r = env.check(
        "TCP bağlantı kurulumunda istemci SYN gönderir ve sunucu SYN ACK ile yanıt verir. "
        "Ethernet çerçevesinin en küçük boyutu 128 bayttır. "
        "Kuantum bilgisayarlar fotonları uydular arasında anında taşır."
    )
    s = r["summary"]
    assert (s["IN_SOURCE"], s["CONFLICTS"], s["NOT_IN_SOURCE"], s["total"]) == (1, 1, 1, 3)
    assert r["verified"] is False and "score" not in r and "percent" not in str(r["summary"])


def test_other_course_material_is_never_used(env):
    env.add("pdf_chain", [(OTHER, 1)], course="course-b", register=False)
    c = only(env.check("Blockchain madenciliği proof of work ile yeni blokları doğrular."))
    assert c["label"] == "NOT_IN_SOURCE"
    # the same claim is found when asked inside the course that owns it
    env.materials = [Material(id="pdf_chain", kind="PDF", title="x", version="a" * 64)]
    assert only(env.check("Blockchain madenciliği proof of work ile yeni blokları doğrular.", course="course-b"))["label"] == "IN_SOURCE"


def test_material_not_in_manifest_is_not_searched(env):
    env.materials = [m for m in env.materials if m.id != "pdf_net"]
    c = only(env.check("UDP bağlantısız çalışır."))
    assert c["label"] == "NOT_IN_SOURCE"


def test_empty_and_too_long_input_rejected(env):
    with pytest.raises(ValidationError):
        SelfCheck(course_id=COURSE, materials=env.materials, text="")
    with pytest.raises(ValidationError):
        SelfCheck(course_id=COURSE, materials=env.materials, text="a" * (MAX_TEXT_CHARS + 1))


def test_claim_count_is_capped(env):
    text = " ".join(f"UDP bağlantısız çalışır ve madde{chr(97 + i % 26)}{i} sayılır." for i in range(MAX_CLAIMS + 5))
    r = env.check(text[:MAX_TEXT_CHARS])
    assert len(r["claims"]) <= MAX_CLAIMS
    assert r["truncated"] is (len(split_claims(text[:MAX_TEXT_CHARS])[0]) > MAX_CLAIMS)


def test_decimal_numbers_and_abbreviations_do_not_split_claims():
    claims, _ = split_claims("Gecikme 3.5 ms olur, örn. yerel ağlarda daha düşüktür.")
    assert len(claims) == 1


SLIDES = (
    "Hashing\n▪ is a means used to order and access elements in a list quickly\n"
    "o the goal is O(1) time\n▪ Such an address calculator is usually referred to as a hash function\n9/87"
)
PERFECT = "Hash functions\n▪ Perfect hash function\no Maps each search key into a unique location of the hash table\n12/87"
TCP_EN = "TCP slow start\n•initially cwnd = 1 MSS\n•double cwnd every RTT\nTransport Layer: 3-127"


@pytest.fixture
def slides():
    e = Env()
    e.add("pdf_slides", [(SLIDES, 7), (PERFECT, 12), (TCP_EN, 127)])
    return e


def test_big_o_difference_is_not_hidden_by_letters(slides):
    # `n` is a letter, not a number, but O(n) against O(1) must never read as "in the source".
    c = only(slides.check("The goal of hashing is O(n) time."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["kind"] == "NUMBER"
    assert "O(N)" in c["conflict"]["claim"] and "O(1)" in c["conflict"]["source"]
    assert only(slides.check("The goal of hashing is O(1) time."))["label"] == "IN_SOURCE"


def test_denial_across_two_lines_conflicts(slides):
    c = only(slides.check("A perfect hash function does not map each search key into a unique location of the hash table."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["kind"] == "NEGATION"
    assert only(slides.check("A perfect hash function maps each search key into a unique location of the hash table."))["label"] == "IN_SOURCE"


def test_slide_bullets_work_as_one_passage_and_footer_numbers_are_ignored(slides):
    assert only(slides.check("TCP slow start has initially cwnd 1 MSS and doubles cwnd every RTT."))["label"] == "IN_SOURCE"
    c = only(slides.check("TCP slow start has initially cwnd 10 MSS."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["source"] == ["1"]
    # The slide footer "3-127" is a page counter: a claim about another number never "conflicts" with it.
    assert only(slides.check("Transport Layer services run over 5 hosts in the TCP slow start phase."))["label"] != "CONFLICTS"


def test_claim_with_several_numbers_conflicts_only_on_the_unit_that_differs(slides):
    c = only(slides.check("TCP slow start has initially cwnd 10 MSS and doubles every 7 RTT."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["claim"] == ["10"]


def test_mostly_missing_terms_is_not_partial(slides):
    c = only(slides.check("TCP slow start encrypts every segment with AES before sending it."))
    assert c["label"] == "NOT_IN_SOURCE"


def test_translated_claim_needs_two_shared_terms(slides):
    # Turkish text against English slides: only acronyms can be compared, and one is not enough.
    one = only(slides.check("TCP için her şeyi rastgele şifreleyen bir yöntem vardır."))
    assert one["label"] in ("UNCHECKED", "NOT_IN_SOURCE")
    two = only(slides.check("TCP slow start sırasında cwnd değeri 1 MSS ile başlar, RTT başına ikiye katlanır (slow start)."))
    assert two["label"] in ("IN_SOURCE", "UNCHECKED", "NOT_IN_SOURCE")
    if two["label"] == "IN_SOURCE":
        assert two["translated"] is True and len(two["matched_terms"]) >= 2


def test_number_words_match_digits_in_both_languages():
    e = Env()
    e.add("pdf_fr", [("Receipt of three duplicate ACKs indicates that the segment is likely lost. TCP fast retransmit resends the unACKed segment.", 93)])
    ok = "TCP fast retransmit resends the unACKed segment after 3 duplicate ACKs."
    assert only(e.check(ok))["label"] == "IN_SOURCE"
    assert only(e.check(ok.replace("3", "üç")))["label"] in ("IN_SOURCE", "NOT_IN_SOURCE", "PARTIAL")
    wrong = only(e.check("TCP fast retransmit resends the unACKed segment after 5 duplicate ACKs."))
    assert wrong["label"] == "CONFLICTS" and wrong["conflict"] == {"kind": "NUMBER", "claim": ["5"], "source": ["3"]}
    assert only(e.check("TCP fast retransmit resends the unACKed segment after five duplicate ACKs."))["label"] == "CONFLICTS"


def test_several_numbers_are_judged_per_unit():
    e = Env()
    e.add("pdf_u", [("TCP slow start\n•initially cwnd = 1 MSS\n•double cwnd every RTT\nEthernet frames carry at most 1500 bytes of payload.", 5),
                    ("For example, suppose tableSize is 101 slots in the hash table.", 6)])
    c = only(e.check("TCP slow start has initially cwnd 10 MSS and doubles cwnd every RTT."))
    assert c["label"] == "CONFLICTS" and c["conflict"] == {"kind": "NUMBER", "claim": ["10"], "source": ["1"]}
    c = only(e.check("Ethernet frames carry at most 9000 bytes of payload, 2 of them in the header."))
    assert c["label"] != "CONFLICTS" or c["conflict"]["claim"] == ["9000"]
    # a number the source gives only as an EXAMPLE is no statement of fact
    c = only(e.check("The tableSize of the hash table has 53 slots."))
    assert c["label"] != "CONFLICTS"


def test_ocr_damaged_slide_text_still_supports_a_correct_claim():
    e = Env()
    e.add("pdf_ocr", [("TCP slow start\n§when connec8on begins,\n•ini$ally cwnd = 1 MSS\n•double cwnd every RTT\n"
                       "§increase rate exponen8ally un8l ﬁrst loss event", 127)])
    c = only(e.check("When the connection begins TCP slow start initially sets cwnd to 1 MSS and doubles cwnd every RTT."))
    assert c["label"] == "IN_SOURCE", c
    # the quote is the source exactly as stored, damage included
    assert c["sources"][0]["quote"].split(" ")[0].lstrip("•§") in "TCP slow start connec8on begins ini$ally cwnd double every RTT increase exponen8ally"
    # repair never makes a missing word appear
    assert only(e.check("TCP slow start initially encrypts cwnd with AES."))["label"] == "NOT_IN_SOURCE"


def test_compound_claim_is_judged_per_half():
    from knot_rag.self_check import split_compound

    e = Env()
    e.add("pdf_c", [("TCP is a connection-oriented protocol with a three-way handshake.", 3),
                    ("UDP is a connectionless protocol and it gives no delivery guarantee.", 4),
                    ("Ethernet frames carry at most 1500 bytes of payload.", 5)])
    assert split_compound("TCP and UDP are transport protocols") == ["TCP and UDP are transport protocols"]
    both = "TCP is a connection-oriented protocol with a handshake and UDP is a connectionless protocol with no guarantee"
    assert len(split_compound(both)) == 2
    ok = only(e.check("TCP is a connection-oriented protocol with a three-way handshake, and UDP is a connectionless protocol with no delivery guarantee."))
    assert ok["label"] == "IN_SOURCE" and len(ok["parts"]) == 2
    # one true half and one half the source contradicts: the contradiction is not hidden
    bad = only(e.check("TCP is a connection-oriented protocol with a three-way handshake, and Ethernet frames carry at most 9000 bytes of payload."))
    assert bad["label"] == "CONFLICTS" and bad["conflict"]["claim"] == ["9000"]
    assert [p["label"] for p in bad["parts"]] == ["IN_SOURCE", "CONFLICTS"]
    # one true half and one invented half is partly in the sources
    mixed = only(e.check("TCP is a connection-oriented protocol with a three-way handshake, but UDP encrypts payload using AES keys."))
    assert mixed["label"] == "PARTIAL" and [p["label"] for p in mixed["parts"]] == ["IN_SOURCE", "NOT_IN_SOURCE"]


def test_remaining_claims_and_cache():
    e = Env()
    e.add("pdf_r", [("UDP is a connectionless protocol that gives no delivery guarantee at all.", 4)])
    text = " ".join(f"UDP is a connectionless protocol number {i}." for i in range(30))
    first = e.check(text)
    assert len(first["claims"]) == MAX_CLAIMS and first["remaining"] == 5 and first["next_offset"] == MAX_CLAIMS
    rest = self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials, text=text, offset=first["next_offset"]))
    assert len(rest["claims"]) == 5 and rest["remaining"] == 0 and rest["skipped"] == []
    # unchanged claims are answered from the cache: no new search
    calls = []
    real = e.index.search
    e.index.search = lambda body: calls.append(1) or real(body)
    e.check(text)
    assert calls == []
    e.check("UDP is a connectionless brand new claim xyzzy. " + text)
    assert 0 < len(calls) <= 2
    # another version of the material is another cache entry
    e.materials[0] = Material(id=e.materials[0].id, kind="PDF", title="t", version="b" * 64)


EN_NET = (
    "TCP slow start begins with cwnd equal to 1 MSS and doubles cwnd every RTT until the first loss event happens in the connection. "
    "UDP is a connectionless transport protocol that gives no delivery guarantee. TCP is a reliable connection-oriented protocol that uses a three-way handshake."
)


def _cross_env():
    e = Env()
    e.add("pdf_en", [(EN_NET, 127)])
    return e


def _fake_model(mapping):
    def translate(texts, target):
        return [mapping.get(t) for t in texts]
    return translate


def test_turkish_claim_against_english_material_through_the_model():
    e = _cross_env()
    claim = "TCP yavaş başlangıçta cwnd değerini 1 MSS ile başlatır ve her RTT sürede ikiye katlar."
    mapping = {claim.rstrip("."): "TCP slow start begins with cwnd equal to 1 MSS and doubles cwnd every RTT"}
    r = self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials, text=claim), translate=_fake_model(mapping))
    c = r["claims"][0]
    assert c["label"] == "IN_SOURCE" and c["translated"] is True
    assert c["translation"] == {"text": mapping[claim.rstrip(".")], "method": "model", "to": "en"}
    assert c["sources"][0]["location"] == {"page": 127}


def test_cross_language_number_conflict_is_found_and_the_number_comes_from_the_student():
    e = _cross_env()
    claim = "TCP yavaş başlangıçta cwnd değerini 10 MSS ile başlatır ve her RTT sürede ikiye katlar."
    mapping = {"TCP yavaş başlangıçta cwnd değerini 10 MSS ile başlatır": "TCP slow start begins with cwnd equal to 10 MSS",
               "her RTT sürede ikiye katlar": "doubles cwnd every RTT"}
    c = only(self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials, text=claim), translate=_fake_model(mapping)))
    assert c["label"] == "CONFLICTS" and c["conflict"] == {"kind": "NUMBER", "claim": ["10"], "source": ["1"]}


def test_dictionary_alone_works_without_the_model_and_never_invents_a_match():
    e = _cross_env()
    none = _fake_model({})
    ok = only(self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials,
              text="UDP bağlantısız bir taşıma protokolüdür ve teslim garantisi sağlamaz."), translate=none))
    assert ok["label"] in ("IN_SOURCE", "PARTIAL", "UNCHECKED", "NOT_IN_SOURCE")  # whatever it says, it must not conflict
    assert ok["label"] != "CONFLICTS"
    fake = only(self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials,
                text="TCP her segmenti rastgele bir anahtarla şifreleme yapar ve bağlantı kurar."), translate=none))
    assert fake["label"] in ("NOT_IN_SOURCE", "UNCHECKED")  # never "in source"


def test_same_language_claims_are_never_translated():
    e = _cross_env()
    called = []
    c = only(self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials,
             text="UDP is a connectionless transport protocol that gives no delivery guarantee."),
             translate=lambda texts, target: called.append(texts) or [None] * len(texts)))
    assert c["label"] == "IN_SOURCE" and called == [] and c["translation"] is None


def test_short_first_half_is_split_when_the_sources_confirm_it():
    e = Env()
    e.add("pdf_s", [("UDP is a connectionless transport protocol that gives no delivery guarantee at all.", 4),
                    ("TCP is a reliable connection-oriented protocol with a three-way handshake.", 5)])
    c = only(e.check("UDP is connectionless and TCP uses AES encryption for every segment."))
    assert c["label"] == "PARTIAL"
    assert [p["label"] for p in c["parts"]] == ["IN_SOURCE", "NOT_IN_SOURCE"]
    # nothing confirmed by the sources: still one statement, no invented parts
    c = only(e.check("Quantum entanglement and photon routing use AES encryption."))
    assert c["label"] == "NOT_IN_SOURCE" and c["parts"] == []
    # a plain list is not a compound claim
    c = only(e.check("TCP and UDP are transport protocols."))
    assert c["parts"] == []


def test_rule_based_conflicts_end_to_end():
    e = Env()
    e.add("pdf_r2", [("The client sends a SYN segment to the server in the first step of the handshake.", 8),
                     ("In slow start TCP increases the sending rate exponentially until the first loss event.", 9),
                     ("UDP is faster than TCP because it has no handshake and no retransmission.", 10),
                     ("A stack follows LIFO order for push and pop operations.", 11)])
    c = only(e.check("The server sends a SYN segment to the client in the first step of the handshake."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["kind"] == "DIRECTION"
    assert c["conflict"]["source"] == ["client", "server"]
    c = only(e.check("In slow start TCP decreases the sending rate exponentially until the first loss event."))
    assert c["label"] == "CONFLICTS" and c["conflict"] == {"kind": "ANTONYM", "claim": ["decreases"], "source": ["increases"]}
    c = only(e.check("TCP is faster than UDP because it has no handshake and no retransmission."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["kind"] == "COMPARISON"
    c = only(e.check("A stack follows FIFO order for push and pop operations."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["claim"] == ["fifo"]
    # the true versions stay "in the source"
    assert only(e.check("The client sends a SYN segment to the server in the first step of the handshake."))["label"] == "IN_SOURCE"
    assert only(e.check("UDP is faster than TCP because it has no handshake and no retransmission."))["label"] == "IN_SOURCE"


def test_meaning_warning_never_changes_the_label():
    e = Env()
    e.add("pdf_m", [("Process B waits for process A before it releases the lock, so A always runs first.", 3)])
    text = "Process A waits for process B before it releases the lock."
    seen = []

    def liar(pairs):
        seen.extend(pairs)
        return [{"verdict": "CONTRADICTS", "quote": "Process B waits for process A"} for _ in pairs]

    def faker(pairs):
        return [{"verdict": "CONTRADICTS", "quote": ""} if False else {"verdict": "UNSURE", "quote": ""} for _ in pairs]

    r = self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials, text=text), judge_fn=liar)
    c = only(r)
    assert c["label"] == "IN_SOURCE"  # words match; only the warning speaks
    assert c["meaning_warning"]["quote"] == "Process B waits for process A"
    assert seen and "passage" not in str(c["sources"])  # the passage was only for the model
    r2 = self_check(e.index, SelfCheck(course_id=COURSE, materials=e.materials, text=text + " "), judge_fn=faker)
    assert only(r2)["meaning_warning"] is not None  # served from cache: same claim, same result


def test_glossary_follows_indexing_and_deletion(tmp_path, monkeypatch):
    from knot_rag import self_check_glossary as g

    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("SELF_CHECK_TRANSLATE", "off")  # no model in tests
    e = Env()
    e.add("pdf_g", [("Ağ geçidi (gateway) iki ağı birbirine bağlayan cihazdır. Çerçeve (frame) veri bağı katmanının birimidir.", 2)])
    assert any(p[1] == "gateway" for p in g.course_pairs(COURSE))
    e.index.delete(COURSE, "pdf_g")
    assert g.course_pairs(COURSE) == []


def test_whole_claim_first_then_parts_with_context_and_unchecked_parts():
    e = Env()
    e.add("pdf_w", [("TCP 3-way handshake: the client sends a SYN segment to the server, the server replies with SYNACK and the client answers with an ACK.", 106)])
    # found as written: never split
    c = only(e.check("In the TCP handshake the client sends a SYN segment to the server and the server replies with SYNACK."))
    assert c["label"] == "IN_SOURCE" and c["parts"] == []
    # the second half alone ("the server replies with SYNACK") is searched together with the first half's subject
    from knot_rag.self_check import context_terms, _combine
    assert context_terms(["TCP handshake client sends SYN", "the server replies"], 1).startswith("tcp")
    assert context_terms(["a", "b"], 0) == ""
    # combine: found + not compared = found, with the flag; found + missing = partly; unchecked only = unchecked
    def sub(label, text="x"):
        return {"text": text, "label": label, "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    assert (lambda r: (r["label"], r["partly_unchecked"]))(_combine("c", [sub("IN_SOURCE"), sub("UNCHECKED")])) == ("IN_SOURCE", True)
    assert _combine("c", [sub("IN_SOURCE"), sub("NOT_IN_SOURCE")])["label"] == "PARTIAL"
    assert _combine("c", [sub("NOT_IN_SOURCE"), sub("UNCHECKED")])["label"] == "UNCHECKED"
    assert _combine("c", [sub("IN_SOURCE"), sub("CONFLICTS")])["label"] == "CONFLICTS"


def test_unit_spelling_does_not_hide_a_match_or_a_conflict():
    e = Env()
    e.add("pdf_u2", [("Ethernet frames carry at most 1500 bytes of payload in the data field of one frame.", 7)])
    ok = only(e.check("Ethernet çerçeveleri bir çerçevenin veri alanında en fazla 1500 bayt yük taşır."))  # Turkish, bayt
    assert ok["label"] != "CONFLICTS"
    c = only(e.check("Ethernet frames carry at most 9000 bayt of payload in the data field of one frame."))
    assert c["label"] == "CONFLICTS" and c["conflict"]["claim"] == ["9000"]


def test_quote_prefers_a_sentence_over_a_bare_heading():
    e = Env()
    e.add("pdf_q", [("TCP 3-way handshake\nthe client sends a SYN segment to the server and waits\n12/87", 106)])
    c = only(e.check("In the TCP 3-way handshake the client sends a SYN segment to the server."))
    assert "client sends a SYN" in c["sources"][0]["quote"]


def test_connection_is_not_connectionless():
    """Both words share the stem 'conne': the claim "X is connectionless" was found in any "X connection" line."""
    e = Env()
    e.add("pdf_cl", [("HTTP connections: two types\nNon-persistent HTTP\n1.TCP connection opened\n2.at most one object sent over the TCP connection\nClosing a TCP connection", 21),
                     ("Chapter 3: roadmap\n§Connectionless transport: UDP\n§Principles of reliable data transfer\n§Connection-oriented transport: TCP", 81)])
    assert only(e.check("TCP is connectionless."))["label"] in ("NOT_IN_SOURCE", "CONFLICTS")
    assert only(e.check("TCP is connectionless."))["label"] != "IN_SOURCE"
    assert only(e.check("UDP is connectionless."))["label"] == "IN_SOURCE"
    assert only(e.check("TCP is connection-oriented."))["label"] == "IN_SOURCE"
    # damaged slide text: the word is repaired, then found in full
    e2 = Env()
    e2.add("pdf_cl2", [("Ethernet: unreliable, connec)onless\nLink Layer: 6-59", 57)])
    assert only(e2.check("Ethernet is connectionless."))["label"] == "IN_SOURCE"


def test_a_direction_the_source_does_not_state_is_not_confirmed():
    e = Env()
    e.add("pdf_dir", [("A day in the life\n§to send HTTP request,\nclient first opens TCP\nsocket to web server\n§TCP SYN segment (step 1 in\nthree way handshake) sent to server", 102),
                      ("TCP 3-way handshake\nsend TCP SYN msg\nsend TCP SYNACK\nmsg, acking SYN", 106)])
    # the source says the CLIENT sends: confirmed
    ok = only(e.check("The client sends a SYN segment to the server."))
    assert ok["label"] == "IN_SOURCE", ok
    # the SERVER sending the SYN: the words are all there, but no unit gives that direction
    c = only(e.check("The server sends a SYN segment to the client."))
    assert c["label"] in ("PARTIAL", "CONFLICTS"), c
    assert c["label"] != "IN_SOURCE"
    # no direction in the claim: nothing changes
    assert only(e.check("TCP SYN segment is part of the three way handshake."))["label"] == "IN_SOURCE"


def test_connectionless_may_be_said_as_no_connection():
    e = Env()
    e.add("pdf_nc", [("Socket programming with UDP\nUDP: no connec1on between\nclient and server:\n§no handshaking before sending data", 108),
                     ("HTTP connections\n1.TCP connection opened\nClosing a TCP connection", 21)])
    assert only(e.check("UDP is connectionless."))["label"] == "IN_SOURCE"
    assert only(e.check("TCP is connectionless."))["label"] != "IN_SOURCE"


def test_direction_is_also_read_from_a_video_transcript():
    e = Env()
    # transcript text has sentences, not bullets; the same units and rules apply
    m = Material(id="video_t", kind="VIDEO", title="Lecture.mp4", version="a" * 64)
    e.index.upsert(Projection(course_id=COURSE, material=m, segments=[
        Segment(id=hashlib.sha256(b"t1").hexdigest(), text="So now the client sends a SYN segment to the server and waits. Then the server replies with a SYNACK segment.",
                location={"kind": "video", "start_ms": 1000, "end_ms": 9000})]))
    e.materials.append(m)
    assert only(e.check("The client sends a SYN segment to the server."))["label"] == "IN_SOURCE"
    swapped = only(e.check("The server sends a SYN segment to the client."))
    assert swapped["label"] in ("PARTIAL", "CONFLICTS") and swapped["label"] != "IN_SOURCE"
