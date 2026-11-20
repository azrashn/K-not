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
import threading
from collections import OrderedDict

from pydantic import Field

from knot_rag.claim_check import LIGHT_WORDS, MIN_TERMS, _sentences, check_claim
from knot_rag.text import NEGATION_WORDS, STOPWORDS, content_tokens, fold, has_negation, normalize_text, numbers, stem, stem_in, stem_set
from knot_rag.self_check_judge import judge, judge_enabled
from knot_rag.self_check_rules import RULE_KINDS, rule_conflict
from knot_rag.self_check_norm import canon, repair_ocr
from knot_rag.self_check_translate import dictionary_translate, language_of, model_translate
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
_ACRONYM_RE = re.compile(r"(?<![A-Za-z])[A-Z][A-Z0-9]{1,9}(?![A-Za-z])")
_FOLD = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiuCGIOSU")
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
    # Claims already checked in an earlier request for the same text ("check the rest").
    offset: int = Field(default=0, ge=0, le=500)


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
    """The most relevant stretch of the window, at most QUOTE_CHARS, always a literal part of the source
    (damaged OCR characters included). The stretch is chosen on the repaired text."""
    lines = _sentences(window)
    if len(lines) <= 1:
        text = normalize_text(window)
    else:
        vocabulary = {w.translate(_FOLD).lower() for w in re.findall(r"[^\W\d_]{3,}", claim)}
        repaired = _sentences(repair_ocr(window, vocabulary))
        # repair keeps the line structure, so the index found on the repaired lines is valid for the originals
        if len(repaired) == len(lines):
            at = repaired.index(_best_line(claim, chr(10).join(repaired)))
        else:
            at = lines.index(_best_line(claim, window))
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
        "passage": normalize_text(window)[:700],  # for the meaning check; removed before the answer leaves
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


