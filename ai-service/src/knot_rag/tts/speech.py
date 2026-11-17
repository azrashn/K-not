"""Text as Piper should read it. espeak skips or spells math symbols, so "x(0) = 1" is read as
"x(0) eşittir 1". Only symbols change, never the content; [mm:ss] source labels are not read."""

from __future__ import annotations

import re

_WORDS = {
    "tr": {
        "=": "eşittir", "+": "artı", "-": "eksi", "*": "çarpı", "/": "bölü", "≠": "eşit değildir",
        "≤": "küçük eşittir", "≥": "büyük eşittir", "<": "küçüktür", ">": "büyüktür", "⇒": "ise",
        "^2": "kare", "^3": "küp", "^": "üssü",
    },
    "en": {
        "=": "equals", "+": "plus", "-": "minus", "*": "times", "/": "divided by", "≠": "is not equal to",
        "≤": "is at most", "≥": "is at least", "<": "is less than", ">": "is greater than", "⇒": "so",
        "^2": "squared", "^3": "cubed", "^": "to the power of",
    },
}

_REF = re.compile(r"\[\d{1,2}:\d{2}(?::\d{2})?\]|\[\d{1,2}\]")
_OPERAND = r"[\w)\]²³]"


def speakable(text: str, lang: str | None) -> str:
    words = _WORDS["en" if lang == "en" else "tr"]
    t = _REF.sub("", text)
    t = t.replace("−", "-").replace("×", "*").replace("·", "*").replace("=>", "⇒").replace("→", "⇒")
    t = t.replace("<=", "≤").replace(">=", "≥").replace("!=", "≠")
    t = t.replace("²", "^2").replace("³", "^3")
    t = re.sub(r"\^\{?2\}?(?!\d)", f" {words['^2']} ", t)
    t = re.sub(r"\^\{?3\}?(?!\d)", f" {words['^3']} ", t)
    t = re.sub(r"\^\{?(\w+)\}?", lambda m: f" {words['^']} {m.group(1)} ", t)
    for op in ("≠", "≤", "≥", "⇒", "="):
        t = t.replace(op, f" {words[op]} ")
    # < and > only between two terms ("->" or a lone bracket stays).
    t = re.sub(rf"(?<={_OPERAND})\s*([<>])\s*(?=[\w(-])", lambda m: f" {words[m.group(1)]} ", t)
    # + and * between terms; "/" only between numbers or single letters ("ve/veya" stays).
    t = re.sub(rf"(?<={_OPERAND})\s*\+\s*(?=[\w(])", f" {words['+']} ", t)
    t = re.sub(rf"(?<={_OPERAND})\s*\*\s*(?=[\w(])", f" {words['*']} ", t)
    t = re.sub(r"(?<=\b\w)\s*/\s*(?=\w\b)|(?<=\d)\s*/\s*(?=\d)", f" {words['/']} ", t)
    # minus: "a - b" (spaced) or a sign before a number / variable ("-4", "= -x"); hyphenated words stay.
    t = re.sub(r"(?<=\s)-\s+(?=[\w(])", f"{words['-']} ", t)
    t = re.sub(r"(?:(?<=^)|(?<=[\s(=,]))-(?=[\d(]|[a-zA-Z]\b)", f"{words['-']} ", t)
    t = re.sub(r"(?<=\d)\s*-\s*(?=\d)", f" {words['-']} ", t)
    return re.sub(r"\s{2,}", " ", t).strip()
