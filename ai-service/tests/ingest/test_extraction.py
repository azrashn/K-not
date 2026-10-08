"""Normalization rules (wbs2-handoff.md §5) and PDF validation/extraction (T2 parts, T11)."""

import pytest

from knot_ingest.errors import IngestFailure
from knot_ingest.extraction import extract_pdf
from knot_ingest.normalize import normalize_page_text
from knot_ingest.schemas import IngestErrorCode as E
from tests.ingest.support import fixture_bytes


def extract(data, max_pages=400, ratio=0.5):
    return extract_pdf(data, max_pages=max_pages, max_empty_page_ratio=ratio)


def failure(data, **kw) -> IngestFailure:
    with pytest.raises(IngestFailure) as err:
        extract(data, **kw)
    return err.value


# ---- normalization ---------------------------------------------------------------------------

def test_turkish_letters_and_math_symbols_survive():
    s = "İkili ığüşöç IĞÜŞÖÇ O(n²) n ≥ 2 ⌊log₂ n⌋ Ω Θ α − x"
    assert normalize_page_text(s) == s


def test_nfc_not_nfkc():
    decomposed = "Ağaç"  # Ağaç with combining marks
    assert normalize_page_text(decomposed) == "Ağaç"
    assert normalize_page_text("O(n²)") == "O(n²)"  # NFKC would give O(n2)


def test_ligatures_are_mapped_explicitly():
    assert normalize_page_text("ﬁnal ﬂow ﬀ ﬃ ﬄ") == "final flow ff ffi ffl"


def test_whitespace_and_control_characters():
    raw = "  a\t\tb  \r\nc  d \x07e\x00\r\r\r\rf  \n\n\n\n"
    assert normalize_page_text(raw) == "a b\nc d e\n\nf"


def test_hyphenation_joins_only_lowercase_continuations():
    assert normalize_page_text("hafta-\nlarda") == "haftalarda"
    assert normalize_page_text("ağaç-\nları") == "ağaçları"
    assert normalize_page_text("Ağaç-\nYapısı") == "Ağaç-\nYapısı"
    assert normalize_page_text("2-\n3") == "2-\n3"
    assert normalize_page_text("a -\nb") == "a -\nb"


def test_normalization_is_idempotent():
    s = normalize_page_text(" xﬁ-\nle  \r\n\n\n\ny ")
    assert normalize_page_text(s) == s


# ---- extraction ------------------------------------------------------------------------------

def test_slides_fixture_pages():
    d = extract(fixture_bytes("slides_tr.pdf"))
    assert d.page_count == 5 and d.empty_pages == 1 and d.warnings == ["PAGES_WITHOUT_TEXT:1"]
    assert d.page_texts[0] == "Veri Yapıları · Hafta 4\nAVL Ağaçları"
    assert d.page_texts[1] == ("İkili Arama Ağacı (BST)\nArama, ekleme ve silme ortalama O(log n) sürer. "
                               "Ağaç dengesizleşirse en kötü durum O(n) olur.")
    assert d.page_texts[2] == ""
    assert "|bf(v)| ≤ 1" in d.page_texts[3] and "h(sol) − h(sağ)" in d.page_texts[3]
    assert "⌊log₂ n⌋" in d.page_texts[4] and "O(n²)" in d.page_texts[4] and "Ω(log n) ve Θ(log n)" in d.page_texts[4]
    assert "final ekleme" in d.page_texts[4]  # ligature ﬁ mapped


def test_notes_fixture_hyphenation_and_ligature():
    d = extract(fixture_bytes("notes_tr.pdf"))
    assert d.page_count == 3 and d.empty_pages == 0
    assert "sonraki haftalarda tekrar" in d.page_texts[0] and "fluent okuma" in d.page_texts[0]
    assert "ı, İ, ğ, ş, ç, ö ve ü" in d.page_texts[2]


def test_extraction_is_deterministic():
    a = extract(fixture_bytes("notes_tr.pdf"))
    b = extract(fixture_bytes("notes_tr.pdf"))
    assert a == b


def test_scanned_pdf_has_no_text_layer():
    f = failure(fixture_bytes("scanned.pdf"))
    assert f.code is E.NO_TEXT_LAYER and not f.retryable
    assert f.message == "No extractable text on 3 of 3 pages."


def test_scanned_pdf_with_permissive_ratio_is_empty_document():
    assert failure(fixture_bytes("scanned.pdf"), ratio=1.0).code is E.EMPTY_DOCUMENT


def test_encrypted_pdf():
    f = failure(fixture_bytes("encrypted.pdf"))
    assert f.code is E.ENCRYPTED_PDF and not f.retryable


def test_too_many_pages():
    f = failure(fixture_bytes("slides_tr.pdf"), max_pages=4)
    assert f.code is E.TOO_LARGE and "5 pages" in f.message


def test_not_a_pdf():
    assert failure(b"\x89PNG\r\n\x1a\nnot a pdf").code is E.UNSUPPORTED_FORMAT
    assert failure(b"").code is E.UNSUPPORTED_FORMAT


@pytest.mark.parametrize("data", [
    b"%PDF-1.7\n%garbage that is not a pdf body\n",
    fixture_bytes("slides_tr.pdf")[:400],
    b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF",
])
def test_corrupt_pdfs(data):
    f = failure(data)
    assert f.code is E.CORRUPT_PDF and not f.retryable
