"""Past exam files become plain text; unreadable or textless files are refused, never invented."""

import base64
import io
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from knot_rag.exam_text import extract_exam_text
from knot_rag.unified import ExamFile

FIXTURES = Path(__file__).resolve().parents[1] / "ingest" / "fixtures"
QUESTION = "1. Aşağıdakilerden hangisi FIFO çalışır?\nA) Yığın\nB) Kuyruk\nC) Ağaç"


def docx(paragraphs, extra=None):
    body = "".join(
        f'<w:p><w:r><w:t xml:space="preserve">{p}</w:t></w:r></w:p>' for p in paragraphs
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", extra or document)
    return buffer.getvalue()


def test_txt_keeps_the_question_structure():
    text = extract_exam_text("TXT", QUESTION.encode("utf-8"))
    assert text.splitlines()[0].startswith("1. Aşağıdakilerden")
    assert "B) Kuyruk" in text


def test_docx_paragraphs_become_lines():
    raw = docx(["1. Dijkstra negatif kenarla çalışır mı?", "2. BFS hangi yapıyı kullanır?"])
    text = extract_exam_text("DOCX", raw)
    assert text.splitlines() == ["1. Dijkstra negatif kenarla çalışır mı?", "2. BFS hangi yapıyı kullanır?"]


def test_docx_with_entities_is_refused():
    evil = '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x "boom">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>'
    with pytest.raises(ValueError):
        extract_exam_text("DOCX", docx([], extra=evil))


def test_a_zip_that_is_not_a_word_document_is_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("hello.txt", "x" * 40)
    with pytest.raises(ValueError):
        extract_exam_text("DOCX", buffer.getvalue())


def test_pdf_with_a_text_layer_is_read():
    text = extract_exam_text("PDF", (FIXTURES / "notes_tr.pdf").read_bytes())
    assert len(text) > 50


@pytest.mark.parametrize("name", ["scanned.pdf", "encrypted.pdf"])
def test_scanned_or_encrypted_pdf_is_refused_not_guessed(name):
    with pytest.raises(Exception):
        extract_exam_text("PDF", (FIXTURES / name).read_bytes())


def test_text_that_is_not_a_pdf_is_refused():
    with pytest.raises(ValueError):
        extract_exam_text("PDF", b"this is not a pdf at all, just some text here")


def test_an_oversized_file_is_refused():
    with pytest.raises(ValueError):
        extract_exam_text("TXT", b"x" * (5 * 1024 * 1024 + 1))


def test_an_almost_empty_file_is_refused():
    with pytest.raises(ValueError):
        extract_exam_text("TXT", b"  \n  ")


def test_long_text_is_cut_to_the_limit():
    long = ("1. soru metni " * 8000).encode("utf-8")
    assert len(extract_exam_text("TXT", long)) <= 60000


def test_request_model_accepts_only_known_kinds():
    ExamFile(kind="DOCX", content=base64.b64encode(b"x").decode())
    with pytest.raises(Exception):
        ExamFile(kind="EXE", content="eA==")
