"""Word-level check of a generated claim against the sources it cites.

This is a lexical heuristic, not a proof of truth: it asks whether the claim's own words, numbers
and polarity can be found in the cited passages. It catches the common failure of an answer that
cites a real source but adds a term, a number or a negation the source does not contain.
The result is shown to the student next to the answer and never marks anything as verified.
"""

import re

from knot_rag.text import content_tokens, has_negation, numbers, stem, stem_in, stem_set

SUPPORTED_COVERAGE = 0.7
PARTIAL_COVERAGE = 0.35
MAX_MISSING_FOR_SUPPORTED = 1
MIN_TERMS = 3
METHOD = "lexical-v1"


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
    words = [t for t in dict.fromkeys(content_tokens(claim_text)) if not t.replace(".", "").replace(",", "").isdigit()]
    base = {"method": METHOD, "verified": False}
    if len(words) < MIN_TERMS:
        return {**base, "label": "PARTIAL", "coverage": None, "missing_terms": [], "unmatched_numbers": [],
                "negation_mismatch": False, "reason": "TOO_SHORT_TO_CHECK"}
    source_stems = set()
    source_numbers = set()
    for text in cited_texts:
        source_stems |= stem_set(text)
        source_numbers |= numbers(text)
    missing = [t for t in words if not stem_in(stem(t), source_stems)]
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
        cited = [evidence[n - 1]["text"] for n in sorted(set(claim["sources"])) if 1 <= n <= len(evidence)]
        out.append({**claim, "support": check_claim(claim["text"], cited)})
    summary = {k: sum(1 for c in out if c["support"]["label"] == k) for k in ("SUPPORTED", "PARTIAL", "UNSUPPORTED")}
    return out, {**summary, "total": len(out), "method": METHOD, "verified": False}
