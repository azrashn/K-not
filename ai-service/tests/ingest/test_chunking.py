"""Chunking rules (wbs2-handoff.md §6): T2 offset invariant, T3 determinism, sizes, boundaries."""

import re

import pytest

from knot_ingest.chunking import (
    C1,
    build_chunks,
    build_page_artifact,
    check_invariants,
    chunk_spans,
    layout_pages,
)
from knot_ingest.extraction import extract_pdf
from knot_rag.schemas.documents import DocumentMetadata, DocumentType

T = DocumentType


def meta(doc_type=T.NOTES, doc="doc-1"):
    return DocumentMetadata(document_id=doc, course_id="c", owner_id="u", title="t", document_type=doc_type,
                            indexing_version="c1", page_count=1)


def chunks_for(page_texts, doc_type=T.NOTES):
    layout = layout_pages(page_texts)
    chunks = build_chunks(meta(doc_type), "job-1", layout, chunk_spans(layout, doc_type))
    check_invariants(layout, chunks)
    return layout, chunks


def fixture_pages(name):
    from tests.ingest.support import fixture_bytes

    return extract_pdf(fixture_bytes(name), max_pages=400, max_empty_page_ratio=0.5).page_texts


@pytest.mark.parametrize("name,doc_type", [("slides_tr.pdf", T.SLIDE), ("notes_tr.pdf", T.NOTES),
                                           ("notes_tr.pdf", T.TEXTBOOK), ("slides_tr.pdf", T.OTHER)])
def test_offset_invariant_on_fixtures(name, doc_type):
    layout, chunks = chunks_for(fixture_pages(name), doc_type)
    artifact = build_page_artifact("doc-1", "c1", layout)
    text = artifact.document_text()
    assert text == layout.text
    for c in chunks:
        loc = c.location
        assert c.text == text[loc.char_start:loc.char_end]
        first, last = artifact.pages[loc.page_start - 1], artifact.pages[loc.page_end - 1]
        assert first.char_start <= loc.char_start < first.char_end
        assert last.char_start < loc.char_end <= last.char_end
        assert c.text == c.text.strip() and len(c.text) <= C1.hard_max


def test_slides_one_chunk_per_page_with_titles_and_empty_page_skipped():
    layout, chunks = chunks_for(fixture_pages("slides_tr.pdf"), T.SLIDE)
    assert [(c.location.page_start, c.location.page_end) for c in chunks] == [(1, 1), (2, 2), (4, 4), (5, 5)]
    assert [c.location.section_title for c in chunks] == [
        "Veri Yapıları · Hafta 4", "İkili Arama Ağacı (BST)", "AVL Ağaçları: Denge Koşulu", "Karmaşıklık Özeti"]
    assert [c.chunk_id for c in chunks] == [f"doc-1:c1:00{i}" for i in range(1, 5)]
    assert all(c.extra == {"job_id": "job-1"} for c in chunks)
    # Turkish characters and symbols are preserved inside chunk text.
    assert "O(n²)" in chunks[3].text and "⌊log₂ n⌋" in chunks[3].text and "İkili" in chunks[1].text


def test_multi_page_chunk_includes_the_separator():
    layout, chunks = chunks_for(fixture_pages("notes_tr.pdf"), T.NOTES)
    multi = [c for c in chunks if c.location.page_end > c.location.page_start]
    assert multi, "the notes fixture must produce a chunk spanning pages"
    assert all("\n\n" in c.text for c in multi)
    assert any(c.location.page_end - c.location.page_start >= 2 for c in multi)  # pages 1–3


def test_overlap_is_bounded_and_starts_at_a_sentence():
    layout, chunks = chunks_for(fixture_pages("notes_tr.pdf"), T.NOTES)
    for prev, cur in zip(chunks, chunks[1:]):
        overlap = prev.location.char_end - cur.location.char_start
        assert 0 <= overlap <= C1.overlap
        if overlap:
            before = layout.text[:cur.location.char_start].rstrip(" ")
            assert before.endswith("\n") or before[-1] in ".!?…"


def test_determinism_identical_runs():
    a = chunks_for(fixture_pages("notes_tr.pdf"))[1]
    b = chunks_for(fixture_pages("notes_tr.pdf"))[1]
    assert [c.model_dump() for c in a] == [c.model_dump() for c in b]


SENT = "Bu cümle karma tabloları hakkında bir açıklamadır ve sınavda sorulabilir. "


def test_long_paragraph_splits_at_sentence_boundaries_within_bounds():
    _, chunks = chunks_for([SENT * 60])  # ~4,400 characters, no paragraph breaks
    assert len(chunks) >= 4
    for c in chunks:
        assert len(c.text) <= C1.hard_max
    cores = [c for c in chunks]
    for c in cores[:-1]:
        assert c.text.endswith(".")  # split after a sentence end, never inside a word


def test_whitespace_split_never_cuts_words():
    words = ["kelime{}".format(i) for i in range(400)]  # no sentence ends at all
    _, chunks = chunks_for([" ".join(words)])
    for c in chunks:
        for token in c.text.split():
            assert re.fullmatch(r"kelime\d+", token)
        assert len(c.text) <= C1.hard_max


def test_single_huge_token_is_hard_cut():
    _, chunks = chunks_for(["x" * 3000])
    assert sum(len(c.text) for c in chunks) >= 3000 and all(len(c.text) <= C1.hard_max for c in chunks)


def test_tiny_fragments_are_merged():
    pages = ["Başlık", "Kısa", "Bu sayfada yeterince uzun bir açıklama metni bulunmaktadır."]
    _, chunks = chunks_for(pages, T.SLIDE)
    assert len(chunks) == 1
    assert (chunks[0].location.page_start, chunks[0].location.page_end) == (1, 3)
    assert all(len(c.text) >= C1.min_chars for c in chunks_for(pages, T.NOTES)[1])


def test_long_slide_page_is_split_but_stays_on_its_page():
    page = "Uzun Slayt\n" + SENT * 40
    _, chunks = chunks_for(["Kapak sayfası başlığı", page], T.SLIDE)
    assert len(chunks) >= 3
    assert all(c.location.page_start == c.location.page_end == 2 for c in chunks[1:])
    assert all(c.location.section_title == "Uzun Slayt" for c in chunks[1:])


def test_prose_packs_small_paragraphs_up_to_target():
    pages = ["\n\n".join(["Paragraf {} için kısa ama anlamlı bir metin yazıldı.".format(i) for i in range(60)])]
    _, chunks = chunks_for(pages)
    assert all(len(c.text) <= C1.target_max + C1.overlap for c in chunks)
    assert len(chunks) >= 3


def test_non_bmp_and_combining_offsets_are_code_points():
    pages = ["Değişken 𝑛 ve 𝑚 için O(𝑛·𝑚) karmaşıklığı geçerlidir. " * 3, "İkinci sayfa 𝑥 ile devam eder ve biter."]
    layout, chunks = chunks_for(pages)
    for c in chunks:
        assert layout.text[c.location.char_start:c.location.char_end] == c.text
