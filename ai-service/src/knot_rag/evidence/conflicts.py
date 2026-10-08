"""Conflicting evidence. Two signals, both of which can only LOWER support, never raise it:

  * model-reported: the model lists evidence blocks that disagree (`conflicts` in its JSON).
    Only conflicts naming ≥2 evidence ids that were actually shown to the model count; the
    model's report is a reason for caution, not verification.
  * deterministic (`conflict-lexical-v1`): two cited claims of the same answer say nearly the
    same thing (stem Jaccard ≥ 0.8, ignoring negation words and numbers) but differ in
    negation polarity ("… kararlıdır" / "… kararlı değildir") or in their numbers
    ("en fazla 1" / "en fazla 2").

Every claim involved is capped at PARTIALLY_SUPPORTED and the answer cannot be ANSWERED.
Lexical detection misses paraphrased contradictions; that needs a semantic check
(docs/rag-evaluation.md, offline validation section).
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Literal

from knot_rag.evidence.mapper import MappedClaim
from knot_rag.text import NEGATION_WORDS, content_tokens, has_negation, numbers, stem

METHOD = "conflict-lexical-v1"
SIMILARITY_MIN = 0.8  # 0.6 flagged parallel worked examples ("10, 20, 30 → RR" vs "50, 40, 30 → LL") in eval.v2


@dataclass(frozen=True)
class Conflict:
    claim_ids: tuple[str, ...]
    evidence_ids: tuple[str, ...]
    source: Literal["model", "negation", "numeric"]


def _core_stems(text: str) -> set[str]:
    return {stem(t) for t in content_tokens(text) if t not in NEGATION_WORDS and not t.replace(".", "").isdigit()}


def similarity(a: str, b: str) -> float:
    sa, sb = _core_stems(a), _core_stems(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def detect_claim_conflicts(claims: list[MappedClaim], threshold: float = SIMILARITY_MIN) -> list[Conflict]:
    cited = [c for c in claims if c.cited_evidence]
    out: list[Conflict] = []
    for a, b in combinations(cited, 2):
        if similarity(a.text, b.text) < threshold:
            continue
        kind: Literal["negation", "numeric"] | None = None
        if has_negation(a.text) != has_negation(b.text):
            kind = "negation"
        else:
            na, nb = numbers(a.text), numbers(b.text)
            if na and nb and na != nb:
                kind = "numeric"
        if kind:
            ev = tuple(dict.fromkeys(e.evidence_id for e in (*a.cited_evidence, *b.cited_evidence)))
            out.append(Conflict((a.claim_id, b.claim_id), ev, kind))
    return out


def model_conflicts(reported: list[list[str]], claims: list[MappedClaim], known_ids: set[str]) -> list[Conflict]:
    out: list[Conflict] = []
    for ids in reported:
        valid = tuple(dict.fromkeys(i.strip() for i in ids if i.strip() in known_ids))
        if len(valid) < 2:
            continue  # a conflict needs two real sources; invented ids are ignored
        involved = tuple(c.claim_id for c in claims if any(e.evidence_id in valid for e in c.cited_evidence))
        out.append(Conflict(involved, valid, "model"))
    return out
