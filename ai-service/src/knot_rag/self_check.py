"""Student self-check: the student's own free text is split into claims and each claim is compared
with the course materials.

This is feedback from recorded evidence, never a grade: no score, no percentage. The comparison is
lexical (words, numbers, polarity), the same family of checks as claim_check.check_claim, applied to
the best matching passage window of the retrieved sources. A claim is only reported as CONFLICTS in
the two clear cases (the same statement with a different number, or with the opposite polarity);
whenever that is not clear the claim is reported as NOT_IN_SOURCE, never as a made-up contradiction.

`claim_check.check_claim` is reused unchanged. Nothing here calls an LLM.
"""

from __future__ import annotations

import re

from pydantic import Field

from knot_rag.claim_check import LIGHT_WORDS, MIN_TERMS, _sentences, check_claim
from knot_rag.text import NEGATION_WORDS, STOPWORDS, content_tokens, fold, has_negation, normalize_text, numbers, stem, stem_in, stem_set
from knot_rag.self_check_norm import canon
from knot_rag.unified import Manifest, Search, UnifiedIndex

METHOD = "self-check-lexical-v1"
MAX_TEXT_CHARS = 4000
MAX_CLAIMS = 25
MAX_SKIPPED = 10
QUOTE_CHARS = 160
MAX_SOURCES = 2
WINDOW_SENTENCES = 3
# A contradiction needs the claim to be about the same thing as the source sentence: almost all of the
# claim's own words are in it, and enough of them to be a real topic match.
CONFLICT_COVERAGE = 0.8
NUMBER_MIN_SHARED = 3
# A negation conflict may rest on a shorter claim ("UDP is not connectionless"), but then every
# word of the claim must be in the one source sentence.
NEGATION_MIN_SHARED = 3
# "Partly" is for claims whose words are mostly in the source. When most of the key terms are missing
# the honest answer is "not in the sources", not a partial match.
PARTIAL_MIN_COVERAGE = 0.6
PARTIAL_MAX_MISSING = 2

_GOOD = ("SUPPORTED", "ANCHORED")
_BULLET = re.compile(r"^\s*(?:[-–—•*▪●◦·]|\d{1,2}[.)])\s+")
_BOUNDARY = re.compile(r"(?<=[.!?…])\s+|[\n;]+")
_ABBREVIATIONS = ("örn.", "vb.", "vs.", "yak.", "bkz.", "e.g.", "i.e.", "etc.", "fig.", "yy.")
_LEADING = (
    "ayrıca", "yani", "ama", "fakat", "ancak", "ve", "çünkü", "ki", "dolayısıyla", "sonra", "ardından",
    "ayrıca", "peki", "şöyle ki", "also", "and", "but", "so", "because", "however", "then", "thus",
    "sanırım", "galiba", "herhalde", "belki", "i guess", "maybe", "perhaps", "probably",
)
# Opinion markers: the sentence is the student's view, not a statement the materials can confirm.
_OPINION = re.compile(r"^(?:bence|bana göre|bence de|i think|i feel|in my opinion|imo)\b", re.IGNORECASE)


class SelfCheck(Manifest):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)


def split_claims(text: str) -> tuple[list[str], list[dict]]:
    """(claim candidates, skipped sentences with a reason). Rule based; nothing is dropped silently
    except empty fragments."""
    claims: list[str] = []
    skipped: list[dict] = []
    pieces: list[str] = []
    for raw in _BOUNDARY.split(normalize_text_keep_lines(text)):
        raw = _BULLET.sub("", raw).strip()
        if not raw:
            continue
        if pieces and fold(pieces[-1]).endswith(_ABBREVIATIONS):
            pieces[-1] += " " + raw
        else:
            pieces.append(raw)
    for sentence in pieces:
        if sentence.endswith("?"):
            skipped.append({"text": _short(sentence), "reason": "QUESTION"})
            continue
        body = sentence.strip()
        stripped = True
        while stripped:
            stripped = False
            for lead in sorted(set(_LEADING), key=len, reverse=True):
                m = re.match(rf"^{re.escape(lead)}\b[\s,]*", body, re.IGNORECASE)
                if m and m.end() < len(body):
                    body, stripped = body[m.end():], True
                    break
        if _OPINION.match(body):
            skipped.append({"text": _short(sentence), "reason": "OPINION"})
            continue
        words = [t for t in dict.fromkeys(content_tokens(body))
                 if not t.replace(".", "").replace(",", "").isdigit() and t not in LIGHT_WORDS]
        if len(words) < MIN_TERMS:
            skipped.append({"text": _short(sentence), "reason": "TOO_SHORT"})
            continue
        claims.append(body.rstrip(".!…").strip())
    return claims, skipped[:MAX_SKIPPED]


