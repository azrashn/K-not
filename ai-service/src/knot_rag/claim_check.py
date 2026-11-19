"""Word-level check of a generated claim against the sources it cites.

This is a lexical heuristic, not a proof of truth: it asks whether the claim's own words, numbers
and polarity can be found in the cited passages. It catches the common failure of an answer that
cites a real source but adds a term, a number or a negation the source does not contain.
The result is shown to the student next to the answer and never marks anything as verified.
"""

import re

from knot_rag.text import content_tokens, fold, has_negation, numbers, stem, stem_in, stem_set

SUPPORTED_COVERAGE = 0.7
PARTIAL_COVERAGE = 0.35
MAX_MISSING_FOR_SUPPORTED = 1
MIN_TERMS = 3
METHOD = "lexical-v4"
# Linking verbs and fillers a writer adds when rephrasing a source sentence ("services include ...",
# "such as", "using"). They carry no claim of their own, so a source lacking them is not evidence against it.
LIGHT_WORDS = frozenset(
    fold(w)
    for w in """
    include includes included including enable enables enabled enabling using use uses used like such
    provide provides provided providing allow allows allowed make makes made give gives given
    called known also can may might well various several many other some more most often
    typically generally mainly main basic basically based thing things way ways kind kinds type types
    içerir içeren sağlar sağlayan kullanarak kullanır kullanılır gibi çeşitli birçok genellikle
    """.split()
)
_MIN_SUBSTRING = 6
_GOOD = ("SUPPORTED", "ANCHORED")


def _collapsed(text):
    """Source text with every separator removed, so `e-commerce` / `multi-media` still contain
    `commerce` / `multimedia`."""
    return re.sub(r"\W+", "", fold(text))


_TR_CHARS = re.compile(r"[çğıöşüÇĞİÖŞÜ]")
_TR_STOP = frozenset(fold(w) for w in "ve bir bu için ile olarak gibi daha çok olan her ise ama veya de da".split())
_EN_STOP = frozenset("the and of to in is are for with that this as by on it be an".split())


def _is_turkish(text):
    words = re.findall(r"\w+", fold(text))
    tr = sum(w in _TR_STOP for w in words) + 2 * len(_TR_CHARS.findall(text))
    en = sum(w in _EN_STOP for w in words)
    return tr > en


_ACRONYM = re.compile(r"\b[A-Z][A-Z0-9]{1,9}s?\b")
_PAREN_TERM = re.compile(r"\(([A-Za-z][A-Za-z0-9 /\-]{1,40})\)")


def anchor_terms(text):
    """Language-independent anchors of a translated claim: acronyms (CRC, MAC, TCP) and original terms
    kept in parentheses ("çerçeve (frame)"). Single letters (D, G, r) are variables, not terms."""
    out = []
    for m in _ACRONYM.findall(text):
        term = m[:-1] if m.endswith("s") and m[:-1].isupper() else m
        if len(term) >= 2 and term not in out:
            out.append(term)
    for m in _PAREN_TERM.findall(text):
        term = m.strip()
        if len(term) >= 3 and term not in out and not term.isupper():
            out.append(term)
    return out


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _best_sentence(claim_stems, cited_texts):
    best, score = "", -1
    for text in cited_texts:
        for sentence in _sentences(text):
            overlap = len(claim_stems & stem_set(sentence))
            if overlap > score:
                best, score = sentence, overlap
    return best


