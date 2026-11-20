"""Text normalisation for the self-check comparison only (never used for what the student is shown).

* number words -> digits, Turkish and English ("üç", "three" -> "3", "yirmi beş" -> "25")
The source text and the claim are normalised the same way before they are compared, so a source that
writes "three duplicate ACKs" and a claim that writes "3" or "üç" mean the same number.
"""

from __future__ import annotations

import re

_ASCII = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiuCGIOSU")

_UNITS = {
    "zero": 0, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "sifir": 0, "iki": 2, "uc": 3, "dort": 4, "bes": 5, "alti": 6, "yedi": 7, "sekiz": 8, "dokuz": 9,
    "yirmi": 20, "otuz": 30, "kirk": 40, "elli": 50, "altmis": 60, "yetmis": 70, "seksen": 80, "doksan": 90,
}
# "one", "bir" (also the Turkish article), "on" (also the English preposition), "a hundred" are left alone:
# turning them into digits would corrupt ordinary sentences.
_HUNDRED = {"hundred": 100, "yuz": 100}
_THOUSAND = {"thousand": 1000, "bin": 1000}
_WORD = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşüâîû]+")


def _key(word: str) -> str:
    return word.translate(_ASCII).lower()


def _kind(word: str):
    k = _key(word)
    if k in _UNITS:
        return "u", _UNITS[k]
    if k in _HUNDRED:
        return "h", 100
    if k in _THOUSAND:
        return "t", 1000
    return None


def number_words_to_digits(text: str) -> str:
    """Replace runs of number words by their value. `three hundred and five`/`yüz beş` style runs are
    summed; an isolated word is replaced by its own value."""
    out, pos = [], 0
    matches = list(_WORD.finditer(text))
    i = 0
    while i < len(matches):
        m = matches[i]
        kind = _kind(m.group(0))
        if not kind:
            i += 1
            continue
        total, current, j, end = 0, 0, i, m.end()
        while j < len(matches):
            gap = text[end:matches[j].start()] if j > i else ""
            k = _kind(matches[j].group(0))
            if not k or (j > i and gap.strip(" -")):
                break
            kd, val = k
            if kd == "u":
                last = current % 100
                if last and not (val < 10 and last >= 20 and last % 10 == 0):
                    break
                current += val
            elif kd == "h":
                current = (current or 1) * 100
            else:
                total += (current or 1) * 1000
                current = 0
            end = matches[j].end()
            j += 1
        out.append((matches[i].start(), end, str(total + current)))
        i = j
    pieces = []
    for start, end, value in out:
        pieces.append(text[pos:start])
        pieces.append(value)
        pos = end
    pieces.append(text[pos:])
    return "".join(pieces)


# Units written in different ways mean the same: bayt / byte / bytes / 64 B, milisaniye / ms, ...
_UNITS_RULES = [
    (re.compile(r"\bkilo?bay\w*|\bkilobytes?\b", re.IGNORECASE), "kilobyte"),
    (re.compile(r"\bmega?bay\w*|\bmegabytes?\b", re.IGNORECASE), "megabyte"),
    (re.compile(r"\bgiga?bay\w*|\bgigabytes?\b", re.IGNORECASE), "gigabyte"),
    (re.compile(r"\bbayt\w*|\bbytes?\b"), "byte"),
    (re.compile(r"\bmilisaniye\w*|\bmilliseconds?\b"), "millisecond"),
    (re.compile(r"\bbits?\b", re.IGNORECASE), "bit"),
]
# abbreviations right after a number ("64 B", "5 ms", "2 MB"); the space is kept
_UNIT_ABBREVIATIONS = [
    (re.compile(r"(?<=\d)\s?KB\b"), " kilobyte"), (re.compile(r"(?<=\d)\s?MB\b"), " megabyte"),
    (re.compile(r"(?<=\d)\s?GB\b"), " gigabyte"), (re.compile(r"(?<=\d)\s?B\b"), " byte"),
    (re.compile(r"(?<=\d)\s?ms\b"), " millisecond"),
]


def normalize_units(text: str) -> str:
    for pattern, unit in _UNIT_ABBREVIATIONS:
        text = pattern.sub(unit, text)
    for pattern, unit in _UNITS_RULES:
        text = pattern.sub(unit, text)
    return text


def canon(text: str) -> str:
    """The form in which claim and source are compared."""
    return normalize_units(number_words_to_digits(text))


# ── OCR repair ──────────────────────────────────────────────────────────────────────────────
# Slide PDFs often lose the ligatures ti / tt / ft / fi / fl / ff: the text layer holds one odd
# character instead ("ini$ally", "connec8on", "le@ers", "ajer", "/meout"). A source token is repaired
# ONLY when putting a ligature in place of one suspect character gives a word that the claim itself
# contains, so nothing is invented: the student's own word has to be there.
_LIGATURES = ("ti", "tt", "ft", "fi", "fl", "ff")
_TOKEN = re.compile(r"[^\s,.;:()\[\]{}\"'<>•▪●◦·§–—]{3,}")


