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
from knot_rag.text import content_tokens, fold, has_negation, normalize_text, numbers, stem, stem_in, stem_set
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
CONFLICT_MIN_SHARED = 4

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
    return out or [(passage, 1)]


def _quote(window: str) -> str:
    window = normalize_text(window)
    return window if len(window) <= QUOTE_CHARS else window[: QUOTE_CHARS - 1].rstrip() + "…"


def _location(evidence: dict) -> dict:
    loc = evidence.get("location") or {}
    if "page" in loc:
        return {"page": loc["page"]}
    if "slide" in loc:
        return {"slide": loc["slide"]}
    if "start_ms" in loc:
        return {"start_ms": loc["start_ms"], "end_ms": loc.get("end_ms")}
    return {}


def _source(evidence: dict, window: str) -> dict:
    return {
        "source_id": evidence["id"],
        "material_id": evidence["material_id"],
        "title": evidence.get("title", ""),
        "kind": evidence.get("kind"),
        "location": _location(evidence),
        "quote": _quote(window),
    }


def _conflict(claim: str, window: str, all_numbers: set[str]) -> dict | None:
    """A clear contradiction between the claim and ONE source sentence, or None. Both rules need the
    claim to be about the same thing (almost all of its words are in the sentence)."""
    words = _claim_words(claim)
    if len(words) < CONFLICT_MIN_SHARED:
        return None
    window_stems = stem_set(window)
    shared = [t for t in words if stem_in(stem(t), window_stems)]
    if len(shared) < CONFLICT_MIN_SHARED or len(shared) / len(words) < CONFLICT_COVERAGE:
        return None
    claim_numbers, window_numbers = numbers(claim), numbers(window)
    # Different number about the same thing: the claim's number is nowhere in the retrieved sources,
    # and the sentence itself states another number.
    if claim_numbers and window_numbers and not claim_numbers & all_numbers and not window_numbers <= claim_numbers:
        return {"kind": "NUMBER", "claim": sorted(claim_numbers)[:3], "source": sorted(window_numbers - claim_numbers)[:3]}
    if not claim_numbers or claim_numbers <= window_numbers:
        if has_negation(claim) != has_negation(window):
            return {"kind": "NEGATION", "claim_negated": has_negation(claim), "source_negated": has_negation(window)}
    return None


def classify(claim: str, evidence: list[dict]) -> dict:
    """{label, sources, missing_terms, unmatched_numbers, conflict} for one claim and its retrieved evidence."""
    if not evidence:
        return {"label": "NOT_IN_SOURCE", "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    all_numbers: set[str] = set()
    for e in evidence:
        all_numbers |= numbers(e["text"])
    rank = {"SUPPORTED": 4, "ANCHORED": 3, "PARTIAL": 2, "UNCHECKED": 1, "UNSUPPORTED": 0}
    scored = []  # (rank, coverage, evidence index, window, support)
    conflicts = []
    single_good = False
    for n, e in enumerate(evidence):
        for window, size in _windows(e["text"]):
            support = check_claim(claim, [window])
            if support.get("reason") == "TOO_SHORT_TO_CHECK":
                continue
            scored.append((rank[support["label"]], support["coverage"] or 0.0, -n, window, support, e))
            # Polarity is compared one sentence at a time: a negation in a neighbouring sentence of a
            # wider window says nothing about this claim. A good single sentence also settles it.
            c = _conflict(claim, window, all_numbers)
            if c and (c["kind"] == "NUMBER" or size == 1):
                conflicts.append((c, window, e))
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
            out.append(_source(e, window))
            if len(out) == MAX_SOURCES:
                break
        return out

    if conflicts and not single_good and not (label_rank >= rank["ANCHORED"] and conflicts[0][0]["kind"] == "NUMBER"):
        c, window, e = conflicts[0]
        return {"label": "CONFLICTS", "sources": [_source(e, window)], "missing_terms": [],
                "unmatched_numbers": [], "conflict": c}
    if label_rank >= rank["ANCHORED"]:
        good = [s for s in scored if s[0] >= rank["ANCHORED"]]
        return {"label": "IN_SOURCE", "sources": pick(good), "missing_terms": [], "unmatched_numbers": [], "conflict": None}
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
        results.append({"text": claim, **classify(claim, found.get("evidence", []))})
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