def _basic_conflict(claim: str, window: str, size: int, all_numbers: set[str],
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


def _conflict(claim: str, window: str, size: int, all_numbers: set[str],
              all_pairs: set[tuple[str, str]] | None = None) -> dict | None:
    """Number / negation conflict, else a rule-based one (opposite word, swapped direction, comparison)."""
    return _basic_conflict(claim, window, size, all_numbers, all_pairs) or rule_conflict(claim, window, size)


def classify(claim: str, evidence: list[dict], short_ok: bool = False) -> dict:
    """{label, sources, missing_terms, unmatched_numbers, conflict} for one claim and its retrieved evidence."""
    if not evidence:
        return {"label": "NOT_IN_SOURCE", "sources": [], "missing_terms": [], "unmatched_numbers": [], "conflict": None}
    claim = canon(claim)  # compared in the same form as the source: number words become digits
    vocabulary = {w.translate(_FOLD).lower() for w in re.findall(r"[^\W\d_]{3,}", claim)}
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
    acronyms = {a.translate(_FOLD).lower() for a in re.findall(r"(?<![A-Za-z])[A-Z][A-Z0-9]{1,9}(?![A-Za-z])", claim)}
    for n, e in enumerate(evidence):
        for window, size in _windows(e["text"]):
            raw_window, window = window, repair_ocr(canon(window), vocabulary)
            support = check_claim(claim, [window])
            if support.get("reason") == "TOO_SHORT_TO_CHECK":
                if not (short_ok and size in (1, 2)):
                    continue
                # A short half of a compound claim ("UDP is connectionless"): supported only when EVERY
                # one of its words (and numbers) is in one or two consecutive source sentences.
                words = _claim_words(claim)
                stems_in = stem_set(window)
                if len(words) < 2 or not all(stem_in(stem(t), stems_in) for t in words) or (numbers(claim) - numbers(window)):
                    continue
                support = {"label": "SUPPORTED", "reason": "WORDS_FOUND_IN_SOURCE", "coverage": 1.0,
                           "missing_terms": [], "unmatched_numbers": [], "negation_mismatch": False}
            missing_quantity = sorted(_complexities(claim) - _complexities(window))
            if support["label"] in _GOOD and missing_quantity:
                support = {**support, "label": "PARTIAL", "reason": "NUMBER_NOT_IN_SOURCE",
                           "unmatched_numbers": [*support.get("unmatched_numbers", []), *missing_quantity]}
            if support.get("reason") == "TERMS_FOUND_TRANSLATED" and len(support.get("matched_terms", [])) < 2:
                support = {**support, "label": "UNCHECKED"}
            if support["label"] in _GOOD and claim_negated and not has_negation(window):
                # The student denies something the source states without any negation.
                support = {**support, "label": "UNSUPPORTED", "reason": "NEGATION_MISMATCH"}
            elif support["label"] == "PARTIAL" and (
                not ((support["coverage"] or 0) >= PARTIAL_MIN_COVERAGE and len(support["missing_terms"]) <= PARTIAL_MAX_MISSING)
                # an acronym of the claim (AES, TLS) that the source lacks is the very thing being asserted
                or set(support["missing_terms"]) & acronyms
            ):
                support = {**support, "label": "UNSUPPORTED", "reason": "LOW_COVERAGE"}
            # Polarity is compared one sentence at a time: a negation in a neighbouring sentence of a
            # wider window says nothing about this claim. A good single sentence also settles it.
            c = _conflict(claim, window, size, all_numbers, all_pairs)
            if c and c["kind"] in RULE_KINDS and support["label"] in _GOOD:
                # Same words, opposite meaning (swapped roles, opposite word): this sentence does not
                # support the claim, it contradicts it.
                support = {**support, "label": "UNSUPPORTED", "reason": "CONTRADICTED"}
            scored.append((rank[support["label"]], support["coverage"] or 0.0, -n, raw_window, support, e))
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


# ── compound claims ──────────────────────────────────────────────────────────────────────────
# "A and B": each half is judged alone, so a contradicted half is not hidden by a supported one.
# Split only when both halves are real statements: enough content words on each side.
MAX_PARTS = 4
PART_MIN_WORDS = 3
_STRONG_JOIN = re.compile(r"\s*,?\s+(?:but|whereas|while|ama|fakat|ancak|oysa|halbuki|ise)\s+|\s*;\s*", re.IGNORECASE)
_PLAIN_JOIN = re.compile(r"\s*,\s*(?:and|ve|ayrıca|also)\s+|\s+(?:and|ve)\s+", re.IGNORECASE)


def _content_count(text: str) -> int:
    return len(_claim_words(text))


LOOSE_MIN_WORDS = 2


def split_compound(claim: str, loose: bool = False) -> list[str]:
    """Halves of a compound claim, or [claim] when it is a single statement. `loose` also splits a short
    half ("UDP is connectionless and TCP uses AES"); it is only trusted when the split is confirmed by
    the sources (see self_check)."""
    parts = [claim]
    low = LOOSE_MIN_WORDS if loose else PART_MIN_WORDS
    for pattern, minimum in ((_STRONG_JOIN, low), (_PLAIN_JOIN, low if loose else PART_MIN_WORDS + 1)):
        nxt: list[str] = []
        for part in parts:
            pieces = [x.strip(" ,") for x in pattern.split(part) if x and x.strip(" ,")]
            if len(pieces) > 1 and all(_content_count(x) >= minimum for x in pieces):
                nxt.extend(pieces)
            else:
                nxt.append(part)
        parts = nxt
    return parts[:MAX_PARTS] if len(parts) > 1 else [claim]


def _combine(claim: str, subs: list[dict]) -> dict:
    """One result for a compound claim from the results of its parts."""
    labels = [x["label"] for x in subs]
    conflict = next((x for x in subs if x["label"] == "CONFLICTS"), None)
    if conflict:
        label = "CONFLICTS"
    elif all(l == "IN_SOURCE" for l in labels):
        label = "IN_SOURCE"
    elif all(l == "NOT_IN_SOURCE" for l in labels):
        label = "NOT_IN_SOURCE"
    elif all(l == "UNCHECKED" for l in labels):
        label = "UNCHECKED"
    else:
        label = "PARTIAL"
    sources, seen = [], set()
    for x in ([conflict] if conflict else []) + subs:
        for src in x["sources"]:
            if src["source_id"] not in seen and len(sources) < MAX_SOURCES:
                seen.add(src["source_id"])
                sources.append(src)
    return {
        "label": label,
        "sources": sources,
        "missing_terms": [t for x in subs for t in x["missing_terms"]][:6],
        "unmatched_numbers": [t for x in subs for t in x["unmatched_numbers"]][:4],
        "conflict": conflict["conflict"] if conflict else None,
        "translated": any(x.get("translated") for x in subs),
        "matched_terms": [t for x in subs for t in x.get("matched_terms", [])][:6],
        "parts": [{"text": t, "label": x["label"], "sources": x["sources"][:1], "missing_terms": x["missing_terms"], "meaning_warning": None,
                   "unmatched_numbers": x["unmatched_numbers"], "conflict": x["conflict"]}
                  for t, x in zip(_part_texts(subs), subs)],
    }


def _part_texts(subs: list[dict]) -> list[str]:
    return [x["text"] for x in subs]


# One checked claim stays valid while the materials (ids + versions) are the same: editing one sentence
# and checking again only works on the sentence that changed.
CACHE_SIZE = 600
_cache: "OrderedDict[tuple, dict]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(body: SelfCheck, claim: str) -> tuple:
    return (body.course_id, tuple(sorted((m.id, m.version) for m in body.materials)), claim)


def _cached(key: tuple):
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    return None


def _remember(key: tuple, value: dict) -> None:
    with _cache_lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)