def normalize_text_keep_lines(text: str) -> str:
    """Newlines separate bullet items, so they are kept; everything else is normalized per line."""
    return "\n".join(normalize_text(line) for line in text.splitlines())


def _short(text: str, limit: int = 90) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _claim_words(claim: str) -> list[str]:
    return [t for t in dict.fromkeys(content_tokens(claim))
            if not t.replace(".", "").replace(",", "").isdigit() and t not in LIGHT_WORDS]


def _windows(passage: str) -> list[tuple[str, int]]:
    """(text, sentence count) windows of up to WINDOW_SENTENCES consecutive sentences."""
    sentences = _sentences(passage)
    out = []
    for i in range(len(sentences)):
        for n in range(1, WINDOW_SENTENCES + 1):
            if i + n <= len(sentences):
                out.append((" ".join(sentences[i:i + n]), n))
    # Slide text has no sentence punctuation: its bullets only make sense together, so the whole passage
    # is one more window (size 0). It can support a claim but never proves a negation.
    return out + [(passage, 0)]


def _best_line(claim: str, window: str) -> str:
    """The line (or sentence) of the window that shares the most words with the claim."""
    claim_stems = {stem(t) for t in _claim_words(claim)}
    best, score = "", -1
    for line in _sentences(window):
        overlap = len(claim_stems & stem_set(line))
        if overlap > score:
            best, score = line, overlap
    return best or window


_COMPLEXITY = re.compile(r"(?<![A-Za-z])O\s*\(([^()]{1,24})\)")


def _complexities(text: str) -> set[str]:
    """Big-O expressions, normalized (`O( log n )` -> `O(LOGN)`). Letters are not numbers, but O(n) vs
    O(1) is exactly the kind of difference a lexical check must not skip."""
    return {"O(" + re.sub(r"\s+", "", m).upper() + ")" for m in _COMPLEXITY.findall(normalize_text(text))}


def _quantities(text: str) -> set[str]:
    return numbers(text) | _complexities(text)


_EXAMPLE = re.compile(r"(?<![A-Za-z])(?:for example|for instance|e\.g|suppose|consider|assume|örnek|örneğin|diyelim|varsayalım)", re.IGNORECASE)
_FOOTER = re.compile(r"(?<!\d)\d{1,3}\s*[-–]\s*\d{1,4}\s*$")


def _numeric_line(claim: str, window: str) -> str:
    """The line with numbers that shares the most words with the claim. Slide footers ("Transport
    Layer: 3-127") are page counters, not statements, and are never used."""
    claim_stems = {stem(t) for t in _claim_words(claim)}
    best, score = "", 1
    for line in _sentences(window):
        if _FOOTER.search(line) or _EXAMPLE.search(line) or not _quantities(line):
            continue
        overlap = len(claim_stems & stem_set(line))
        if overlap > score:
            best, score = line, overlap
    return best


def _quote(claim: str, window: str) -> str:
    """The most relevant stretch of the window, at most QUOTE_CHARS, always a literal part of the source."""
    lines = _sentences(window)
    if len(lines) <= 1:
        text = normalize_text(window)
    else:
        best = _best_line(claim, window)
        at = lines.index(best)
        text = normalize_text(" ".join(lines[at:at + 3]))
    return text if len(text) <= QUOTE_CHARS else text[: QUOTE_CHARS - 1].rstrip() + "…"


def _location(evidence: dict) -> dict:
    loc = evidence.get("location") or {}
    if "page" in loc:
        return {"page": loc["page"]}
    if "slide" in loc:
        return {"slide": loc["slide"]}
    if "start_ms" in loc:
        return {"start_ms": loc["start_ms"], "end_ms": loc.get("end_ms")}
    return {}


def _source(evidence: dict, window: str, claim: str) -> dict:
    return {
        "source_id": evidence["id"],
        "material_id": evidence["material_id"],
        "title": evidence.get("title", ""),
        "kind": evidence.get("kind"),
        "location": _location(evidence),
        "quote": _quote(claim, window),
    }


_PAIR = re.compile(r"(\d+(?:[.,]\d+)?)\s*-?\s*([A-Za-zÇĞİÖŞÜçğıöşüâîû]{2,})")


