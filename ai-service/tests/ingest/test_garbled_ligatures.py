from knot_ingest.extraction import garbled_ligature_count, repair_garbled_ligatures


def test_detects_misdecoded_ti_ligatures():
    assert garbled_ligature_count("applica8on layer, EncapsulaDon, Introduc)on") == 3
    assert garbled_ligature_count("The application layer uses encapsulation. iPhone 8 D-day") == 0


def test_page_with_enough_hits_is_repaired():
    raw = "applica8on EncapsulaDon Introduc)on of the transport layer"
    assert repair_garbled_ligatures(raw) == "application Encapsulation Introduction of the transport layer"


def test_clean_or_barely_affected_pages_are_untouched():
    assert repair_garbled_ligatures("Use 8 bits. The x8y token and McDonald stay.") == "Use 8 bits. The x8y token and McDonald stay."
    two = "applica8on and EncapsulaDon only"
    assert repair_garbled_ligatures(two) == two


def test_extract_pdf_repairs_page(monkeypatch):
    from knot_ingest import extraction

    class Page:
        def extract_text(self):
            return "applica8on EncapsulaDon Introduc)on of layers"

    class Reader:
        pages = [Page()]

    monkeypatch.setattr(extraction, "_open", lambda data: Reader())
    doc = extraction.extract_pdf(b"%PDF-1.4", max_pages=5, max_empty_page_ratio=0.5)
    assert doc.page_texts == ["application Encapsulation Introduction of layers"]


def test_real_pdf_with_ti_glyph_decoded_as_digit_is_repaired():
    from pathlib import Path
    from knot_ingest.extraction import extract_pdf

    data = (Path(__file__).parent / "fixtures" / "ligature_ti_as_digit.pdf").read_bytes()
    doc = extract_pdf(data, max_pages=10, max_empty_page_ratio=0.5)
    text = "\n".join(doc.page_texts)
    assert "application" in text and "Encapsulation" in text and "Introduction" in text
    assert garbled_ligature_count(text) == 0