def _join_translations(subs: list[dict]) -> dict | None:
    used = [x["translation"] for x in subs if x.get("translation")]
    if not used:
        return None
    return {"text": "; ".join(t["text"] for t in used if t["text"]) or None,
            "method": "model" if any(t["method"] == "model" for t in used) else "dictionary", "to": used[0]["to"]}


def _meaning_check(results: list[dict], judge_fn) -> None:
    """Second opinion from the local model for claims found in a source. Adds `meaning_warning` (the
    deciding quote) when the model says CONTRADICTS and the quote is literally in the passage. The label
    is never changed here."""
    if judge_fn is None and not judge_enabled():
        return
    targets = []
    for r in results:
        for t in (r["parts"] if len(r["parts"]) > 1 else [r]):
            if t["label"] in ("IN_SOURCE", "PARTIAL") and t["sources"] and t["sources"][0].get("passage"):
                targets.append((r, t))
    verdicts = (judge_fn or judge)([(t["text"], t["sources"][0]["passage"]) for _, t in targets])
    for (r, t), v in zip(targets, verdicts):
        if v and v["verdict"] == "CONTRADICTS":
            warning = {"quote": v["quote"][:240], "source_id": t["sources"][0]["source_id"]}
            t["meaning_warning"] = warning
            r["meaning_warning"] = r["meaning_warning"] or warning


def _strip_passages(result: dict) -> None:
    for t in [result, *result["parts"]]:
        t["sources"] = [{k: v for k, v in s.items() if k != "passage"} for s in t["sources"]]


_RANK = {"IN_SOURCE": 4, "PARTIAL": 3, "CONFLICTS": 2, "UNCHECKED": 1, "NOT_IN_SOURCE": 0}
_materials_language_cache: dict[tuple, str | None] = {}


def materials_language(index: UnifiedIndex, body: SelfCheck) -> str | None:
    """'tr' or 'en': the language most of the selected materials' text is written in (None when unknown).
    Sampled from the index, so it also holds when a claim shares no word with the sources."""
    key = (body.course_id, tuple(sorted((m.id, m.version) for m in body.materials)))
    if key in _materials_language_cache:
        return _materials_language_cache[key]
    language = None
    try:
        with index.lock:
            rows = index.collection().get(
                where={"$and": [{"course_id": body.course_id},
                                {"material_id": {"$in": [m.id for m in body.materials]}},
                                {"marker": False}]},
                limit=60,
            )
        texts = [t for t in rows.get("documents", []) if isinstance(t, str) and len(t) > 80]
        if texts:
            turkish = sum(1 for t in texts if language_of(t) == "tr")
            language = "tr" if turkish * 2 > len(texts) else "en"
    except Exception:  # the sample only decides whether to translate; no sample means no translation
        language = None
    if len(_materials_language_cache) > 200:
        _materials_language_cache.clear()
    _materials_language_cache[key] = language
    return language


