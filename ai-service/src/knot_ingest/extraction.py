"""PDF validation and page-aware text extraction (pypdf, BSD licence, pinned).

No OCR: pages without a text layer become empty page texts. Never logs document text.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass

import pypdf
from pypdf.errors import FileNotDecryptedError

from knot_ingest.errors import IngestFailure
from knot_ingest.normalize import normalize_page_text
from knot_ingest.schemas import IngestErrorCode as E

log = logging.getLogger("knot_rag.ingest.extraction")

PDF_MAGIC = b"%PDF-"
# Extraction output is part of the c1 contract: a different pypdf version may extract
# different text, which would require a new indexing_version (wbs2-handoff.md §5).
PINNED_PYPDF_VERSION = "6.17.0"


@dataclass(frozen=True)
class ExtractedDocument:
    page_texts: list[str]  # normalized, physical page order; "" for pages without text
    empty_pages: int

    @property
    def page_count(self) -> int:
        return len(self.page_texts)

    @property
    def warnings(self) -> list[str]:
        return [f"PAGES_WITHOUT_TEXT:{self.empty_pages}"] if self.empty_pages else []


def _open(data: bytes) -> pypdf.PdfReader:
    try:
        reader = pypdf.PdfReader(io.BytesIO(data), strict=False)
    except FileNotDecryptedError as exc:
        raise IngestFailure(E.ENCRYPTED_PDF, "The PDF is password protected.") from exc
    except Exception as exc:  # pypdf raises many types for malformed files
        raise IngestFailure(E.CORRUPT_PDF, "The PDF could not be parsed.") from exc
    if reader.is_encrypted:
        try:
            decrypted = reader.decrypt("")  # permissions-only encryption has an empty user password
        except Exception as exc:  # unsupported algorithm / missing crypto backend
            raise IngestFailure(E.ENCRYPTED_PDF, "The PDF is encrypted.") from exc
        if decrypted == pypdf.PasswordType.NOT_DECRYPTED:
            raise IngestFailure(E.ENCRYPTED_PDF, "The PDF is password protected.")
    return reader


def extract_pdf(data: bytes, *, max_pages: int, max_empty_page_ratio: float) -> ExtractedDocument:
    if not data.startswith(PDF_MAGIC):
        raise IngestFailure(E.UNSUPPORTED_FORMAT, "The file is not a PDF.")
    reader = _open(data)
    try:
        page_count = len(reader.pages)
    except FileNotDecryptedError as exc:
        raise IngestFailure(E.ENCRYPTED_PDF, "The PDF is password protected.") from exc
    except Exception as exc:
        raise IngestFailure(E.CORRUPT_PDF, "The PDF page tree could not be read.") from exc
    if page_count > max_pages:
        raise IngestFailure(E.TOO_LARGE, f"The PDF has {page_count} pages; the limit is {max_pages}.")
    if page_count == 0:
        raise IngestFailure(E.EMPTY_DOCUMENT, "The PDF has no pages.")

    texts: list[str] = []
    for number, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except FileNotDecryptedError as exc:
            raise IngestFailure(E.ENCRYPTED_PDF, "The PDF is password protected.") from exc
        except Exception as exc:
            raise IngestFailure(E.CORRUPT_PDF, f"Page {number} could not be read.") from exc
        texts.append(normalize_page_text(raw))

    empty = sum(1 for t in texts if not t)
    if empty / page_count > max_empty_page_ratio:
        raise IngestFailure(E.NO_TEXT_LAYER, f"No extractable text on {empty} of {page_count} pages.")
    if empty == page_count:
        raise IngestFailure(E.EMPTY_DOCUMENT, "The PDF contains no readable text.")
    log.info("ingest.extracted", extra={"page_count": page_count, "empty_pages": empty,
                                        "characters": sum(len(t) for t in texts)})
    return ExtractedDocument(page_texts=texts, empty_pages=empty)
