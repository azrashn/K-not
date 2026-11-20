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
