"""Language utilities shared by query processing, context building and support checks.

Turkish-aware: `İ`/`I` case-fold correctly, diacritics are never stripped from user-visible
text, and technical tokens such as LL, RR, LR, RL, AVL, BST, O(log n) survive.
"""

from __future__ import annotations

import math
import re
import unicodedata

_CONTROL = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏  ﻿]")
_WS = re.compile(r"\s+")
_WORD = re.compile(r"\w+", re.UNICODE)
_NUMBER = re.compile(r"(?<![\w])\d+(?:[.,]\d+)?")

# Small function-word lists; content words and technical terms are kept.
STOPWORDS = frozenset(
    """
    ve veya ile ya da de da ki mi mı mu mü bu şu o bir için gibi daha en çok az ise olan olur
    olarak her hem ama fakat ancak yani diye kadar sonra önce göre nasıl neden nedir ne hangi
    ise iki tüm bütün aynı bunu şunu buna onun bunun var yok değil
    bunlar bunları bunların bunlara bunlardan şunlar şunları onlar onları onların onlara onu ona
    these those they them their its
    the a an and or of to in on for is are be as by with that this it what how why which
    """.split()
)


def normalize_text(text: str) -> str:
    """Display-safe normalization: NFC, drop control/zero-width chars, collapse whitespace.
    Case and diacritics are preserved."""
    text = unicodedata.normalize("NFC", text)
    text = _CONTROL.sub(" ", text)
    return _WS.sub(" ", text).strip()


def fold(text: str) -> str:
    """Matching key: Turkish-aware lower-casing, whitespace collapsed.

    `I`→`ı` and `İ`→`i` follow Turkish rules; afterwards dotless `ı` is mapped to `i` so that
    text typed without Turkish keyboard (e.g. "agaci") still matches "ağacı" partially, the
    same tolerance the frontend's `norm()` uses.
    """
    text = normalize_text(text).replace("İ", "i").replace("I", "ı").lower()
    text = text.replace("ı", "i").replace("̇", "")
    return text


def content_tokens(text: str) -> list[str]:
    """Folded content tokens. Uppercase short identifiers (LL, RR, AVL, BST) are kept even
    when shorter than the normal minimum length."""
    out: list[str] = []
    for m in _WORD.finditer(normalize_text(text)):
        raw = m.group(0)
        tok = fold(raw)
        if tok in STOPWORDS:
            continue
        if len(tok) < 3 and not (raw.isupper() and len(raw) >= 2) and not tok.isdigit():
            continue
        out.append(tok)
    return out


def numbers(text: str) -> set[str]:
    return {n.replace(",", ".") for n in _NUMBER.findall(normalize_text(text))}


def estimate_tokens(text: str, chars_per_token: float) -> int:
    return max(1, math.ceil(len(text) / chars_per_token))


def find_folded(haystack: str, needle: str) -> tuple[int, int] | None:
    """Locate `needle` in `haystack` ignoring case/whitespace differences.

    Returns offsets in the *original* haystack, or None. Used for quote verification and
    highlight spans, so it must never approximate: either an exact folded match or nothing.
    """
    n = fold(needle)
    if not n:
        return None
    # Build folded haystack with an index map back to original offsets.
    folded_chars: list[str] = []
    index_map: list[int] = []
    prev_space = True
    for i, ch in enumerate(unicodedata.normalize("NFC", haystack)):
        if ch.isspace() or _CONTROL.match(ch):
            if prev_space:
                continue
            folded_chars.append(" ")
            index_map.append(i)
            prev_space = True
            continue
        f = fold(ch) or ch
        for c in f:
            folded_chars.append(c)
            index_map.append(i)
        prev_space = False
    folded = "".join(folded_chars)
    pos = folded.find(n)
    if pos < 0:
        return None
    start = index_map[pos]
    end = index_map[pos + len(n) - 1] + 1
    return start, end


# Interrogatives and generic academic verbs that say *how* something is asked, not *what*
# is asked about. Used only for question↔claim/evidence relevance, never for retrieval.
QUESTION_STOPWORDS = frozenset(
    fold(w)
    for w in """
    nedir nelerdir neler nasıl nasıldır kaç kaçtır hangi hangisi hangileri midir mıdır mudur müdür
    olabilir vardır yapılır uygulanır açıkla açıklayınız anlat anlatınız karşılaştır karşılaştırınız
    karşılaştırması peki çalışır çalışmaktadır hesaplanır yöntem yöntemi yöntemleri yönteminde
    işlem işlemi işlemleri arasındaki gerekir gerektirir olur oluşur sağlanır kullanılır tutulur
    işe yarar yararı yarıyor amacı kısaca yapar yapmak komut komutu komutları komutlar
    explain what how which does is are do used use purpose mean means command commands
    merhaba selam selamlar hocam lütfen teşekkürler hello hi please thanks
    """.split()
)
_NE_ZAMAN = re.compile(r"\bne\s+zaman\b", re.IGNORECASE)
STEM_CHARS = 5

