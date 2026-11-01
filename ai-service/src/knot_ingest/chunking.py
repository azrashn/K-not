"""Stable, offset-preserving chunking for `indexing_version = "c1"` (wbs2-handoff.md §6).

Every chunk is a span `[char_start, char_end)` of the document text (pages joined with
`"\\n\\n"`), so `chunk.text == document_text[char_start:char_end]` holds by construction.

c1 parameters (ADR record in docs/architecture/architecture-decisions.md):

* prose (`notes`, `textbook`, `past_exam`, `other`): paragraphs packed greedily up to
  1,200 characters; a paragraph longer than that is split at the last paragraph or sentence
  break that leaves ≥ 800 characters, else at the last whitespace (never inside a word);
* `slide`: one chunk per page; a page longer than 1,500 characters is split the same way;
* fragments shorter than 20 characters are merged into a neighbour;
* overlap (prose only): each chunk after the first is extended backwards by up to 150
  characters, starting at the earliest sentence (or line) start in that window, else the
  earliest word start, and never beyond the hard maximum of 1,500 characters. Slides get no
  overlap, so a slide chunk covers exactly its own page and its citation label names it;
* `section_title` (slides only): the first line of the page where the chunk's own content
  starts, if it is at most 300 characters.
"""

from __future__ import annotations

import bisect
from dataclasses import dataclass

from knot_ingest.schemas import PAGE_SEPARATOR, PageArtifact, PageText
from knot_rag.schemas.documents import DocumentMetadata, DocumentType, IndexedChunk, SourceLocation

SENTENCE_END = ".!?…"


@dataclass(frozen=True)
class ChunkerParams:
    target_min: int = 800
    target_max: int = 1200
    hard_max: int = 1500
    min_chars: int = 20
    overlap: int = 150
    section_title_max: int = 300


C1 = ChunkerParams()


@dataclass(frozen=True)
class PageSpan:
    page: int
    start: int
    end: int


@dataclass(frozen=True)
class ChunkSpan:
    start: int
    end: int
    page_start: int
    page_end: int
    section_title: str | None


@dataclass(frozen=True)
class DocumentLayout:
    text: str
    pages: list[PageSpan]

    def page_of(self, offset: int) -> int:
        starts = [p.start for p in self.pages]
        return self.pages[bisect.bisect_right(starts, offset) - 1].page


def layout_pages(page_texts: list[str]) -> DocumentLayout:
    pages: list[PageSpan] = []
    pos = 0
    for i, t in enumerate(page_texts, start=1):
        pages.append(PageSpan(i, pos, pos + len(t)))
        pos += len(t) + len(PAGE_SEPARATOR)
    return DocumentLayout(PAGE_SEPARATOR.join(page_texts), pages)


def build_page_artifact(document_id: str, indexing_version: str, layout: DocumentLayout) -> PageArtifact:
    return PageArtifact(
        document_id=document_id,
        indexing_version=indexing_version,
        page_count=len(layout.pages),
        pages=[PageText(page=p.page, char_start=p.start, char_end=p.end, text=layout.text[p.start:p.end])
               for p in layout.pages],
    )


# ---- span helpers -----------------------------------------------------------------------------

def _trim(text: str, s: int, e: int) -> tuple[int, int]:
    while s < e and text[s].isspace():
        s += 1
    while e > s and text[e - 1].isspace():
        e -= 1
    return s, e


def _paragraphs(text: str, page: PageSpan) -> list[tuple[int, int]]:
    out, s = [], page.start
    while s < page.end:
        i = text.find(PAGE_SEPARATOR, s, page.end)
        e = page.end if i < 0 else i
        ts, te = _trim(text, s, e)
        if te > ts:
            out.append((ts, te))
        s = e + len(PAGE_SEPARATOR) if i >= 0 else page.end
    return out


def _break_point(text: str, s: int, e: int, limit: int, floor: int) -> int:
    """End of the first piece of `[s, e)` (which is longer than `limit`)."""
    hi = s + limit
    lo = s + min(floor, limit)
    i = text.rfind(PAGE_SEPARATOR, lo, hi + 1)
    if i > s:
        return i
    for j in range(hi - 1, lo - 1, -1):  # sentence end followed by whitespace
        if text[j] in SENTENCE_END and j + 1 < e and text[j + 1].isspace():
            return j + 1
    for j in range(hi, s, -1):  # whitespace (never inside a word)
        if text[j].isspace():
            return j
    return hi  # a single "word" longer than the limit: unavoidable hard cut


