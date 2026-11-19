"""Video <-> page links: real Chroma + deterministic hashing embedder, no model."""

import hashlib

import chromadb
import pytest
from fastapi import HTTPException
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.links import LINK_MIN_SIMILARITY, Links, find_links
from knot_rag.unified import Material, Projection, Segment, UnifiedIndex

TCP_NOTES = (
    "TCP bağlantı kurulumu üç yollu el sıkışma ile yapılır. TCP istemci SYN gönderir, "
    "sunucu SYN ACK ile yanıt verir, güvenilir bağlantı kurulur."
)
TCP_SPEECH = (
    "şimdi TCP bağlantı kurulumuna bakalım üç yollu el sıkışma ile istemci SYN gönderir "
    "sunucu SYN ACK ile yanıt verir ve güvenilir bağlantı kurulur"
)
UDP_NOTES = "UDP bağlantısız çalışır, datagram gönderir, sıra ve teslim garantisi vermez."
OFFTOPIC = "Bugün hava çok güzel, kantinde öğle yemeği için börek ve ayran vardı."

COURSE = "course-a"


def mat(mid, kind, version="a"):
    return Material(id=mid, kind=kind, title=mid, version=version * 64)


class Env:
    def __init__(self):
        self.index = UnifiedIndex(
            build_components(Settings(embedding_backend="hashing")), chromadb.EphemeralClient()
        )
        self.materials = {}

    def add(self, mid, kind, chunks, course=COURSE, version="a", register=True):
        m = mat(mid, kind, version)
        segments = [
            Segment(id=hashlib.sha256(f"{course}{mid}{version}{i}".encode()).hexdigest(), text=t, location=loc)
            for i, (t, loc) in enumerate(chunks)
        ]
        self.index.upsert(Projection(course_id=course, material=m, segments=segments))
        if register:
            self.materials[mid] = m
        return m

    def links(self, material_id, **kw):
        version = self.materials[material_id].version
        body = Links(
            course_id=COURSE,
            materials=list(self.materials.values()),
            material_id=material_id,
            version=version,
            **kw,
        )
        return find_links(self.index, body)["links"]


def page(n):
    return {"kind": "page", "page": n}


def video(a, b):
    return {"kind": "video", "start_ms": a * 1000, "end_ms": b * 1000}


@pytest.fixture(autouse=True)
def hashing_scale(monkeypatch):
    # The deterministic hashing embedder has its own score scale; the production value is for e5.
    import knot_rag.links as module

    monkeypatch.setattr(module, "LINK_MIN_SIMILARITY", 0.45)


@pytest.fixture
def env():
    e = Env()
    e.add("pdf_notes", "PDF", [(TCP_NOTES, page(4)), (UDP_NOTES, page(5)), (OFFTOPIC, page(6))])
    e.add(
        "video_lec",
        "VIDEO",
        [(OFFTOPIC, video(0, 60)), (TCP_SPEECH, video(300, 340)), (UDP_NOTES, video(400, 440))],
    )
    return e


def test_page_links_to_matching_video_moment(env):
    result = env.links("pdf_notes", page=4)
    assert result[0]["material_id"] == "video_lec"
    assert result[0]["location"] == {"kind": "video", "start_ms": 300000, "end_ms": 340000}
    assert result[0]["estimated"] is True
    assert len(result[0]["source_id"]) == 64
    assert "TCP" in result[0]["shared_terms"]
    assert len(result[0]["preview"]) <= 160


def test_video_moment_links_to_matching_page(env):
    result = env.links("video_lec", time_ms=310_000)
    assert result[0]["material_id"] == "pdf_notes"
    assert result[0]["location"] == {"kind": "page", "page": 4}


def test_no_shared_term_means_empty(env):
    # Page 6 and video 0-60 s are the same off-topic text, yet share only generic words with
    # the technical sections; a page about nothing technical has no anchored match in the video.
    env.add("pdf_other", "PDF", [("Mitokondri hücrenin enerji santralidir.", page(1))])
    assert env.links("pdf_other", page=1) == []


def test_below_threshold_is_empty(env, monkeypatch):
    import knot_rag.links as module

    monkeypatch.setattr(module, "LINK_MIN_SIMILARITY", 0.999)
    assert env.links("pdf_notes", page=4) == []
    assert 0.0 < LINK_MIN_SIMILARITY <= 1.0


def test_production_threshold_is_the_calibrated_e5_value():
    import importlib
    import knot_rag.links as module

    assert importlib.reload(module).LINK_MIN_SIMILARITY == 0.88


def test_own_material_is_excluded(env):
    # A video that contains the page text must never link to itself.
    env.add("video_lec", "VIDEO", [(TCP_SPEECH, video(10, 40)), (TCP_NOTES, video(500, 540))])
    result = env.links("video_lec", time_ms=20_000)
    assert all(r["material_id"] != "video_lec" for r in result)


def test_other_course_chunks_never_returned(env):
    env.add("video_foreign", "VIDEO", [(TCP_SPEECH, video(1, 30))], course="course-b", register=False)
    env.materials["video_foreign"] = mat("video_foreign", "VIDEO")  # even if listed, course differs
    result = env.links("pdf_notes", page=4)
    assert all(r["material_id"] != "video_foreign" for r in result)


def test_stale_version_not_returned(env):
    env.materials["video_lec"] = mat("video_lec", "VIDEO", version="b")  # manifest moved on
    assert env.links("pdf_notes", page=4) == []


def test_adjacent_video_chunks_merge(env):
    env.add(
        "video_lec",
        "VIDEO",
        [(TCP_SPEECH, video(300, 340)), (TCP_SPEECH + " TCP", video(345, 380)), (OFFTOPIC, video(900, 960))],
    )
    result = env.links("pdf_notes", page=4)
    assert len(result) == 1
    assert result[0]["location"] == {"kind": "video", "start_ms": 300000, "end_ms": 380000}


def test_at_most_three_results(env):
    env.add("pdf_notes", "PDF", [(TCP_NOTES, page(1))])
    env.add("pdf_notes2", "PDF", [(TCP_NOTES, page(1))])
    env.add(
        "video_lec",
        "VIDEO",
        [(TCP_SPEECH, video(i * 100, i * 100 + 40)) for i in range(6)],
    )
    result = env.links("pdf_notes", page=1)
    assert 1 <= len(result) <= 3
    pages = env.links("video_lec", time_ms=10_000)
    assert len(pages) <= 3


def test_wrong_source_kind_and_missing_material_rejected(env):
    with pytest.raises(HTTPException) as exc:
        env.links("video_lec", page=1)
    assert exc.value.status_code == 422
    body = Links(course_id=COURSE, materials=[], material_id="pdf_notes", version="a" * 64, page=4)
    with pytest.raises(HTTPException) as exc:
        find_links(env.index, body)
    assert exc.value.status_code == 404


def test_exactly_one_of_page_or_time():
    with pytest.raises(ValueError):
        Links(course_id=COURSE, materials=[], material_id="pdf_a", version="a" * 64)
    with pytest.raises(ValueError):
        Links(course_id=COURSE, materials=[], material_id="pdf_a", version="a" * 64, page=1, time_ms=1)