def _pairs(text: str) -> set[tuple[str, str]]:
    """(number, unit) pairs such as ("10", "mss") or ("64", "bayt"): a number and the word it counts."""
    out = set()
    for num, unit in _PAIR.findall(normalize_text(text)):
        key = stem(fold(unit))
        if fold(unit) not in STOPWORDS:
            out.add((num.replace(",", "."), key))
    return out


def _unit_conflict(claim: str, window: str, all_pairs: set[tuple[str, str]]) -> dict | None:
    """Same unit, different number ("10 MSS" against "1 MSS"). Works for claims with several numbers: each
    (number, unit) pair is judged alone. A source line that introduces an example is no statement of fact."""
    claim_pairs = _pairs(claim)
    if not claim_pairs:
        return None
    for line in _sentences(window):
        if _EXAMPLE.search(line) or _FOOTER.search(line):
            continue
        for m, unit in sorted(_pairs(line)):
            for n, claim_unit in sorted(claim_pairs):
                if claim_unit == unit and n != m and (n, unit) not in all_pairs:
                    return {"kind": "NUMBER", "claim": [n], "source": [m]}
    return None


def _conflict(claim: str, window: str, size: int, all_numbers: set[str],
              all_pairs: set[tuple[str, str]] | None = None) -> dict | None:
    """A clear contradiction between the claim and ONE source sentence, or None. Both rules need the
    claim to be about the same thing (almost all of its words are in the sentence)."""
    words = [t for t in _claim_words(claim) if t not in NEGATION_WORDS]
    window_stems = stem_set(window)
    shared = [t for t in words if stem_in(stem(t), window_stems)]
    if not shared or len(shared) / len(words) < CONFLICT_COVERAGE:
        return None
    claim_numbers, window_numbers = _quantities(claim), _quantities(window)
    line = _numeric_line(claim, window)
    line_shared = sum(1 for t in words if stem_in(stem(t), stem_set(line))) if line else 0
    # Different number about the same thing: the claim's number is nowhere in the retrieved sources,
    # and the sentence itself states another number.
    line_numbers = _quantities(line)
    # Only a claim with ONE quantity: with several, a different number may just be another example.
    if (len(shared) >= NUMBER_MIN_SHARED and line_shared >= 2 and len(claim_numbers) == 1 and line_numbers
            and not claim_numbers & all_numbers and not line_numbers <= claim_numbers):
        return {"kind": "NUMBER", "claim": sorted(claim_numbers)[:3], "source": sorted(line_numbers - claim_numbers)[:3]}
    if len(claim_numbers) > 1 or (all_pairs is not None and len(claim_numbers) == 1 and not line_numbers):
        unit = _unit_conflict(claim, window, all_pairs or set())
        if unit and len(shared) >= NUMBER_MIN_SHARED:
            return unit
    # Polarity: one sentence at a time. A student who DENIES something may also be compared with a short
    # window (the statement can span two lines) as long as the window holds no negation at all.
    denial = has_negation(claim) and not has_negation(window) and 1 <= size <= WINDOW_SENTENCES
    if (size == 1 or denial) and len(shared) >= NEGATION_MIN_SHARED and (not claim_numbers or claim_numbers <= window_numbers):
        if has_negation(claim) != has_negation(window):
            return {"kind": "NEGATION", "claim_negated": has_negation(claim), "source_negated": has_negation(window)}
    return None


