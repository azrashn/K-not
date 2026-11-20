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
        assert c["missing_terms"]


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
