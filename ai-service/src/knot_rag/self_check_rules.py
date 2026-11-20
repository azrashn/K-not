"""Rule based contradiction types for the self-check (no model).

Each rule compares the claim with ONE source sentence and answers only when the pattern is unmistakable:
* ANTONYM:    an opposite word in place of the claim's word, everything else the same
              ("increases" / "decreases", "reliable" / "unreliable", "LIFO" / "FIFO", "before" / "after")
* DIRECTION:  the same two roles with sender and receiver swapped ("the client sends to the server" /
              "the server sends to the client")
* COMPARISON: "A is faster than B" against "B is faster than A", or the opposite adjective

A rule that is not sure returns None, and the claim is then judged as before (never a made-up conflict).
Works on both languages; the Turkish side uses the case suffixes (-e/-a target, -den/-dan source).
"""

from __future__ import annotations

import re

from knot_rag.self_check_norm import repair_ocr
from knot_rag.text import fold, has_negation, stem, stem_in, stem_set

_ASCII = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiuCGIOSU")


RULE_KINDS = ("ANTONYM", "DIRECTION", "COMPARISON")


def _w(text: str) -> list[str]:
    """Words of the text (ASCII-folded, lower case). Hyphenated terms ("connection-oriented") also appear as
    one word, so that the opposite pairs below can name them."""
    folded = text.translate(_ASCII).lower()
    return re.findall(r"[a-z0-9]+", folded) + re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)+", folded)


# Opposite pairs, English and Turkish, as word stems (prefix match on the folded word).
ANTONYMS: list[tuple[tuple[str, ...], tuple[str, ...]]] = [
    (("increas", "raise", "grow", "artir", "artar", "yukselt"), ("decreas", "reduc", "lower", "shrink", "azal", "dusur", "kucul")),
    (("reliable", "guaranteed", "guvenilir"), ("unreliable", "guvenilmez", "best-effort")),
    (("connectionless", "baglantisiz"), ("connection-oriented", "baglanti odakli")),
    (("synchronous", "senkron"), ("asynchronous", "asenkron")),
    (("static", "statik"), ("dynamic", "dinamik")),
    (("ascending", "artan"), ("descending", "azalan")),
    (("sorted", "ordered", "sirali"), ("unsorted", "unordered", "sirasiz")),
    (("lifo",), ("fifo",)),
    (("push",), ("pop",)),
    (("enqueue",), ("dequeue",)),
    (("before", "once", "onc"), ("after", "sonra")),
    (("first", "ilk"), ("last", "son")),
    (("minimum", "smallest", "least", "en kucuk", "en az"), ("maximum", "largest", "most", "en buyuk", "en fazla")),
    (("fast", "quick", "hizli"), ("slow", "yavas")),
    (("large", "big", "buyuk"), ("small", "kucuk")),
    (("encrypt", "sifrele"), ("decrypt", "sifre coz")),
    (("open", "acik"), ("closed", "kapali")),
    (("input", "giris"), ("output", "cikis")),
    (("left", "sol"), ("right", "sag")),
    (("internal", "ic"), ("external", "dis")),
    (("serial", "seri"), ("parallel", "paralel")),
    (("stateful",), ("stateless",)),
    (("preemptive",), ("non-preemptive", "nonpreemptive")),
    (("directed", "yonlu"), ("undirected", "yonsuz")),
    (("max-heap",), ("min-heap",)),
    (("breadth", "genislik"), ("depth", "derinlik")),
    (("true", "dogru"), ("false", "yanlis")),
    (("always", "daima", "her zaman"), ("never", "asla", "hicbir zaman")),
]


# Whole words of the pairs, to put damaged slide ligatures back ("Connec8on-oriented") before comparing.
_PAIR_WORDS = {w for left, right in ANTONYMS for group in (left, right) for w in group if " " not in w}


def _hits(words: list[str], stems: tuple[str, ...]) -> list[str]:
    out = []
    for w in words:
        for s in stems:
            if " " in s:
                continue
            if w.startswith(s) and (len(w) - len(s) <= 5):
                out.append(w)
                break
    return out


def antonym_conflict(claim: str, window: str, min_shared: int = 3) -> dict | None:
    """The claim uses one word of an opposite pair, the sentence the other, and the rest of the claim
    is in the sentence."""
    window = repair_ocr(window, _PAIR_WORDS)
    cw, ww = _w(claim), _w(window)
    if has_negation(claim) != has_negation(window):
        return None
    for left, right in ANTONYMS:
        for a, b in ((left, right), (right, left)):
            in_claim, in_window = _hits(cw, a), _hits(ww, b)
            if not in_claim or not in_window or _hits(ww, a) or _hits(cw, b):
                continue
            hit_parts = {part for hit in in_claim for part in hit.split("-")}  # "connection-oriented" also made "connection", "oriented"
            rest = [t for t in dict.fromkeys(cw) if t not in in_claim and t not in hit_parts and len(t) >= 3 and t not in {"the", "and", "that", "with"}]
            window_stems = {stem(t) for t in ww}
            shared = [t for t in rest if stem(t) in window_stems or stem_in(stem(t), window_stems)]
            # A short claim ("TCP is connectionless") has few other words: then ALL of them must be in the
            # sentence, and the sentence must be one line (size 1 is the caller's choice for short claims).
            needed = min(min_shared, len(rest)) if rest else 0
            if needed >= 1 and len(shared) >= needed and len(shared) / max(1, len(rest)) >= (0.7 if len(rest) >= min_shared else 1.0):
                return {"kind": "ANTONYM", "claim": [in_claim[0]], "source": [in_window[0]]}
    return None