NEGATION_WORDS = frozenset(fold(w) for w in "değil değildir yok yoktur hiçbir asla not no never cannot".split())
_NEG_SUFFIX = ("maz", "mez", "mazlar", "mezler", "mamaktadır", "memektedir", "mıyor", "miyor", "muyor", "müyor")


_ASCII = str.maketrans("çğıöşüâîû", "cgiosuaiu")


def stem(token: str) -> str:
    """Crude prefix stem for Turkish agglutination (`rotasyonlar` ~ `rotasyon`), ASCII-folded
    so questions typed without a Turkish keyboard (`faktoru`) still match `faktörü`."""
    return token.translate(_ASCII)[:STEM_CHARS]


def stems_match(a: str, b: str) -> bool:
    """Stems are compatible if equal, or one is a prefix (≥4 chars) of the other:
    `agac` (ağaç) ~ `agaci` (ağacı), `rotas` ~ `rotas`."""
    if a == b:
        return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 4 and long_.startswith(short)


def stem_in(s: str, pool: set[str]) -> bool:
    return s in pool or any(stems_match(s, p) for p in pool)


def question_key_terms(question: str) -> list[tuple[str, str]]:
    """(surface form, folded token) pairs for the content terms of a question, deduplicated
    by stem, in question order."""
    text = _NE_ZAMAN.sub(" ", normalize_text(question))
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in _WORD.finditer(text):
        raw = m.group(0)
        tok = fold(raw)
        if tok in STOPWORDS or tok in QUESTION_STOPWORDS:
            continue
        if len(tok) < 3 and not (raw.isupper() and len(raw) >= 2) and not tok.isdigit():
            continue
        s = stem(tok)
        if not stem_in(s, seen):
            seen.add(s)
            out.append((raw, tok))
    return out


def stem_set(text: str) -> set[str]:
    return {stem(t) for t in content_tokens(text)}


def has_negation(text: str) -> bool:
    for m in _WORD.finditer(normalize_text(text)):
        t = fold(m.group(0))
        if t in NEGATION_WORDS or (len(t) > 5 and t.endswith(_NEG_SUFFIX)):
            return True
    return False


def sentence_around(text: str, start: int, end: int) -> str:
    """The sentence(s) of `text` that contain [start, end). Boundaries: . ! ? ; newline,
    followed by whitespace (so `O(log n).` or `h(k) = k mod m.` still split correctly)."""
    left = start
    while left > 0 and not (text[left - 1] in ".!?;\n" and (left == len(text) or text[left].isspace())):
        left -= 1
    right = end
    while right < len(text) and not (text[right - 1] in ".!?;\n" and text[right].isspace()):
        right += 1
    return text[left:right].strip()


# ── Segmentation of extracted page text (slides and prose) ─────────────────────────────────
# Extracted slide text is a sequence of short lines: titles, page numbers, bullets and list
# items, with sentences wrapped across lines. Splitting only on ".!?" glued titles and page
# numbers onto sentences ("Git and GitHub 11 Git, is …"). `segments` returns statements as
# EXACT substrings of the input (original line breaks kept), so a quote equals the source slice:
# wrapped lines are re-joined, list items and bullets become their own segment (marker
# excluded), and titles and page numbers are dropped. A line is a title when it is a short
# (≤ HEADING_MAX_WORDS) non-item line without final punctuation that stands alone or is
# followed by a line starting with an upper-case letter or a list marker.

_ITEM_MARK = re.compile(r"(?:\d{1,3}[.)]|[-–—•*▪●◦·])\s*")
_PAGE_NUMBER = re.compile(r"\d{1,4}")
_END_PUNCT = re.compile(r"[.!?]$")
_SENT_END = re.compile(r"[.!?](?=\s)")
MAX_SEGMENT_CHARS = 300
MIN_SEGMENT_TOKENS = 3
HEADING_MAX_WORDS = 8


