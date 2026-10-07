import pytest
from pydantic import ValidationError

from knot_rag.schemas import AnswerRequest, IndexedChunk, SourceLocation, SupportStatus
from tests.fakes import scope


def test_page_range_defaults_end_to_start():
    assert SourceLocation(page_start=4).page_end == 4


def test_page_range_must_be_ordered():
    with pytest.raises(ValidationError):
        SourceLocation(page_start=5, page_end=4)


def test_char_offsets_must_come_in_pairs():
    with pytest.raises(ValidationError):
        SourceLocation(char_start=3)


def test_page_label_handles_ranges_and_unknown():
    assert SourceLocation(page_start=2, page_end=3).page_label() == "s.2–3"
    assert SourceLocation().page_label() is None


def test_chroma_roundtrip_preserves_ranges_and_omits_unknowns(corpus):
    multi = next(c for c in corpus if c.location.page_end and c.location.page_end != c.location.page_start)
    meta = multi.to_chroma_metadata()
    assert None not in meta.values()
    assert IndexedChunk.from_chroma(multi.chunk_id, multi.text, meta) == multi

    no_page = next(c for c in corpus if c.location.page_start is None)
    meta = no_page.to_chroma_metadata()
    assert "page_start" not in meta
    assert IndexedChunk.from_chroma(no_page.chunk_id, no_page.text, meta).location.page_start is None


def test_request_rejects_unknown_fields_and_bad_ids():
    with pytest.raises(ValidationError):
        AnswerRequest(question="AVL?", scope=scope(), is_admin=True)
    with pytest.raises(ValidationError):
        AnswerRequest(question="AVL?", scope=scope(document_ids=["../etc/passwd"]))
    with pytest.raises(ValidationError):
        AnswerRequest(question="AVL?", scope=scope(document_ids=[]))


def test_scope_document_ids_are_deduplicated():
    req = AnswerRequest(question="AVL?", scope=scope(document_ids=["a", "b", "a"]))
    assert req.scope.document_ids == ["a", "b"]


def test_question_length_limit():
    with pytest.raises(ValidationError):
        AnswerRequest(question="a" * 2001, scope=scope())


def test_support_status_ui_labels():
    assert [s.ui_label for s in SupportStatus] == ["SIKI", "GEVEŞEK", "KOPUK"]
