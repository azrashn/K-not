"""Optional OCR for scanned PDF pages (Poppler `pdftoppm` + Tesseract, both external programs).

Off by default. It only runs on pages that have no text layer, and only for a document that would
otherwise be refused, so enabling it never changes the text of a document that is processed today.
Nothing from the file is passed to a shell: pages are numbers, the language is validated, and the
PDF goes through a private temporary directory.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

log = logging.getLogger("knot_rag.ingest.ocr")

LANGUAGES = re.compile(r"^[a-z]{3}(?:_[a-z]+)?(?:\+[a-z]{3}(?:_[a-z]+)?)*$")


def available() -> bool:
    return bool(shutil.which("pdftoppm") and shutil.which("tesseract"))


def valid_languages(value: str) -> bool:
    return bool(LANGUAGES.fullmatch(value or ""))


def ocr_pages(data: bytes, pages: list[int], languages: str, dpi: int, timeout: float = 120.0) -> dict[int, str]:
    """{page number: recognised text}. A page that fails is simply missing from the result."""
    if not valid_languages(languages) or not all(isinstance(p, int) and p >= 1 for p in pages):
        raise ValueError("invalid OCR request")
    out: dict[int, str] = {}
    with tempfile.TemporaryDirectory(prefix="knot-ocr-") as tmp:
        pdf = Path(tmp) / "in.pdf"
        pdf.write_bytes(data)
        for page in pages:
            base = Path(tmp) / f"p{page}"
            try:
                subprocess.run(
                    ["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(dpi), "-png", "-singlefile", str(pdf), str(base)],
                    check=True, capture_output=True, timeout=timeout,
                )
                done = subprocess.run(
                    ["tesseract", str(base) + ".png", "stdout", "-l", languages, "--psm", "6"],
                    check=True, capture_output=True, timeout=timeout,
                )
                out[page] = done.stdout.decode("utf-8", errors="replace")
            except (subprocess.SubprocessError, OSError) as exc:
                log.warning("ingest.ocr.page_failed", extra={"page": page, "error": type(exc).__name__})
    return out


@dataclass(frozen=True)
class OcrOptions:
    languages: str = "tur+eng"
    dpi: int = 200
    max_pages: int = 40
    run: Callable[[bytes, list[int], str, int], dict[int, str]] = ocr_pages
