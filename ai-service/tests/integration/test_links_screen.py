"""Screen (OCR) matching between video frames and pages. OCR itself is faked; frames are real JPEGs."""

import base64
import hashlib
from types import SimpleNamespace

import chromadb
import cv2
import numpy as np
import pytest
from knot_rag import frame_text
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.links import Links, find_links, overlap
from knot_rag.unified import Material, Projection, Segment, UnifiedIndex

COURSE = "course-a"
SLIDE_6 = (
    "The Internet nuts and bolts view billions of connected computing devices hosts end systems "
    "packet switches forward packets routers switches communication links fiber copper radio satellite "
    "networks collection of devices managed by an organization"
)
SLIDE_11 = "What is a protocol human protocols network protocols define the format order of messages sent received"
OTHER_SLIDE = "Course syllabus grading policy midterm final project deliverables attendance office hours schedule"


def jpeg() -> str:
    ok, buf = cv2.imencode(".jpg", np.zeros((8, 8, 3), np.uint8))
    return base64.b64encode(buf.tobytes()).decode()


class FakeOcr:
    """Returns the next prepared text for each decoded frame."""

    def __init__(self, texts):
        self.texts = list(texts)

    def __call__(self, frame):
        text = self.texts.pop(0)
        return SimpleNamespace(txts=[text] if text else [], scores=[0.9] if text else [])


def mat(mid, kind, version="a"):
    return Material(id=mid, kind=kind, title=mid, version=version * 64)


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    index = UnifiedIndex(build_components(Settings(embedding_backend="hashing")), chromadb.EphemeralClient())
    notes, video = mat("pdf_notes", "PDF"), mat("video_lec", "VIDEO")
    segs = lambda m, items: [
        Segment(id=hashlib.sha256((m.id + str(i)).encode()).hexdigest(), text=t, location=loc)
        for i, (t, loc) in enumerate(items)
    ]
    index.upsert(Projection(course_id=COURSE, material=notes, segments=segs(notes, [
        (OTHER_SLIDE, {"kind": "page", "page": 2}),
        (SLIDE_6, {"kind": "page", "page": 6}),
        (SLIDE_11, {"kind": "page", "page": 11}),
    ])))
    # Transcript is useless on purpose (wrong-language noise): only the screen can match.
    index.upsert(Projection(course_id=COURSE, material=video, segments=segs(video, [
        ("bu bir sarki icin daha odelemediyor", {"kind": "video", "start_ms": 0, "end_ms": 40000}),
        ("haklı dağlı kelim stewardship", {"kind": "video", "start_ms": 400000, "end_ms": 440000}),
    ])))
    return SimpleNamespace(index=index, notes=notes, video=video)


def store(env, frames, version=None):
    """frames: [(start_ms, end_ms, ocr_text)] stored for the video."""
    body = frame_text.FrameText(
        course_id=COURSE,
        material_id=env.video.id,
        version=version or env.video.version,
        frames=[frame_text.FrameIn(start_ms=a, end_ms=b, image_base64=jpeg()) for a, b, _ in frames],
    )
    frame_text.save_batch(body, FakeOcr([t for *_, t in frames]))


def ask(env, material, **kw):
    body = Links(course_id=COURSE, materials=[env.notes, env.video], material_id=material.id, version=material.version, **kw)
    return find_links(env.index, body)


FRAMES = [
    (0, 100000, "Chapter 1 introduction"),
    (100000, 410000, OTHER_SLIDE),
    (410000, 500000, SLIDE_6),
    (500000, 560000, SLIDE_6 + " mobile network"),  # same slide still on screen
    (560000, 700000, SLIDE_11),
]


def test_overlap_is_share_of_the_smaller_set_and_needs_enough_terms():
    assert overlap({"a", "b", "c", "d", "e", "f"}, {"a", "b", "c", "x", "y"}) == pytest.approx(0.6)
    assert overlap({"a", "b"}, {"a", "b"}) == 0.0  # too short to judge


def test_page_finds_the_moment_its_slide_is_on_screen(env):
    store(env, FRAMES)
    out = ask(env, env.notes, page=6)
    link = out["links"][0]
    assert link["basis"] == "screen" and link["estimated"] is True
    assert link["material_id"] == "video_lec"
    # two consecutive frames show the slide: one moment starting at the first
    assert link["location"] == {"kind": "video", "start_ms": 410000, "end_ms": 560000}
    assert len(link["source_id"]) == 64
    assert out["frames_missing"] == []


def test_video_moment_finds_the_page_shown_on_screen(env):
    store(env, FRAMES)
    out = ask(env, env.video, time_ms=620000)
    assert out["links"][0]["basis"] == "screen"
    assert out["links"][0]["location"] == {"kind": "page", "page": 11}
    assert all(link["location"].get("page") != 6 for link in out["links"])


def test_below_half_overlap_is_not_a_match(env):
    store(env, [(0, 700000, "Chapter 1 introduction computer networks overview roadmap goals terminology")])
    assert ask(env, env.notes, page=6)["links"] == []
    assert ask(env, env.video, time_ms=10000)["links"] == []


def test_frames_not_read_yet_are_reported_not_guessed(env):
    out = ask(env, env.notes, page=6)
    assert out["links"] == [] and out["frames_missing"] == ["video_lec"]
    out = ask(env, env.video, time_ms=1000)
    assert out["frames_missing"] == ["video_lec"]


def test_frames_of_an_older_version_are_ignored(env):
    store(env, FRAMES, version="b" * 64)
    assert ask(env, env.notes, page=6)["frames_missing"] == ["video_lec"]


def test_empty_ocr_frame_never_matches(env):
    store(env, [(0, 700000, "")])
    out = ask(env, env.video, time_ms=5000)
    assert out["links"] == [] and out["frames_missing"] == []


def test_frame_store_is_batched_and_purged(env, tmp_path):
    first = frame_text.FrameText(course_id=COURSE, material_id="video_lec", version="a" * 64, first=True, final=False,
                                 frames=[frame_text.FrameIn(start_ms=0, end_ms=10, image_base64=jpeg())])
    frame_text.save_batch(first, FakeOcr(["one"]))
    assert frame_text.load(COURSE, "video_lec", "a" * 64) is None  # not complete yet
    last = frame_text.FrameText(course_id=COURSE, material_id="video_lec", version="a" * 64, first=False, final=True,
                                frames=[frame_text.FrameIn(start_ms=10, end_ms=20, image_base64=jpeg())])
    frame_text.save_batch(last, FakeOcr(["two"]))
    assert [f["text"] for f in frame_text.load(COURSE, "video_lec", "a" * 64)] == ["one", "two"]
    frame_text.purge(COURSE, "video_lec")
    assert frame_text.load(COURSE, "video_lec", "a" * 64) is None


def test_unsafe_ids_never_touch_the_disk(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    assert frame_text.load("../x", "video_a", "a" * 64) is None
    assert frame_text.load("course-a", "video_../a", "a" * 64) is None
