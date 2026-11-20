"""Plain text of an uploaded past exam (PDF, DOCX or TXT).

Nothing in the file is executed: DOCX is read as a ZIP of XML without entities, PDF pages are
read with pypdf text extraction only. The result is bounded so a large file cannot flood a prompt.
"""

import io
import re
import zipfile
import xml.etree.ElementTree as ET

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 60000
MAX_PDF_PAGES = 60
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _txt(content: bytes) -> str:
    return content.decode("utf-8-sig", errors="strict")


def _docx(content: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        infos = archive.infolist()
        if len(infos) > 2000 or len({i.filename for i in infos}) != len(infos):
            raise ValueError("Archive entry limit or duplicate name")
        if sum(i.file_size for i in infos) > 30 * 1024 * 1024 or any(i.flag_bits & 1 for i in infos):
            raise ValueError("Encrypted or oversized archive")
        names = {i.filename for i in infos}
        if "word/document.xml" not in names or "[Content_Types].xml" not in names:
            raise ValueError("Not a Word document")
        raw = archive.read("word/document.xml")
    if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper() or b"\x00" in raw:
        raise ValueError("XML entities are not allowed")
    root = ET.fromstring(raw)
    lines = []
    for paragraph in root.iter(W + "p"):
        parts = []
        for node in paragraph.iter():
            if node.tag == W + "t" and node.text:
                parts.append(node.text)
            elif node.tag in (W + "tab",):
                parts.append(" ")
            elif node.tag in (W + "br", W + "cr"):
                parts.append("\n")
        lines.append("".join(parts))
    return "\n".join(lines)


def _pdf(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        raise ValueError("Encrypted PDF")
    pages = reader.pages[:MAX_PDF_PAGES]
    return "\n".join((page.extract_text() or "") for page in pages)


def extract_exam_text(kind: str, content: bytes) -> str:
    if len(content) > MAX_BYTES:
        raise ValueError("File exceeds 5 MiB")
    if kind == "TXT":
        text = _txt(content)
    elif kind == "DOCX":
        text = _docx(content)
    elif kind == "PDF":
        if not content.startswith(b"%PDF-"):
            raise ValueError("Not a PDF")
        text = _pdf(content)
    else:
        raise ValueError("Unsupported kind")
    text = _clean(text)
    if len(text) < 20:
        # A scanned PDF has no text layer; say so instead of returning an empty exam.
        raise ValueError("No extractable text")
    return text[:MAX_CHARS]