def self_check(index: UnifiedIndex, body: SelfCheck, translate=model_translate, judge_fn=None) -> dict:
    claims, skipped = split_claims(body.text)
    window = claims[body.offset:body.offset + MAX_CLAIMS]
    remaining = max(0, len(claims) - body.offset - len(window))
    claims = window
    if body.offset:
        skipped = []  # already reported with the first part
    evidence_cache: dict[str, list[dict]] = {}

    def search(question: str) -> list[dict]:
        found = index.search(
            Search(
                course_id=body.course_id,
                materials=body.materials,
                question=question[:2000],
                strategy="unified",
                reference_mode="conversation",
            )
        )
        return found.get("evidence", [])

    def evidence_for(text: str) -> list[dict]:
        if text not in evidence_cache:
            found = search(text)
            if not found and _ACRONYM_RE.search(text):
                # The search demands every acronym of the question in the passage, so a claim that SWAPS
                # an acronym (FIFO for LIFO) would never meet the passage it contradicts. Ask again
                # with the acronyms as plain words; classify() still treats a missing acronym as missing.
                found = search(_ACRONYM_RE.sub(lambda m: m.group(0).lower(), text))
            evidence_cache[text] = found
        return evidence_cache[text]

    pending = [(c, split_compound(c) + [x for x in split_compound(c, loose=True) if len(split_compound(c)) == 1])
               for c in claims if _cached(_cache_key(body, c)) is None]
    source_language = materials_language(index, body) if pending else None
    # Statements written in another language than the materials are compared through a translation.
    cross = sorted({p for _, parts in pending for p in parts if source_language and language_of(p) != source_language})
    model_translations: dict[str, str] = {}
    if cross:
        for text, translated in zip(cross, translate(cross, source_language)):
            if translated:
                model_translations[text] = translated

    def check_statement(text: str, short_ok: bool = False) -> dict:
        first = {"text": text, "translated": False, "matched_terms": [], "translation": None, **classify(text, evidence_for(text), short_ok)}
        if not source_language or language_of(text) == source_language:
            return first
        best, best_key = first, (_RANK[first["label"]], 0)  # ties: model translation > dictionary > as written
        variants = []
        dictionary = dictionary_translate(text, source_language)
        if dictionary:
            variants.append((dictionary, "dictionary"))
        if text in model_translations:
            variants.append((model_translations[text], "model"))
        for variant, method in variants:
            result = classify(variant, evidence_for(variant), short_ok)
            conflict = result.get("conflict")
            if result["label"] == "CONFLICTS" and method == "dictionary" and (not conflict or conflict["kind"] != "NUMBER"):
                # a word-by-word translation can lose a negation: only a number difference is trusted
                continue
            candidate = {**first, **result, "text": text, "translated": True, "matched_terms": [],
                         "translation": {"text": variant if method == "model" else None, "method": method, "to": source_language}}
            key = (_RANK[candidate["label"]], 2 if method == "model" else 1)
            if key > best_key:
                best, best_key = candidate, key
        return best

    results = []
    fresh: list[tuple[tuple, dict]] = []
    for claim in claims:
        key = _cache_key(body, claim)
        hit = _cached(key)
        if hit is not None:
            results.append(hit)
            continue
        parts = split_compound(claim)
        base = {"text": claim, "translated": False, "matched_terms": [], "translation": None, "parts": [], "meaning_warning": None}
        if len(parts) == 1:
            result = {**base, **check_statement(claim)}
            loose = split_compound(claim, loose=True)
            if len(loose) > 1 and result["label"] in ("NOT_IN_SOURCE", "PARTIAL", "UNCHECKED"):
                # A short half hid a supported half. The split is kept only when the sources confirm it:
                # at least one part must be found in them, otherwise the claim stays one statement.
                subs = [check_statement(p, short_ok=True) for p in loose]
                if any(x["label"] == "IN_SOURCE" for x in subs):
                    result = {**base, **_combine(claim, subs)}
                    result["translation"] = _join_translations(subs)
        else:
            subs = [check_statement(p) for p in parts]
            result = {**base, **_combine(claim, subs)}
            result["translation"] = _join_translations(subs)
        fresh.append((key, result))
        results.append(result)
    _meaning_check([r for _, r in fresh], judge_fn)
    for key, result in fresh:
        _strip_passages(result)
        _remember(key, result)
    counts = {label: sum(1 for r in results if r["label"] == label)
              for label in ("IN_SOURCE", "NOT_IN_SOURCE", "CONFLICTS", "PARTIAL", "UNCHECKED")}
    return {
        "claims": results,
        "skipped": skipped,
        "summary": {**counts, "total": len(results)},
        "truncated": remaining > 0,
        "remaining": remaining,
        "next_offset": body.offset + len(claims),
        "method": METHOD,
        "verified": False,
    }