# ── direction / roles ─────────────────────────────────────────────────────────────────────────
ROLE_WORDS = {
    "client": "client", "istemci": "client", "server": "server", "sunucu": "server",
    "sender": "sender", "gonderici": "sender", "receiver": "receiver", "alici": "receiver",
    "source": "source", "kaynak": "source", "destination": "destination", "hedef": "destination",
    "parent": "parent", "ebeveyn": "parent", "child": "child", "cocuk": "child",
    "producer": "producer", "uretici": "producer", "consumer": "consumer", "tuketici": "consumer",
    "caller": "caller", "callee": "callee", "master": "master", "slave": "slave",
}
_EN_FROM = {"from", "by"}
_EN_TO = {"to", "toward", "towards"}


def _entity(token: str) -> str | None:
    for stem_word, role in ROLE_WORDS.items():
        if token.startswith(stem_word) and len(token) - len(stem_word) <= 6:
            return role
    return None


def _case(token: str) -> str:
    """Turkish case of an entity token: 'dat' (-e/-a/-ye/-ya), 'abl' (-den/-dan/-ten/-tan), else 'nom'."""
    for stem_word in ROLE_WORDS:
        if token.startswith(stem_word):
            tail = token[len(stem_word):]
            if tail in {"e", "a", "ye", "ya", "ne", "na", "ine", "ina"}:
                return "dat"
            if tail in {"den", "dan", "ten", "tan", "nden", "ndan"}:
                return "abl"
    return "nom"


def roles(text: str) -> tuple[str, str] | None:
    """(giver, receiver) of the two role words in the sentence, or None when it is not unmistakable."""
    tokens = _w(text)
    found = [(i, _entity(t), t) for i, t in enumerate(tokens) if _entity(t)]
    distinct = []
    for i, role, t in found:
        if role not in [r for _, r, _ in distinct]:
            distinct.append((i, role, t))
    if len(distinct) != 2:
        return None
    (i1, r1, t1), (i2, r2, t2) = distinct
    between = set(tokens[i1 + 1:i2])
    before = set(tokens[max(0, i1 - 2):i1])
    c1, c2 = _case(t1), _case(t2)
    # Turkish: case suffixes
    if c1 != "nom" or c2 != "nom":
        if c2 == "dat" and c1 != "dat":
            return (r1, r2)
        if c1 == "dat" and c2 != "dat":
            return (r2, r1)
        if c2 == "abl" and c1 != "abl":
            return (r2, r1)
        if c1 == "abl" and c2 != "abl":
            return (r1, r2)
        return None
    # English: "E1 ... to E2" / "E1 ... from E2" / "E1 ... by E2"; "from E1 to E2"
    if between & _EN_FROM:
        return (r2, r1)
    if between & _EN_TO:
        return (r1, r2)
    if before & _EN_FROM and between & _EN_TO:
        return (r1, r2)
    return None


def direction_conflict(claim: str, window: str, min_shared: int = 3) -> dict | None:
    a, b = roles(claim), roles(window)
    if not a or not b or a == b or a != (b[1], b[0]):
        return None
    if has_negation(claim) != has_negation(window):
        return None
    cw = [t for t in dict.fromkeys(_w(claim)) if len(t) >= 3 and not _entity(t)]
    window_stems = {stem(t) for t in _w(window)}
    shared = [t for t in cw if stem_in(stem(t), window_stems)]
    if len(shared) < min_shared or len(shared) / max(1, len(cw)) < 0.7:
        return None
    return {"kind": "DIRECTION", "claim": list(a), "source": list(b)}


# ── comparison ────────────────────────────────────────────────────────────────────────────────
_EN_CMP = re.compile(r"\b([a-z][a-z0-9\-]*)\b(?: is| are)? (?:much |far )?(?:more )?([a-z]+?(?:er)?) than ([a-z][a-z0-9\-]*)", re.IGNORECASE)
_TR_CMP = re.compile(r"\b([a-z0-9]+)'?,? ([a-z0-9]+)'?(?:den|dan|ten|tan) daha ([a-z]+)", re.IGNORECASE)


def _comparison(text: str) -> tuple[str, str, str] | None:
    t = text.translate(_ASCII).lower()
    m = _EN_CMP.search(t)
    if m:
        return (stem(m.group(1)), stem(m.group(3)), m.group(2))
    m = _TR_CMP.search(t)
    if m:
        return (stem(m.group(1)), stem(m.group(2)), m.group(3))
    return None


def comparison_conflict(claim: str, window: str) -> dict | None:
    a, b = _comparison(claim), _comparison(window)
    if not a or not b or has_negation(claim) != has_negation(window):
        return None
    same_adj = a[2][:4] == b[2][:4]
    opposite = any((_hits([a[2]], l) and _hits([b[2]], r)) or (_hits([a[2]], r) and _hits([b[2]], l)) for l, r in ANTONYMS)
    if same_adj and (a[0], a[1]) == (b[1], b[0]):
        return {"kind": "COMPARISON", "claim": [a[0], a[1]], "source": [b[0], b[1]]}
    if opposite and (a[0], a[1]) == (b[0], b[1]):
        return {"kind": "COMPARISON", "claim": [a[2]], "source": [b[2]]}
    return None


def rule_conflict(claim: str, window: str, size: int) -> dict | None:
    """First clear rule-based contradiction of the claim with this source window, or None."""
    if size == 1:
        return direction_conflict(claim, window) or comparison_conflict(claim, window) or antonym_conflict(claim, window)
    if size in (2, 3):
        return antonym_conflict(claim, window)
    return None
