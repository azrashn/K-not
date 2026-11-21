"""Page text layer (word boxes from Poppler's pdftotext -bbox-layout) for marking a quoted sentence."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi import HTTPException

from knot_rag import visuals

FIXTURES = Path(__file__).resolve().parents[1] / "ingest" / "fixtures"
VERSION = "a" * 64

MARKUP = """<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><doc>
  <page width="200.0" height="100.0"><flow><block>
    <line><word xMin="10" yMin="10" xMax="50" yMax="20">Veri</word><word xMin="55" yMin="10" xMax="100" yMax="20">tip-</word></line>
    <line><word xMin="10" yMin="25" xMax="40" yMax="35">leri</word><word xMin="45" yMin="25" xMax="250" yMax="35">&amp;ilkel</word></line>
    <line><word xMin="1" yMin="1" xMax="2" yMax="2">  </word></line>
  </block></flow></page></doc></body></html>"""


def test_markup_becomes_lines_of_words_in_page_fractions():
    assert visuals.parse_bbox_layout(MARKUP) == [
        [["Veri", 0.05, 0.1, 0.25, 0.2], ["tip-", 0.275, 0.1, 0.5, 0.2]],
        [["leri", 0.05, 0.25, 0.2, 0.35], ["&ilkel", 0.225, 0.25, 1.0, 0.35]],  # clamped to the page
    ]


def test_markup_without_a_page_size_has_no_layer():
    assert visuals.parse_bbox_layout('<html xmlns="http://www.w3.org/1999/xhtml"><body><doc><page width="0" height="0"/></doc></body></html>') == []


def test_word_limit_is_kept(monkeypatch):
    monkeypatch.setattr(visuals, "TEXT_LAYER_MAX_WORDS", 3)
    assert sum(len(line) for line in visuals.parse_bbox_layout(MARKUP)) == 3


def test_pdftotext_is_found_next_to_the_configured_pdftoppm(monkeypatch, tmp_path):
    monkeypatch.delenv("PDFTOTEXT_PATH", raising=False)
    renderer = tmp_path / "pdftoppm.exe"
    renderer.write_bytes(b"")
    (tmp_path / "pdftotext.exe").write_bytes(b"")
    monkeypatch.setenv("PDFTOPPM_PATH", str(renderer))
    assert visuals.pdftotext_path() == str(tmp_path / "pdftotext.exe")
    monkeypatch.setenv("PDFTOTEXT_PATH", "C:/explicit/pdftotext.exe")
    assert visuals.pdftotext_path() == "C:/explicit/pdftotext.exe"


def test_missing_pdftotext_is_503(monkeypatch, tmp_path):
    body = _material(monkeypatch, tmp_path, "notes_tr.pdf")
    monkeypatch.setattr(visuals, "pdftotext_path", lambda: None)
    with pytest.raises(HTTPException) as err:
        visuals.text_layer(body)
    assert err.value.status_code == 503


def _material(monkeypatch, tmp_path, fixture):
    target = tmp_path / "documents" / "doc1" / "original.pdf"
    target.parent.mkdir(parents=True)
    shutil.copyfile(FIXTURES / fixture, target)
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    return visuals.Visual(course_id="c1", material_id="pdf_doc1", version=VERSION,
                          storage_key="documents/doc1/original.pdf", page=1)


def test_endpoint_returns_word_boxes_from_mocked_pdftotext(monkeypatch, tmp_path):
    """Runs without Poppler: pdftotext's output is faked, the endpoint's own path is exercised."""
    body = _material(monkeypatch, tmp_path, "notes_tr.pdf")
    monkeypatch.setattr(visuals, "pdftotext_path", lambda: "fake-pdftotext")
    calls = []

    def fake_run(args, timeout):
        calls.append(args)
        Path(args[-1]).write_text(MARKUP, encoding="utf-8")

    monkeypatch.setattr(visuals, "run", fake_run)
    out = visuals.text_layer(body)
    assert calls and calls[0][0] == "fake-pdftotext" and "-bbox-layout" in calls[0]
    assert calls[0][calls[0].index("-f") + 1] == "1" and calls[0][calls[0].index("-l") + 1] == "1"
    assert out["material_id"] == "pdf_doc1" and out["page"] == 1 and out["page_count"] >= 1
    assert out["lines"] == visuals.parse_bbox_layout(MARKUP)
    # Second call comes from the cache; the raw markup is not kept.
    monkeypatch.setattr(visuals, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran again")))
    assert visuals.text_layer(body)["lines"] == out["lines"]
    assert not list((tmp_path / ".previews").rglob("*.bbox.html"))


def _working_pdftotext():
    """The pdftotext the service would use (PDFTOTEXT_PATH, next to PDFTOPPM_PATH, or PATH), if it actually runs."""
    executable = visuals.pdftotext_path()
    if not executable:
        return None
    try:
        visuals.run([executable, "-f", "1", "-l", "1", str(FIXTURES / "notes_tr.pdf"), "-"], 30)
    except (subprocess.SubprocessError, OSError):
        return None
    return executable


PDFTOTEXT = _working_pdftotext()
needs_poppler = pytest.mark.skipif(
    not PDFTOTEXT,
    reason="Poppler pdftotext not found or not runnable (set PDFTOTEXT_PATH, or put pdftotext on PATH / next to PDFTOPPM_PATH)",
)


@needs_poppler
def test_a_real_page_gives_its_words_and_is_cached(monkeypatch, tmp_path):
    monkeypatch.setenv("PDFTOTEXT_PATH", PDFTOTEXT)
    body = _material(monkeypatch, tmp_path, "notes_tr.pdf")
    out = visuals.text_layer(body)
    assert out["page"] == 1 and out["page_count"] >= 1
    first = out["lines"][0][0]
    assert first[0] == "Karma" and all(0 <= v <= 1 for v in first[1:])
    # Second call: from the cache, no program is run.
    monkeypatch.setattr(visuals, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran again")))
    assert visuals.text_layer(body)["lines"] == out["lines"]
    assert not list((tmp_path / ".previews").rglob("*.bbox.html"))  # the raw markup is not kept


@needs_poppler
def test_a_scanned_page_has_an_empty_layer(monkeypatch, tmp_path):
    monkeypatch.setenv("PDFTOTEXT_PATH", PDFTOTEXT)
    assert visuals.text_layer(_material(monkeypatch, tmp_path, "scanned.pdf"))["lines"] == []