def _lines(text: str) -> list[tuple[int, int, bool]]:
    """(start, end, is_item) of each non-empty, non-page-number line, marker excluded."""
    out = []
    pos = 0
    for raw in text.splitlines(keepends=True):
        s, e = pos, pos + len(raw.rstrip("\r\n"))
        pos += len(raw)
        while s < e and text[s].isspace():
            s += 1
        while e > s and text[e - 1].isspace():
            e -= 1
        if s == e or _PAGE_NUMBER.fullmatch(text[s:e]):
            out.append((s, s, False))  # paragraph break
            continue
        m = _ITEM_MARK.match(text, s, e)
        is_item = bool(m) and m.end() < e
        if is_item:
            s = m.end()
        out.append((s, e, is_item))
    return out


def _cut(text: str, s: int, e: int, limit: int = MAX_SEGMENT_CHARS) -> int:
    if e - s <= limit:
        return e
    space = text.rfind(" ", s, s + limit)
    return space if space > s + limit * 0.6 else s + limit


def segment_spans(text: str) -> list[tuple[int, int]]:
    lines = _lines(text)
    paragraphs: list[tuple[int, int]] = []
    cur: list[tuple[int, int]] = []

    def flush() -> None:
        if cur:
            paragraphs.append((cur[0][0], cur[-1][1]))
        cur.clear()

    for i, (s, e, is_item) in enumerate(lines):
        if s == e:
            flush()
            continue
        line = text[s:e]
        if is_item:
            flush()
        elif not cur:
            nxt = next((x for x in lines[i + 1:] if x[0] != x[1]), None)
            standalone = nxt is None or nxt[2] or text[nxt[0]].isupper() or lines[i + 1][0] == lines[i + 1][1]
            if standalone and len(line.split()) <= HEADING_MAX_WORDS and not _END_PUNCT.search(line):
                continue  # title / heading line
        cur.append((s, e))
        if _END_PUNCT.search(line):
            flush()
    flush()

    spans: list[tuple[int, int]] = []
    for ps, pe in paragraphs:
        s = ps
        for m in _SENT_END.finditer(text, ps, pe):
            spans.append((s, m.end()))
            s = m.end()
            while s < pe and text[s].isspace():
                s += 1
        if s < pe:
            spans.append((s, pe))
    return [(s, _cut(text, s, e)) for s, e in spans]


def segments(text: str) -> list[str]:
    """Statements of a passage, each an exact substring of it (see segment_spans)."""
    out: list[str] = []
    for s, e in segment_spans(text):
        seg = text[s:e].strip()
        if len(content_tokens(seg)) >= MIN_SEGMENT_TOKENS and seg not in out:
            out.append(seg)
    return out


def specific_question_terms(question: str, units: list[set[str]]) -> tuple[bool, set[str]]:
    """Which question key terms (stems) make a statement relevant, given the stem sets of the
    available units (passages or statements). Returns (constrained, specific):

      * ≥ 2 key terms occur and differ in how widespread they are → the less widespread ones;
      * key terms are missing from all units and only ONE occurs → that one is generic: nothing
        qualifies ("Git status nedir?" when no unit mentions "status": a statement sharing only
        "Git" does not answer it);
      * otherwise no constraint.
    """
    keys = [stem(tok) for _, tok in question_key_terms(question)]
    df = {k: sum(1 for u in units if stem_in(k, u)) for k in keys}
    present = {k: d for k, d in df.items() if d}
    if len(present) >= 2 and len(set(present.values())) > 1:
        widest = max(present.values())
        return True, {k for k, d in present.items() if d < widest}
    if len(present) == 1 and len(present) < len(df):
        return True, set()
    return False, set()


def named_terms(question: str) -> list[str]:
    """Question key terms written as names or identifiers (capitalised, e.g. "Dijkstra",
    "Python"; or with an inner capital/digit, e.g. "AVL", "SHA1"). Used to recognise a question
    about a specific subject the material never mentions."""
    out = []
    for raw, _ in question_key_terms(question):
        if raw[:1].isupper() or any(ch.isupper() for ch in raw[1:]) or (any(ch.isdigit() for ch in raw) and any(ch.isalpha() for ch in raw)):
            out.append(raw)
    return out


def is_statement(text: str, titles: list[str] | tuple[str, ...] = ()) -> bool:
    """A claim must be a statement: at least MIN_SEGMENT_TOKENS content tokens and not merely
    a document or section title."""
    if len(content_tokens(text)) < MIN_SEGMENT_TOKENS:
        return False
    f = fold(text).strip(" .:;!?")
    return not any(t and f == fold(t).strip(" .:;!?") for t in titles)