def _split(text: str, s: int, e: int, limit: int, floor: int) -> list[tuple[int, int]]:
    pieces = []
    while e - s > limit:
        b = _break_point(text, s, e, limit, floor)
        ps, pe = _trim(text, s, b)
        if pe > ps:
            pieces.append((ps, pe))
        s, _ = _trim(text, b, e)
    if e > s:
        pieces.append((s, e))
    return pieces


def _merge_small(spans: list[tuple[int, int]], p: ChunkerParams) -> list[tuple[int, int]]:
    out = list(spans)
    i = 0
    while i < len(out):
        s, e = out[i]
        if e - s >= p.min_chars or len(out) == 1:
            i += 1
            continue
        if i > 0 and e - out[i - 1][0] <= p.hard_max:
            out[i - 1] = (out[i - 1][0], e)
            del out[i]
        elif i + 1 < len(out) and out[i + 1][1] - s <= p.hard_max:
            out[i + 1] = (s, out[i + 1][1])
            del out[i]
        else:
            i += 1
    return out


def _overlap_start(text: str, prev_start: int, core_start: int, core_end: int, p: ChunkerParams) -> int:
    budget = min(p.overlap, p.hard_max - (core_end - core_start))
    if budget <= 0:
        return core_start
    lo = max(prev_start, core_start - budget)
    word_start = None
    for k in range(lo, core_start):
        if text[k].isspace() or k == 0 or not text[k - 1].isspace():
            continue
        j = k - 1
        while j >= 0 and text[j].isspace() and text[j] != "\n":
            j -= 1
        if j < 0 or text[j] == "\n" or text[j] in SENTENCE_END:
            return k  # earliest sentence or line start
        if word_start is None:
            word_start = k
    return word_start if word_start is not None else core_start


# ---- public API -------------------------------------------------------------------------------

def chunk_spans(layout: DocumentLayout, document_type: DocumentType, p: ChunkerParams = C1) -> list[ChunkSpan]:
    text = layout.text
    if document_type is DocumentType.SLIDE:
        cores: list[tuple[int, int]] = []
        for page in layout.pages:
            s, e = _trim(text, page.start, page.end)
            if e > s:
                cores.extend(_split(text, s, e, p.hard_max, p.target_min))
    else:
        pieces = []
        for page in layout.pages:
            for s, e in _paragraphs(text, page):
                pieces.extend(_split(text, s, e, p.target_max, p.target_min))
        cores = []
        for s, e in pieces:
            if cores and e - cores[-1][0] <= p.target_max:
                cores[-1] = (cores[-1][0], e)
            else:
                cores.append((s, e))
    cores = _merge_small(cores, p)

    spans: list[ChunkSpan] = []
    for i, (s, e) in enumerate(cores):
        overlap = i > 0 and document_type is not DocumentType.SLIDE
        start = _overlap_start(text, cores[i - 1][0], s, e, p) if overlap else s
        title = None
        if document_type is DocumentType.SLIDE:
            page = layout.pages[layout.page_of(s) - 1]
            first_line = text[page.start:page.end].split("\n", 1)[0].strip()
            title = first_line if 0 < len(first_line) <= p.section_title_max else None
        spans.append(ChunkSpan(start, e, layout.page_of(start), layout.page_of(e - 1), title))
    return spans


def chunk_id(document_id: str, indexing_version: str, ordinal: int) -> str:
    return f"{document_id}:{indexing_version}:{ordinal:03d}"


def build_chunks(document: DocumentMetadata, job_id: str, layout: DocumentLayout, spans: list[ChunkSpan]) -> list[IndexedChunk]:
    return [
        IndexedChunk(
            chunk_id=chunk_id(document.document_id, document.indexing_version, n),
            document=document,
            text=layout.text[sp.start:sp.end],
            location=SourceLocation(page_start=sp.page_start, page_end=sp.page_end, char_start=sp.start,
                                    char_end=sp.end, section_title=sp.section_title),
            extra={"job_id": job_id},
        )
        for n, sp in enumerate(spans, start=1)
    ]


def check_invariants(layout: DocumentLayout, chunks: list[IndexedChunk], p: ChunkerParams = C1) -> None:
    """The source-traceability invariants; violating one is a bug (→ INTERNAL)."""
    for c in chunks:
        loc = c.location
        if c.text != layout.text[loc.char_start:loc.char_end]:
            raise AssertionError(f"{c.chunk_id}: text is not the document substring at its offsets")
        if loc.page_start != layout.page_of(loc.char_start) or loc.page_end != layout.page_of(loc.char_end - 1):
            raise AssertionError(f"{c.chunk_id}: page range does not match its offsets")
        if len(c.text) > p.hard_max:
            raise AssertionError(f"{c.chunk_id}: longer than the hard maximum")
