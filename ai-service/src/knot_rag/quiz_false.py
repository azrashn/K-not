"""A false statement made by the server from a true one.

A small model asked for a false statement mostly writes a true one, or one that is false for no clear reason.
It writes a true restatement of a sentence reliably, so the server makes the false statement itself: one fact
of the true statement is changed in a way that is false by construction (an opposite word, a number, a
negation). The caller keeps the candidate only when quiz_truth.fit agrees that the sentence no longer states it.

Pure functions on strings; no model.
"""

from __future__ import annotations

import re
from typing import Iterator

from knot_rag import quiz_truth as qt

# Opposite words and phrases, both ways, written as they appear in running text. The replacement keeps the
# capital of the word it replaces.
SWAPS: tuple[tuple[str, str], ...] = (
    # Turkish
    ("otomatik olarak", "el ile"), ("el ile", "otomatik olarak"), ("otomatik", "manuel"), ("manuel", "otomatik"),
    ("artırır", "azaltır"), ("azaltır", "artırır"), ("artar", "azalır"), ("azalır", "artar"),
    ("yüksek", "düşük"), ("düşük", "yüksek"), ("büyük", "küçük"), ("küçük", "büyük"),
    ("hızlı", "yavaş"), ("yavaş", "hızlı"), ("önce", "sonra"), ("sonra", "önce"),
    ("ilk", "son"), ("son", "ilk"), ("aynı", "farklı"), ("farklı", "aynı"),
    ("her zaman", "asla"), ("statik", "dinamik"), ("dinamik", "statik"),
    ("senkron", "asenkron"), ("asenkron", "senkron"),
    ("bağlantı yönelimli", "bağlantısız"), ("bağlantısız", "bağlantı yönelimli"),
    ("güvenilir", "güvenilmez"), ("güvenilmez", "güvenilir"),
    ("gönderen", "alıcı"), ("alıcı", "gönderen"), ("istemci", "sunucu"), ("sunucu", "istemci"),
    ("derleme zamanında", "çalışma zamanında"), ("çalışma zamanında", "derleme zamanında"),
    ("vardır", "yoktur"), ("yoktur", "vardır"),
    # English
    ("connection-oriented", "connectionless"), ("connectionless", "connection-oriented"),
    ("unreliable", "reliable"), ("reliable", "unreliable"),
    ("increases", "decreases"), ("decreases", "increases"), ("faster", "slower"), ("slower", "faster"),
    ("before", "after"), ("after", "before"), ("always", "never"), ("never", "always"),
    ("same", "different"), ("different", "same"), ("static", "dynamic"), ("dynamic", "static"),
    ("client", "server"), ("server", "client"), ("sender", "receiver"), ("receiver", "sender"),
    ("first", "last"), ("last", "first"), ("automatically", "manually"), ("manually", "automatically"),
)

# Verbs and copulas with their negative: the statement turns into the opposite claim.
NEGATIONS: tuple[tuple[str, str], ...] = (
    ("kullanır", "kullanmaz"), ("içerir", "içermez"), ("sağlar", "sağlamaz"), ("tutar", "tutmaz"),
    ("çalışır", "çalışmaz"), ("yürütür", "yürütmez"), ("destekler", "desteklemez"),
    ("gerektirir", "gerektirmez"), ("yapar", "yapmaz"), ("olur", "olmaz"), ("bulunur", "bulunmaz"),
    ("tanımlar", "tanımlamaz"), ("kazanır", "kazanmaz"), ("üstlenir", "üstlenmez"), ("çevirir", "çevirmez"),
    ("yakalanır", "yakalanmaz"), ("oluşturulur", "oluşturulmaz"), ("yazılır", "yazılmaz"),
    ("gizlenir", "gizlenmez"), ("alır", "almaz"), ("verir", "vermez"), ("yönetir", "yönetmez"),
    ("uses", "does not use"), ("provides", "does not provide"), ("contains", "does not contain"),
    ("supports", "does not support"), ("requires", "does not require"), ("needs", "does not need"),
    ("is", "is not"), ("are", "are not"),
)
# "…dır / …dir / …tür" at the end of a Turkish sentence: "X bir sınıftır." → "X bir sınıf değildir."
_COPULA = re.compile(r"(?<=\w)(?:dır|dir|dur|dür|tır|tir|tur|tür)(?=[.!?]?\s*$)")

_CHANGED = re.compile(r"\d+(?:[.,]\d+)?")


