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
