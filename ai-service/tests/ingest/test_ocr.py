"""Optional OCR: only for documents that would be refused, never for ones that work today."""

import io
from pathlib import Path

import pytest

from knot_ingest import ocr as ocr_module
from knot_ingest.config import IngestSettings
from knot_ingest.errors import IngestFailure
from knot_ingest.extraction import extract_pdf
from knot_ingest.ocr import OcrOptions, valid_languages
from knot_ingest.schemas import IngestErrorCode as E

FIXTURES = Path(__file__).parent / "fixtures"
SCANNED = (FIXTURES / "scanned.pdf").read_bytes()
TEXTUAL = (FIXTURES / "notes_tr.pdf").read_bytes()


def fake(calls, pages_text):
    def run(data, pages, languages, dpi):
        calls.append((list(pages), languages, dpi))
        return {p: pages_text for p in pages}
    return run


def pages_in(data):
    import pypdf
    return len(pypdf.PdfReader(io.BytesIO(data)).pages)


def test_a_scanned_pdf_is_refused_without_ocr():
    with pytest.raises(IngestFailure) as exc:
        extract_pdf(SCANNED, max_pages=400, max_empty_page_ratio=0.5)
    assert exc.value.code == E.NO_TEXT_LAYER


def test_with_ocr_the_text_comes_from_the_scan_and_is_marked_as_ocr():
    calls = []
    doc = extract_pdf(SCANNED, max_pages=400, max_empty_page_ratio=0.5,
                      ocr=OcrOptions(run=fake(calls, "Kuyruk ilk giren ilk çıkar yapısıdır.")))
    assert all("Kuyruk" in t for t in doc.page_texts)
    assert doc.ocr_pages == tuple(range(1, pages_in(SCANNED) + 1))
    assert any(w.startswith("OCR_PAGES:") for w in doc.warnings)
    assert calls and calls[0][1:] == ("tur+eng", 200)


def test_a_document_that_works_today_is_never_sent_to_ocr():
    calls = []
    doc = extract_pdf(TEXTUAL, max_pages=400, max_empty_page_ratio=0.5, ocr=OcrOptions(run=fake(calls, "başka metin")))
    assert calls == []
    assert doc.ocr_pages == ()
    assert extract_pdf(TEXTUAL, max_pages=400, max_empty_page_ratio=0.5).page_texts == doc.page_texts


def test_ocr_that_reads_nothing_still_ends_in_the_usual_refusal():
    with pytest.raises(IngestFailure) as exc:
        extract_pdf(SCANNED, max_pages=400, max_empty_page_ratio=0.5, ocr=OcrOptions(run=fake([], "   ")))
    assert exc.value.code == E.NO_TEXT_LAYER


def test_a_missing_program_falls_back_to_the_usual_refusal():
    def broken(*args):
        raise FileNotFoundError("tesseract")
    with pytest.raises(IngestFailure) as exc:
        extract_pdf(SCANNED, max_pages=400, max_empty_page_ratio=0.5, ocr=OcrOptions(run=broken))
    assert exc.value.code == E.NO_TEXT_LAYER


def test_too_many_empty_pages_are_not_attempted():
    calls = []
    with pytest.raises(IngestFailure):
        extract_pdf(SCANNED, max_pages=400, max_empty_page_ratio=0.5, ocr=OcrOptions(max_pages=0, run=fake(calls, "x")))
    assert calls == []


def test_settings_validate_the_ocr_options():
    base = {"INGEST_ENABLED": "true", "STORAGE_ROOT": str(FIXTURES), "NESTJS_INTERNAL_URL": "http://x", "INGEST_CALLBACK_TOKEN": "t"}
    assert IngestSettings.from_env(base).ocr_enabled is False
    on = IngestSettings.from_env({**base, "INGEST_OCR_ENABLED": "true"})
    assert (on.ocr_enabled, on.ocr_languages, on.ocr_dpi) == (True, "tur+eng", 200)
    from knot_rag.errors import ConfigurationError
    for bad in ({"INGEST_OCR_LANGUAGES": "tur; rm -rf /"}, {"INGEST_OCR_DPI": "10"}, {"INGEST_OCR_MAX_PAGES": "0"}):
        with pytest.raises(ConfigurationError):
            IngestSettings.from_env({**base, "INGEST_OCR_ENABLED": "true", **bad})


def test_language_codes_are_validated_before_any_program_runs():
    assert valid_languages("tur+eng") and valid_languages("eng") and valid_languages("chi_sim+eng")
    for bad in ("", "tur;eng", "../x", "tur eng", "TUR", "tur+"):
        assert not valid_languages(bad)
    with pytest.raises(ValueError):
        ocr_module.ocr_pages(b"%PDF-", [1], "tur;ls", 200)
    with pytest.raises(ValueError):
        ocr_module.ocr_pages(b"%PDF-", [0], "tur", 200)


@pytest.mark.skipif(not ocr_module.available(), reason="Poppler and Tesseract are not installed")
def test_real_tesseract_reads_a_scanned_page_in_turkish():
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 48)
    image = Image.new("RGB", (1500, 300), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 40), "Kuyruk ilk giren ilk çıkar", fill="black", font=font)
    draw.text((40, 150), "yapısıdır ve düğümleri gezer", fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, "PDF", resolution=200)  # an image-only PDF: no text layer
    doc = extract_pdf(buffer.getvalue(), max_pages=10, max_empty_page_ratio=0.5, ocr=OcrOptions(languages="tur+eng", dpi=200))
    text = doc.page_texts[0].lower()
    assert "kuyruk" in text and "giren" in text
    assert doc.ocr_pages == (1,)


def test_the_service_hands_the_ocr_settings_to_the_job_runner(harness):
    harness.build(ocr_enabled=True, ocr_languages="eng", ocr_dpi=150, ocr_max_pages=7)
    settings = harness.service.worker._run.__self__._s
    assert (settings.ocr_enabled, settings.ocr_languages, settings.ocr_dpi, settings.ocr_max_pages) == (True, "eng", 150, 7)


def test_a_scanned_pdf_is_ingested_end_to_end_when_ocr_is_enabled(harness, monkeypatch):
    """Through the real job runner: no text layer, OCR on (scripted reader) → the document reaches READY."""
    from knot_ingest import extraction

    real = extraction.extract_pdf
    monkeypatch.setattr("knot_ingest.pipeline.extract_pdf", lambda data, **kw: real(
        data, **{**kw, "ocr": OcrOptions(run=lambda d, pages, lang, dpi: {p: "Kuyruk ilk giren ilk çıkar yapısıdır." for p in pages})}
        if kw.get("ocr") else kw))
    harness.build(ocr_enabled=True)
    req = harness.request("doc-scan", "scanned.pdf")
    harness.service.accept(req)
    harness.service.worker.run_pending()
    types = [t for t, _ in harness.stub.types(req["job_id"])]
    assert types[-1] == "SUCCEEDED", types