def classify(claim: str, evidence: list[dict]) -> dict:
    """{label, sources, missing_terms, unmatched_numbers, conflict} for one claim and its retrieved evidence."""
    if not evidence:
        return {"label": "NOT_IN_SOURCE", "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    claim = canon(claim)  # compared in the same form as the source: number words become digits
    all_numbers: set[str] = set()
    for e in evidence:
        all_numbers |= _quantities(canon(e["text"]))
    all_pairs: set[tuple[str, str]] = set()
    for e in evidence:
        all_pairs |= _pairs(canon(e["text"]))
    rank = {"SUPPORTED": 4, "ANCHORED": 3, "PARTIAL": 2, "UNCHECKED": 1, "UNSUPPORTED": 0}
    scored = []  # (rank, coverage, evidence index, window, support)
    conflicts = []
    single_good = False
    claim_negated = has_negation(claim)
    for n, e in enumerate(evidence):
        for window, size in _windows(e["text"]):
            raw_window, window = window, canon(window)
            support = check_claim(claim, [window])
            if support.get("reason") == "TOO_SHORT_TO_CHECK":
                continue
            missing_quantity = sorted(_complexities(claim) - _complexities(window))
            if support["label"] in _GOOD and missing_quantity:
                support = {**support, "label": "PARTIAL", "reason": "NUMBER_NOT_IN_SOURCE",
                           "unmatched_numbers": [*support.get("unmatched_numbers", []), *missing_quantity]}
            if support.get("reason") == "TERMS_FOUND_TRANSLATED" and len(support.get("matched_terms", [])) < 2:
                support = {**support, "label": "UNCHECKED"}
            if support["label"] in _GOOD and claim_negated and not has_negation(window):
                # The student denies something the source states without any negation.
                support = {**support, "label": "UNSUPPORTED", "reason": "NEGATION_MISMATCH"}
            elif support["label"] == "PARTIAL" and not (
                (support["coverage"] or 0) >= PARTIAL_MIN_COVERAGE and len(support["missing_terms"]) <= PARTIAL_MAX_MISSING
            ):
                support = {**support, "label": "UNSUPPORTED", "reason": "LOW_COVERAGE"}
            scored.append((rank[support["label"]], support["coverage"] or 0.0, -n, raw_window, support, e))
            # Polarity is compared one sentence at a time: a negation in a neighbouring sentence of a
            # wider window says nothing about this claim. A good single sentence also settles it.
            c = _conflict(claim, window, size, all_numbers, all_pairs)
            if c:
                conflicts.append((c, raw_window, e))
            if size == 1 and support["label"] in _GOOD:
                single_good = True
    if not scored:
        return {"label": "NOT_IN_SOURCE", "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    scored.sort(key=lambda s: (s[0], s[1], s[2]), reverse=True)
    best = scored[0]
    label_rank = best[0]

    def pick(rows):
        out, seen = [], set()
        for row in rows:
            window, e = row[3], row[5]
            if e["id"] in seen:
                continue
            seen.add(e["id"])
            out.append(_source(e, window, claim))
            if len(out) == MAX_SOURCES:
                break
        return out

    if conflicts and not single_good and not (label_rank >= rank["ANCHORED"] and conflicts[0][0]["kind"] == "NUMBER"):
        c, window, e = conflicts[0]
        return {"label": "CONFLICTS", "sources": [_source(e, window, claim)], "missing_terms": [],
                "unmatched_numbers": [], "conflict": c}
    if label_rank >= rank["ANCHORED"]:
        good = [s for s in scored if s[0] >= rank["ANCHORED"]]
        translated = best[4].get("reason") == "TERMS_FOUND_TRANSLATED"
        return {"label": "IN_SOURCE", "sources": pick(good), "missing_terms": [], "unmatched_numbers": [], "conflict": None,
                "translated": translated, "matched_terms": best[4].get("matched_terms", []) if translated else []}
    if label_rank == rank["PARTIAL"]:
        support = best[4]
        return {"label": "PARTIAL", "sources": pick([s for s in scored if s[0] == rank["PARTIAL"]]),
                "missing_terms": support.get("missing_terms", []),
                "unmatched_numbers": support.get("unmatched_numbers", []), "conflict": None}
    if label_rank == rank["UNCHECKED"]:
        return {"label": "UNCHECKED", "sources": pick([s for s in scored if s[0] == rank["UNCHECKED"]]),
                "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    return {"label": "NOT_IN_SOURCE", "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}


def self_check(index: UnifiedIndex, body: SelfCheck) -> dict:
    claims, skipped = split_claims(body.text)
    truncated = len(claims) > MAX_CLAIMS
    claims = claims[:MAX_CLAIMS]
    results = []
    for claim in claims:
        found = index.search(
            Search(
                course_id=body.course_id,
                materials=body.materials,
                question=claim[:2000],
                strategy="unified",
                reference_mode="conversation",
            )
        )
        results.append({"text": claim, "translated": False, "matched_terms": [], **classify(claim, found.get("evidence", []))})
    counts = {label: sum(1 for r in results if r["label"] == label)
              for label in ("IN_SOURCE", "NOT_IN_SOURCE", "CONFLICTS", "PARTIAL", "UNCHECKED")}
    return {
        "claims": results,
        "skipped": skipped,
        "summary": {**counts, "total": len(results)},
        "truncated": truncated,
        "method": METHOD,
        "verified": False,
    }
