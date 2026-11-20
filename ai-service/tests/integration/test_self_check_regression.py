"""Regression for the browser test of 2026-11-20 (Computer Network course): Turkish student sentences against
English slide text, with number tables and a garbled video transcript among the sources. Every assertion
here is a mistake that was seen on screen."""

import hashlib

import chromadb
import pytest

from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.self_check import SelfCheck, self_check
from knot_rag.unified import Material, Projection, Segment, UnifiedIndex

COURSE = "course-net"
HANDSHAKE = "TCP 3-way handshake\nSYNbit=1, Seq=x\nclient first opens TCP socket to web server\nsend TCP SYN msg\nserver replies with SYNACK\nACKbit=1; ACKnum=x+1\nLink Layer: 6-57"
ETHERNET = "Ethernet frame structure\nsending interface encapsulates IP datagram in an Ethernet frame\npreamble: 7 bytes with pattern 10101010 followed by one byte 10101011\nLink Layer: 6-57"
MAC_TABLE = "222.222.222.220 111.111.111.110 E6-E9-00-17-BB-4B CC-49-DE-D0-AB-7D 88-B2-2F-54-1A-0F 49-BD-D2-C7-56-2A 1A-23-F9-CD-06-9B"
GARBLED = "Nenut cell工 teams научin what the internet has Hocada bu実 retaliту mıdır sonra the video"
UDP_TCP = "Connectionless transport: UDP\nUDP does not set up a connection\nConnection-oriented transport: TCP\nTCP provides reliable transport with a handshake"


def build():
    index = UnifiedIndex(build_components(Settings(embedding_backend="hashing")), chromadb.EphemeralClient())
    materials = []

    def add(mid, kind, chunks, title):
        m = Material(id=mid, kind=kind, title=title, version="a" * 64)
        segs = [Segment(id=hashlib.sha256(f"{mid}{i}".encode()).hexdigest(), text=t, location=loc) for i, (t, loc) in enumerate(chunks)]
        index.upsert(Projection(course_id=COURSE, material=m, segments=segs))
        materials.append(m)

    add("pdf_ch3", "PDF", [(HANDSHAKE, {"kind": "page", "page": 106}), (UDP_TCP, {"kind": "page", "page": 12})], "Chapter_3")
    add("pdf_ch6", "PDF", [(ETHERNET, {"kind": "page", "page": 55}), (MAC_TABLE, {"kind": "page", "page": 50})], "Chapter_6")
    add("video_intro", "VIDEO", [(GARBLED, {"kind": "video", "start_ms": 504500, "end_ms": 527340})], "Intro.mp4")
    return index, materials


@pytest.fixture(scope="module")
def env():
    return build()


def run(env, text, **kw):
    index, materials = env
    return self_check(index, SelfCheck(course_id=COURSE, materials=materials, text=text), **kw)


def none_translate(texts, target):
    return [None] * len(texts)


def test_missing_acronym_never_reads_as_in_source(env):
    # "UDP is connectionless and TCP uses AES": AES is in no source. The words UDP/TCP/connectionless are,
    # so the claim is partly found, never found.
    r = run(env, "UDP is connectionless and TCP uses AES encryption for every segment.", translate=none_translate)
    c = r["claims"][0]
    assert c["label"] == "PARTIAL", c
    assert [p["label"] for p in c["parts"]] == ["IN_SOURCE", "NOT_IN_SOURCE"]
    one = run(env, "TCP uses AES to encrypt segments.", translate=none_translate)["claims"][0]
    assert one["label"] == "NOT_IN_SOURCE"


def test_unreadable_sources_are_never_shown_or_used(env):
    r = run(env, "Quantum computers carry photons between satellites instantly.", translate=none_translate)
    c = r["claims"][0]
    assert c["label"] == "NOT_IN_SOURCE" and c["sources"] == []
    shown = " ".join(s["quote"] for c in run(env, "Hocada bu retaliti. Ethernet frame with preamble bytes pattern.", translate=none_translate)["claims"] for s in c["sources"])
    assert "工" not in shown and "научин" not in shown and "222.222" not in shown


def test_turkish_claim_that_cannot_be_compared_shows_no_sources(env):
    # no model, no usable glossary entry: nothing was compared, so nothing is shown as evidence
    r = run(env, "Kuantum bilgisayarlar fotonları uydular arasında anında taşır.", translate=none_translate)
    c = r["claims"][0]
    assert c["label"] in ("UNCHECKED", "NOT_IN_SOURCE")
    assert c["sources"] == []


def test_number_the_sources_do_not_give_is_not_a_partial_match(env):
    # the Ethernet page never states a minimum size: the number 128 is a specific the source lacks
    c = run(env, "Ethernet frame minimum size is 128 bytes.", translate=none_translate)["claims"][0]
    assert c["label"] == "NOT_IN_SOURCE", c


def test_handshake_in_turkish_is_found_when_the_model_translates_and_not_worse_without(env):
    claim = "TCP bağlantı kurulumunda istemci SYN gönderir ve sunucu SYNACK ile yanıt verir."
    whole = {claim.rstrip("."): "In the TCP handshake the client sends a SYN and the server replies with SYNACK"}
    with_model = run(env, claim, translate=lambda texts, target: [whole.get(t) for t in texts])["claims"][0]
    assert with_model["label"] == "IN_SOURCE" and with_model["sources"][0]["location"] == {"page": 106}
    without = run(env, claim, translate=none_translate)["claims"][0]
    assert without["label"] in ("IN_SOURCE", "PARTIAL", "UNCHECKED")  # never a conflict, never "not in source"
    assert without["label"] != "NOT_IN_SOURCE"


def test_opinion_and_questions_are_skipped(env):
    r = run(env, "Bence bu konu çok zor. Bu nasıl çalışır?", translate=none_translate)
    assert r["claims"] == [] and {s["reason"] for s in r["skipped"]} == {"OPINION", "QUESTION"}


def test_found_with_an_uncheckable_part_keeps_found_and_says_so(env):
    from knot_rag.self_check import _combine

    def sub(label):
        return {"text": "x", "label": label, "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}

    r = _combine("c", [sub("IN_SOURCE"), sub("UNCHECKED")])
    assert r["label"] == "IN_SOURCE" and r["partly_unchecked"] is True
