from knot_ingest import extraction
from knot_ingest.extraction import garbled_ligature_count


def test_detects_misdecoded_ti_ligatures():
    assert garbled_ligature_count("applica8on layer, EncapsulaDon, Introduc)on") == 3
    assert garbled_ligature_count("The application layer uses encapsulation. iPhone 8 D-day") == 0


def test_poppler_text_replaces_garbled_page(monkeypatch):
    garbled = "applica8on EncapsulaDon Introduc)on of the transport layer"
    clean = "application Encapsulation Introduction of the transport layer"
    monkeypatch.setattr(extraction, "_poppler_page_text", lambda data, number: clean)

    class Page:
        def extract_text(self):
            return garbled

    class Reader:
        pages = [Page()]

    monkeypatch.setattr(extraction, "_open", lambda data: Reader())
    doc = extraction.extract_pdf(b"%PDF-1.4", max_pages=5, max_empty_page_ratio=0.5)
    assert doc.page_texts == [clean]


def test_garbled_page_kept_when_poppler_is_not_better(monkeypatch):
    garbled = "applica8on EncapsulaDon Introduc)on of the transport layer"
    monkeypatch.setattr(extraction, "_poppler_page_text", lambda data, number: garbled)

    class Page:
        def extract_text(self):
            return garbled

    class Reader:
        pages = [Page()]

    monkeypatch.setattr(extraction, "_open", lambda data: Reader())
    doc = extraction.extract_pdf(b"%PDF-1.4", max_pages=5, max_empty_page_ratio=0.5)
    assert doc.page_texts == [garbled]
