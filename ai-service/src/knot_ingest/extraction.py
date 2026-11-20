"""PDF validation and page-aware text extraction (pypdf, BSD licence, pinned).

Pages without a text layer become empty page texts. OCR is optional (knot_ingest.ocr) and only
runs for a document that would otherwise be refused. Never logs document text.
"""

from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass

import pypdf
from pypdf.errors import FileNotDecryptedError

from knot_ingest.errors import IngestFailure
from knot_ingest.normalize import normalize_page_text
from knot_ingest.ocr import OcrOptions
from knot_ingest.schemas import IngestErrorCode as E

log = logging.getLogger("knot_rag.ingest.extraction")

PDF_MAGIC = b"%PDF-"
# Extraction output is part of the c1 contract: a different pypdf version may extract
# different text, which would require a new indexing_version (wbs2-handoff.md §5).
PINNED_PYPDF_VERSION = "6.17.0"


# pypdf bazı yazı tiplerinde "ti" ligatür glifini ToUnicode tablosu olmadan 8 / D / ) olarak çözer
# (applica8on, EncapsulaDon, Introduc)on). Kelime içinde küçük harflerle çevrili bu karakterler
# bozulma işaretidir; ")" kelime ortasında hiç meşru değildir.
_GARBLED_LIGATURE = re.compile(r"(?<=[a-z]{2})[8D)](?=[a-z]{2})")
GARBLED_PAGE_THRESHOLD = 3


def garbled_ligature_count(text: str) -> int:
    return len(_GARBLED_LIGATURE.findall(text))


def repair_garbled_ligatures(text: str) -> str:
    """Bozuk "ti" ligatürünü onarır: yalnızca bozulma eşiği aşılan sayfada, küçük harflerle çevrili
    8 / D / ) karakteri "ti" olur (applica8on → application). Poppler da aynı glifi çözemez
    (boşluk bırakır), bu yüzden onarım eşlemeyle yapılır."""
    if garbled_ligature_count(text) < GARBLED_PAGE_THRESHOLD:
        return text
    return _GARBLED_LIGATURE.sub("ti", text)


# Ders slaytlarının her sayfasında tekrar eden son satır ("Transport Layer 3", "Network Layer 4-12")
# yanıt kanıtına, alıntıya ve seslendirmeye karışıyor. Sayfaların en az yarısında (rakamlar
# yok sayılarak) aynı olan kısa son satır alt bilgi sayılır ve metinden çıkarılır.
FOOTER_MIN_PAGES = 3
FOOTER_MIN_SHARE = 0.5
FOOTER_MAX_CHARS = 60
_DIGITS = re.compile(r"\d+")


def _footer_key(line: str) -> str:
    return _DIGITS.sub("#", line.strip().lower())


def strip_repeated_footers(texts: list[str]) -> list[str]:
    nonempty = [t for t in texts if t]
    if len(nonempty) < FOOTER_MIN_PAGES:
        return texts
    last = {}
    for t in nonempty:
        line = t.rstrip().split("\n")[-1]
        if 0 < len(line) <= FOOTER_MAX_CHARS and "\n" in t.strip():
            last.setdefault(_footer_key(line), 0)
            last[_footer_key(line)] += 1
    repeated = {k for k, n in last.items() if n / len(nonempty) >= FOOTER_MIN_SHARE}
    if not repeated:
        return texts
    out = []
    for t in texts:
        lines = t.rstrip().split("\n")
        if t and len(lines) > 1 and _footer_key(lines[-1]) in repeated and len(lines[-1]) <= FOOTER_MAX_CHARS:
            t = "\n".join(lines[:-1]).rstrip()
        out.append(t)
    return out


@dataclass(frozen=True)
class ExtractedDocument:
    page_texts: list[str]  # normalized, physical page order; "" for pages without text
    empty_pages: int
    ocr_pages: tuple[int, ...] = ()  # 1-based pages whose text came from OCR, not from the file

    @property
    def page_count(self) -> int:
        return len(self.page_texts)

    @property
    def warnings(self) -> list[str]:
        out = [f"PAGES_WITHOUT_TEXT:{self.empty_pages}"] if self.empty_pages else []
        if self.ocr_pages:
            out.append("OCR_PAGES:" + ",".join(str(p) for p in self.ocr_pages))
        return out


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


def extract_pdf(data: bytes, *, max_pages: int, max_empty_page_ratio: float, ocr: OcrOptions | None = None) -> ExtractedDocument:
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
        raw = repair_garbled_ligatures(raw)
        texts.append(normalize_page_text(raw))

    texts = strip_repeated_footers(texts)
    empty = sum(1 for t in texts if not t)
    ocr_done: list[int] = []
    if ocr is not None and empty / page_count > max_empty_page_ratio and empty <= ocr.max_pages:
        # Only a document that would be refused gets OCR, so documents that work today keep their text.
        wanted = [n for n, t in enumerate(texts, start=1) if not t]
        try:
            recognised = ocr.run(data, wanted, ocr.languages, ocr.dpi)
        except Exception as exc:  # missing program, bad configuration: fall through to the usual refusal
            log.warning("ingest.ocr.unavailable", extra={"error": type(exc).__name__})
            recognised = {}
        for number, raw in recognised.items():
            clean = normalize_page_text(raw)
            if clean:
                texts[number - 1] = clean
                ocr_done.append(number)
        empty = sum(1 for t in texts if not t)
    if empty / page_count > max_empty_page_ratio:
        raise IngestFailure(E.NO_TEXT_LAYER, f"No extractable text on {empty} of {page_count} pages.")
    if empty == page_count:
        raise IngestFailure(E.EMPTY_DOCUMENT, "The PDF contains no readable text.")
    log.info("ingest.extracted", extra={"page_count": page_count, "empty_pages": empty,
                                        "characters": sum(len(t) for t in texts)})
    return ExtractedDocument(page_texts=texts, empty_pages=empty, ocr_pages=tuple(sorted(ocr_done)))