def _suspect(token: str, i: int) -> bool:
    ch = token[i]
    if not ch.isalpha():
        return True
    return ch == "j" or (ch.isupper() and i > 0 and not token.isupper())


def _fold_word(word: str) -> str:
    return word.translate(_ASCII).lower()


def repair_ocr(text: str, vocabulary: set[str]) -> str:
    """`vocabulary`: folded words of the claim. Returns `text` with damaged ligatures put back."""
    if not vocabulary:
        return text
    # a bracket in the middle of a word ("connec)onless") is a damaged ligature, not punctuation
    text = re.sub(r"(?<=[A-Za-z])[()](?=[A-Za-z])", "~", text)

    def fix(match: re.Match) -> str:
        token = match.group(0)
        if not any(c.isalpha() for c in token) or token.isdigit():
            return token
        if _fold_word(token) in vocabulary:
            return token
        for i in range(len(token)):
            if not _suspect(token, i):
                continue
            for lig in _LIGATURES:
                candidate = token[:i] + lig + token[i + 1:]
                if _fold_word(candidate) in vocabulary:
                    return candidate
        return token

    return _TOKEN.sub(fix, text)


# ── unreadable source text ─────────────────────────────────────────────────────────────────────
# Some material text is not prose: IP / MAC tables, or video transcripts garbled into mixed alphabets
# ("Nenut cell工 teams научin ..."). Such a passage can neither support nor contradict a claim and must
# never be shown to the student as a quote.
_FOREIGN = re.compile(r"[Ѐ-ӿ֐-ۿऀ-෿぀-ヿ㐀-鿿가-힯]")
MIN_ALPHA_RATIO = 0.5
MAX_FOREIGN_CHARS = 1


def is_readable(text: str) -> bool:
    """False for number/symbol tables and for text mixing in characters of other alphabets."""
    compact = re.sub(r"\s+", "", text)
    if len(compact) < 12:
        return True  # too short to judge; short lines are filtered by the comparison itself
    if len(_FOREIGN.findall(compact)) > MAX_FOREIGN_CHARS:
        return False
    letters = sum(ch.isalpha() for ch in compact)
    return letters / len(compact) >= MIN_ALPHA_RATIO


# ── words whose affix reverses the meaning ─────────────────────────────────────────────────────
# The comparison cuts words to a 5 letter stem, so "connection" and "connectionless" (or "reliable" and
# "unreliable", "bağlantı" and "bağlantısız") look equal. A claim word carrying such an affix must appear
# in the source in full: its stem alone says nothing.
_UN_WORDS = frozenset("""unreliable unordered unsorted undirected unweighted unacknowledged unencrypted uncompressed
unauthenticated unbalanced unallocated unlocked unsafe unstable unsecured unverified unavailable""".split())
_TR_SUFFIXES = ("siz", "sız", "suz", "süz", "sizdir", "sızdır", "suzdur", "süzdür")


def polar_words(words: list[str]) -> list[str]:
    """The (folded) words of the list that carry a meaning-reversing affix."""
    out = []
    for w in words:
        ascii_w = w.translate(_ASCII).lower()
        if (len(ascii_w) >= 8 and ascii_w.endswith("less")) or ascii_w in _UN_WORDS or (len(ascii_w) >= 6 and ascii_w.startswith("non") and ascii_w not in ("nonce",)):
            out.append(w)
        elif len(ascii_w) >= 8 and any(ascii_w.endswith(x.translate(_ASCII)) for x in _TR_SUFFIXES):
            out.append(w)
    return out


# ── slide text: bullet items ────────────────────────────────────────────────────────────────────
# Extracted slide text breaks a sentence over several lines (one line "to send HTTP request,", the next
# "client first opens TCP", then "socket to web server") and starts every bullet with a marker. The unit of
# comparison is the bullet item: a line with a marker opens an item, a line without one continues the item
# before it.
_MARKER = re.compile(r"^\s*(?:[§•▪●◦·‣–—-]|\d{1,2}[.)])\s*")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def slide_units(text: str) -> list[str]:
    """Items of the text, split further at sentence ends. Lines without a marker are joined to the bullet
    before them; a text without markers keeps its lines (each its own unit)."""
    items: list[str] = []
    open_bullet = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            open_bullet = False
            continue
        if _MARKER.match(line):
            items.append(_MARKER.sub("", line, count=1).strip())
            open_bullet = True
        elif open_bullet and items and line[0].islower():  # a wrapped line continues in lower case; a new statement starts upper case
            items[-1] = (items[-1] + " " + line).strip()
        else:
            items.append(line)
    units: list[str] = []
    for item in items:
        units.extend(x.strip() for x in _SENTENCE_END.split(item) if x.strip())
    return units