def check_claim(claim_text, cited_texts):
    """{label, coverage, missing_terms, unmatched_numbers, negation_mismatch, method, verified}."""
    words = [t for t in dict.fromkeys(content_tokens(claim_text))
             if not t.replace(".", "").replace(",", "").isdigit() and t not in LIGHT_WORDS]
    base = {"method": METHOD, "verified": False}
    if len(words) < MIN_TERMS:
        return {**base, "label": "PARTIAL", "coverage": None, "missing_terms": [], "unmatched_numbers": [],
                "negation_mismatch": False, "reason": "TOO_SHORT_TO_CHECK"}
    source_stems = set()
    source_numbers = set()
    collapsed = ""
    for text in cited_texts:
        source_stems |= stem_set(text)
        source_numbers |= numbers(text)
        collapsed += " " + _collapsed(text)
    if cited_texts and _is_turkish(claim_text) != _is_turkish(" ".join(cited_texts)):
        # A translated claim shares almost no words with its source: a word comparison would call every
        # correct translation "unsupported". Only language-independent things (numbers) can still be checked.
        # Acronyms and original terms kept in parentheses can still be compared with the source.
        unmatched = sorted(n for n in numbers(claim_text) if n not in source_numbers)
        source_folded = fold(" ".join(cited_texts))
        anchors = anchor_terms(claim_text)
        missing_anchors = [a for a in anchors if fold(a) not in source_folded and re.sub(r"\W+", "", fold(a)) not in collapsed]
        if unmatched:
            label, reason = "PARTIAL", "NUMBER_NOT_IN_SOURCE"
        elif missing_anchors:
            label, reason = "PARTIAL", "TERMS_NOT_IN_SOURCE"
        elif anchors:
            label, reason = "ANCHORED", "TERMS_FOUND_TRANSLATED"
        else:
            label, reason = "UNCHECKED", "DIFFERENT_LANGUAGE"
        return {**base, "label": label, "reason": reason, "coverage": None, "missing_terms": missing_anchors[:6],
                "matched_terms": [a for a in anchors if a not in missing_anchors][:6],
                "unmatched_numbers": unmatched[:4], "negation_mismatch": False}
    missing = [t for t in words
               if not stem_in(stem(t), source_stems) and not (len(t) >= _MIN_SUBSTRING and t in collapsed)]
    coverage = round(1 - len(missing) / len(words), 2)
    unmatched = sorted(n for n in numbers(claim_text) if n not in source_numbers)
    claim_stems = {stem(t) for t in words}
    sentence = _best_sentence(claim_stems, cited_texts)
    # Polarity is only compared when the claim clearly rests on that sentence.
    mismatch = bool(sentence) and len(claim_stems & stem_set(sentence)) >= 2 and has_negation(claim_text) != has_negation(sentence)

    if mismatch:
        label, reason = "UNSUPPORTED", "NEGATION_MISMATCH"
    elif coverage < PARTIAL_COVERAGE:
        label, reason = "UNSUPPORTED", "LOW_COVERAGE"
    elif coverage < SUPPORTED_COVERAGE or len(missing) > MAX_MISSING_FOR_SUPPORTED or unmatched:
        label, reason = "PARTIAL", "NUMBER_NOT_IN_SOURCE" if unmatched else "TERMS_NOT_IN_SOURCE"
    else:
        label, reason = "SUPPORTED", "WORDS_FOUND_IN_SOURCE"
    return {**base, "label": label, "reason": reason, "coverage": coverage, "missing_terms": missing[:6],
            "unmatched_numbers": unmatched[:4], "negation_mismatch": mismatch}


def check_claims(claims, evidence):
    """Adds `support` to each claim and returns (claims, summary). `sources` are 1-based evidence numbers."""
    out = []
    for claim in claims:
        cited_numbers = [n for n in sorted(set(claim["sources"])) if 1 <= n <= len(evidence)]
        cited = [evidence[n - 1]["text"] for n in cited_numbers]
        support = check_claim(claim["text"], cited)
        if support["label"] not in _GOOD:
            # The model may have cited the wrong [n]. Look for support in the other evidence of the same
            # answer before telling the student the claim is missing from the sources.
            for n, item in enumerate(evidence, start=1):
                if n in cited_numbers:
                    continue
                other = check_claim(claim["text"], [item["text"]])
                if other["label"] in _GOOD:
                    support = {**other, "reason": "WRONG_SOURCE_CITED", "suggested_sources": [n],
                               "cited_sources": cited_numbers}
                    break
        out.append({**claim, "support": support})
    summary = {k: sum(1 for c in out if c["support"]["label"] == k) for k in ("SUPPORTED", "ANCHORED", "PARTIAL", "UNSUPPORTED", "UNCHECKED")}
    return out, {**summary, "total": len(out), "method": METHOD, "verified": False}
