"""Does the chosen source sentence support a statement or an answer option? Deterministic: no model.

A quiz question rests on one source sentence. The model writes a statement (true/false) or four
options and says which one is right; quiz_checks only proved that the sentence exists and that the
answer shares a word with it. That let "TCP is connectionless" pass as TRUE next to the sentence
"Connection-oriented transport: TCP". This module measures what the sentence really carries:

- coverage: the share of the statement's content words (by root) the sentence contains;
- numbers the sentence does not have;
- a flipped meaning: negation on one side only, a word with its opposite affix (connection /
  connectionless, güvenilir / güvensiz), or a known antonym pair (otomatik / el ile, artar / azalır).

Pure functions on strings, so the rules are tested without a model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from knot_rag.text import content_tokens, fold

# A statement is "stated" by the sentence when it carries this share of its own content roots.
SUPPORT_MIN = 0.6
# A false statement is made by changing one fact of the sentence, so it still shares this many roots.
RELATED_MIN_SHARED = 2


def same_word(a: str, b: str) -> bool:
    """Two folded tokens are one word in two forms: equal, or sharing nearly all of the shorter one
    (belleği / belleğini, program / programları, reliable / reliability). The common prefix must be at
    least 4 and within 2 characters of the shorter token, so Microsoft and Microsystems stay apart.
    Numbers and short tokens (tcp, udp, bit) match only when equal."""
    if a == b:
        return True
    if a.isdigit() or b.isdigit():
        return False
    n = min(len(a), len(b))
    common = 0
    while common < n and a[common] == b[common]:
        common += 1
    return common >= max(4, n - 2)


# ── numbers ─────────────────────────────────────────────────────────────────────────────────
_NUMBER = re.compile(r"(?<![\w])\d+(?:[.,]\d+)?")


def numbers(text: str) -> set[str]:
    return {n.replace(",", ".") for n in _NUMBER.findall(text)}


# ── negation ────────────────────────────────────────────────────────────────────────────────
_NEGATION_WORDS = frozenset(
    "not no never cannot without neither nor değil değildir yok yoktur asla hiçbir olmayan olmaz olmadan "
    "olmaksızın".split()
)
NEGATION_WINDOW = 2  # a negation counts when it stands this close to a word both texts share


def _is_negation(word: str) -> bool:
    return word in _NEGATION_WORDS or (len(word) >= 5 and word.endswith(("mez", "maz")))


def negations_near(text: str, carried: list[str]) -> int:
    """Negation words standing within NEGATION_WINDOW words of a word that is one of `carried`. A negation
    elsewhere in a long sentence ("UDP is connectionless and adds no handshake") is about something else."""
    lowered = text.replace("I", "ı").replace("İ", "i").lower().replace("n't", " not")
    words = re.findall(r"[^\W\d_]+", lowered)
    anchors = [i for i, w in enumerate(words)
               if not _is_negation(w) and any(same_word(fold(w), c) for c in carried)]
    return sum(
        1 for i, w in enumerate(words)
        if _is_negation(w) and any(abs(i - a) <= NEGATION_WINDOW for a in anchors)
    )


# ── opposite affixes: connection / connectionless, güvenilir / güvenilmez-sız, reliable / unreliable ─
def _polar_base(token: str) -> str | None:
    """The word without its "opposite" affix, or None. Tokens are folded (ı→i)."""
    if token.endswith("less") and len(token) > 7:
        return token[:-4]
    if token.endswith(("siz", "suz", "süz")) and len(token) > 6:
        return token[:-3]
    if token.startswith("non") and len(token) > 6:
        return token[3:]
    if token.startswith("un") and len(token) > 6:
        return token[2:]
    return None


def _stem_match(a: str, b: str) -> bool:
    """Two folded tokens are the same word (an inflection or a derived form shares a long prefix)."""
    n = min(len(a), len(b))
    return a == b or (n >= 5 and a[:n - 1] == b[:n - 1])


def _polar_conflicts(a_tokens: list[str], b_tokens: list[str]) -> list[str]:
    """Words of A that carry an opposite affix while B has the plain word only (or the other way round)."""
    found = []
    for left, right in ((a_tokens, b_tokens), (b_tokens, a_tokens)):
        for token in left:
            base = _polar_base(token)
            if base is None or token in right:
                continue
            if any(_stem_match(base, other) and _polar_base(other) is None for other in right):
                found.append(f"{base}/{token}")
    return found


# ── antonym pairs (folded phrases; matched on folded text) ──────────────────────────────────────
ANTONYMS: tuple[tuple[str, str], ...] = (
    # English
    ("increase", "decrease"), ("increases", "decreases"), ("higher", "lower"), ("larger", "smaller"),
    ("bigger", "smaller"), ("faster", "slower"), ("more than", "less than"), ("before", "after"),
    ("first", "last"), ("encrypt", "decrypt"), ("always", "never"), ("same", "different"),
    ("static", "dynamic"), ("synchronous", "asynchronous"), ("sender", "receiver"), ("client", "server"),
    ("automatic", "manual"), ("automatically", "manually"),
    ("compile time", "run time"), ("connection-oriented", "connectionless"),
    # Turkish
    ("artar", "azalir"), ("artirir", "azaltir"), ("yuksek", "dusuk"), ("buyuk", "kucuk"),
    ("hizli", "yavas"), ("once", "sonra"), ("ilk", "son"), ("her zaman", "asla"),     ("ayni", "farkli"), ("statik", "dinamik"), ("senkron", "asenkron"),
    ("otomatik", "manuel"), ("otomatik", "el ile"), ("gonderen", "alici"), ("istemci", "sunucu"),
    ("derleme zamani", "calisma zamani"), ("bagimli", "bagimsiz"),
)

_ASCII = str.maketrans("çğöşüâîû", "cgosuaiu")


def _plain(text: str) -> str:
    """Folded, without diacritics, single-spaced: the key antonyms are matched on."""
    return re.sub(r"[^\w]+", " ", fold(text).translate(_ASCII)).strip()


def _has(plain: str, phrase: str) -> bool:
    return bool(re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", plain))


def _antonym_conflicts(a: str, b: str) -> list[str]:
    """A pair where A says one side and B only the other: a statement that carries "otomatik" while the
    sentence says "el ile" and never "otomatik"."""
    pa, pb = _plain(a), _plain(b)
    found = []
    for x, y in ANTONYMS:
        for left, right in ((x, y), (y, x)):
            if _has(pa, left) and _has(pb, right) and not _has(pb, left):
                found.append(f"{left}/{right}")
    return found


# ── the measure ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Fit:
    coverage: float                      # share of the statement's content roots found in the sentence
    shared: int                          # how many of its roots the sentence has
    new_terms: list[str] = field(default_factory=list)   # content words only the statement has
    conflicts: list[str] = field(default_factory=list)   # why the two cannot both be true

    @property
    def states(self) -> bool:
        """The sentence says what the statement says: nearly all of its words, nothing flipped."""
        return self.coverage >= SUPPORT_MIN and not self.conflicts

    def describe(self) -> str:
        bits = [f"coverage {self.coverage:.2f}"]
        if self.conflicts:
            bits.append("conflicts: " + ", ".join(self.conflicts[:4]))
        if self.new_terms:
            bits.append("not in the sentence: " + ", ".join(self.new_terms[:5]))
        return "; ".join(bits)


def fit(statement: str, sentence: str) -> Fit:
    """How well `sentence` backs `statement` (see the module docstring)."""
    s_tokens, q_tokens = content_tokens(statement), content_tokens(sentence)
    unique = list(dict.fromkeys(s_tokens))
    carried = [t for t in unique if any(same_word(t, q) for q in q_tokens)]
    new_terms = [t for t in unique if t not in carried and not t.isdigit()]
    coverage = len(carried) / len(unique) if unique else 0.0
    conflicts = _polar_conflicts(s_tokens, q_tokens) + _antonym_conflicts(statement, sentence)
    missing_numbers = numbers(statement) - numbers(sentence)
    if missing_numbers:
        conflicts.append("number " + ", ".join(sorted(missing_numbers)))
    # A negation on one side only flips the meaning, but only when both are about the same thing.
    if coverage >= 0.5 and negations_near(statement, carried) % 2 != negations_near(sentence, carried) % 2:
        conflicts.append("negation")
    return Fit(coverage=coverage, shared=len(carried), new_terms=new_terms, conflicts=conflicts)


# ── language of a stem ──────────────────────────────────────────────────────────────────────
_EN = frozenset(
    "the is are was were of and to in that which what does do for with by it as on from between used "
    "uses can when how why an be has have not".split()
)
_TR = frozenset(
    "ve bir bu için ile olan mi mı mu mü hangi nedir nasıl neden da de ise gibi en daha kadar veya "
    "olarak her çok değil midir mıdır nelerdir hangisidir".split()
)
_TR_LETTERS = re.compile(r"[çğıöşüÇĞİÖŞÜ]")


def guess_language(text: str) -> str | None:
    """"tr", "en" or None when there are too few signs. Technical terms and names do not count."""
    lowered = text.replace("I", "ı").replace("İ", "i").lower()
    words = re.findall(r"[^\W\d_]+", lowered)
    tr = sum(1 for w in words if w in _TR) + (2 if _TR_LETTERS.search(text) else 0)
    en = sum(1 for w in words if w in _EN)
    if tr >= 1 and tr >= en:
        return "tr"
    if en >= 2 and en > tr:
        return "en"
    return None
