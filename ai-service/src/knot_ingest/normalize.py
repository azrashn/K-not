"""Deterministic page-text normalization for `indexing_version = "c1"` (wbs2-handoff.md §5).

Rules, applied in this order to each page's raw extracted text:

1. Unicode NFC (not NFKC: `O(n²)` stays `O(n²)`). Turkish `ı İ ğ ş ç ö ü` and symbols such
   as `≥ − ⌊ ⌋ Ω Θ α` are preserved.
2. Ligatures mapped explicitly: `ﬁ→fi`, `ﬂ→fl`, `ﬀ→ff`, `ﬃ→ffi`, `ﬄ→ffl`.
3. `\\r\\n` and `\\r` → `\\n`; tab and NO-BREAK SPACE (U+00A0) → space.
4. Control characters (Unicode category Cc) removed, except `\\n`.
5. Runs of spaces collapsed to one; leading and trailing spaces stripped on every line.
6. Hyphenation: a line-final `-` between two letters is removed together with the line break
   when the next line starts with a lowercase letter (`kelime-\\nlerin` → `kelimelerin`).
   Uppercase continuations (`Ağaç-\\nYapısı`) and digits are left untouched.
7. At most two consecutive `\\n`; leading/trailing blank lines of the page removed.
8. NFC again (removing characters can bring a base letter and a combining mark together).

Headers/footers are NOT removed in c1 (the handoff allows it, but slide titles often repeat
and removing them would lose content).

Changing any rule changes offsets: it requires a new `indexing_version`.
"""

from __future__ import annotations

import re
import unicodedata

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl"}

_SPACES = re.compile(r" {2,}")
_HYPHEN_BREAK = re.compile(r"(?<=[^\W\d_])-\n(?=[^\W\d_])")
_BLANK_RUN = re.compile(r"\n{3,}")


def _join_hyphenated(text: str) -> str:
    return _HYPHEN_BREAK.sub(lambda m: "" if m.string[m.end()].islower() else m.group(0), text)


def normalize_page_text(raw: str) -> str:
    t = unicodedata.normalize("NFC", raw)
    for lig, repl in LIGATURES.items():
        t = t.replace(lig, repl)
    t = t.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ").replace(" ", " ")
    t = "".join(ch for ch in t if ch == "\n" or unicodedata.category(ch) != "Cc")
    t = _SPACES.sub(" ", t)
    t = "\n".join(line.strip(" ") for line in t.split("\n"))
    t = _join_hyphenated(t)
    t = _BLANK_RUN.sub("\n\n", t).strip("\n")
    return unicodedata.normalize("NFC", t)
