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


def canon(text: str) -> str:
    """The form in which claim and source are compared."""
    return number_words_to_digits(text)


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