def _word(phrase: str) -> re.Pattern:
    return re.compile(r"(?<![\w-])" + re.escape(phrase) + r"(?![\w-])", re.IGNORECASE)


def _like(original: str, replacement: str) -> str:
    """The replacement with the capital of the original's first letter."""
    return replacement[:1].upper() + replacement[1:] if original[:1].isupper() else replacement


def _swap_once(statement: str, phrase: str, replacement: str) -> str | None:
    match = _word(phrase).search(statement)
    if not match:
        return None
    return statement[: match.start()] + _like(match.group(0), replacement) + statement[match.end():]


def swaps(statement: str) -> Iterator[tuple[str, str]]:
    """The statement with one opposite word or phrase put in the place of its pair."""
    for phrase, opposite in SWAPS:
        changed = _swap_once(statement, phrase, opposite)
        if changed:
            yield changed, f"swap:{phrase}->{opposite}"


def number_changes(statement: str, quote: str) -> Iterator[tuple[str, str]]:
    """The statement with one number replaced by another that the sentence does not have."""
    have = qt.numbers(quote)
    for match in _CHANGED.finditer(statement):
        text = match.group(0)
        if "," in text or "." in text:
            continue
        value = int(text)
        year = 1000 <= value <= 2100
        power_of_two = value >= 8 and value & (value - 1) == 0
        if power_of_two:
            # 32 -> 64: the neighbouring size is the believable wrong number; it may even be in the sentence
            # (for another part), which quiz_truth.fit then reports as a number in the wrong place.
            options = (value * 2, value // 2)
        elif year:
            options = (value - 5, value + 5)
        else:
            options = (value * 2, value + 1, max(1, value - 1), value + 10)
        for other in options:
            if other > 0 and str(other) != text and (power_of_two or str(other) not in have):
                yield statement[: match.start()] + str(other) + statement[match.end():], f"number:{text}->{other}"
                break


def negations(statement: str) -> Iterator[tuple[str, str]]:
    """The statement with its verb negated (or its closing "-dır" turned into "değildir")."""
    for verb, negative in NEGATIONS:
        changed = _swap_once(statement, verb, negative)
        if changed:
            yield changed, f"negate:{verb}"
    copula = _COPULA.search(statement)
    if copula:
        end = statement[copula.end():]
        yield statement[: copula.start()] + " değildir" + end, "negate:copula"


def candidates(statement: str, quote: str) -> Iterator[tuple[str, str]]:
    """False candidates, most natural first: an opposite word, then a number, then a negation."""
    seen = {statement.strip()}
    for source in (swaps(statement), number_changes(statement, quote), negations(statement)):
        for candidate, how in source:
            if candidate.strip() not in seen:
                seen.add(candidate.strip())
                yield candidate, how


def _valid_false(candidate: str, source: str) -> bool:
    """The sentence no longer states the candidate and it is still built from the sentence."""
    fit = qt.fit(candidate, source)
    return fit.shared >= qt.RELATED_MIN_SHARED and not (fit.states and not fit.new_terms)


def false_variants(statement: str, quote: str, pool: list[str], limit: int = 3) -> list[str]:
    """Up to `limit` different false statements for the wrong options of a multiple-choice question: first
    variants of the true statement itself (one of each kind: an opposite word, a number, a negation), then
    variants of the other sentences of the sources. Each is false by construction (see candidates)."""
    out: list[str] = []
    kinds: set[str] = set()

    def add(candidate: str) -> bool:
        key = re.sub(r"\s+", " ", candidate).strip().lower()
        if candidate.strip() == statement.strip() or key in {re.sub(r"\s+", " ", o).strip().lower() for o in out}:
            return False
        out.append(candidate.strip())
        return True

    own = [(c, how) for c, how in candidates(statement, quote) if _valid_false(c, quote)]
    for candidate, how in own:  # one of each kind first
        kind = how.split(":")[0]
        if kind not in kinds and len(out) < limit and add(candidate):
            kinds.add(kind)
    for candidate, _ in own:
        if len(out) < limit:
            add(candidate)
    for sentence in pool:
        if len(out) >= limit:
            break
        # a sentence cut from the middle of another one (it starts in lower case) makes a broken option
        if (sentence.strip() == quote.strip() or len(qt.content_tokens(sentence)) < 4
                or sentence.lstrip()[:1].islower()):
            continue
        for candidate, _ in candidates(sentence, sentence):
            if _valid_false(candidate, sentence) and add(candidate):
                break
    return out[:limit]
