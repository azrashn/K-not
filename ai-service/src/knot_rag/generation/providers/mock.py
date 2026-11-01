"""Test and offline providers. Neither is an LLM; results produced with them must never be
reported as model-quality metrics."""

from __future__ import annotations

import json
import math
import re
import threading
from typing import Callable, Sequence

from knot_rag.generation.providers.base import LLMRequest, LLMResponse
from knot_rag.text import (
    named_terms,
    question_key_terms,
    segments,
    specific_question_terms,
    stem,
    stem_in,
    stem_set,
)

# Same wording as the pipeline's coverage note, which skips its own note when this one is present.
MSG_ABSENT_TERMS = "Materyallerde karşılığı bulunamayan kavramlar: {terms}"

Script = str | Exception | Callable[[LLMRequest], str]


class ScriptedProvider:
    """Returns pre-programmed outputs (or raises pre-programmed errors) in order and records
    every request. Used by unit tests to simulate malformed JSON, fabricated citations,
    prompt-injection compliance, timeouts, etc."""

    def __init__(self, script: Sequence[Script], name: str = "scripted", model: str = "scripted-v1"):
        self._script = list(script)
        self._name = name
        self._model = model
        self._lock = threading.Lock()
        self.requests: list[LLMRequest] = []

    @property
    def name(self) -> str:
        return self._name

    @property
    def model(self) -> str:
        return self._model

    def complete(self, request: LLMRequest) -> LLMResponse:
        with self._lock:
            self.requests.append(request)
            if not self._script:
                raise AssertionError("ScriptedProvider ran out of scripted responses")
            item = self._script.pop(0) if len(self._script) > 1 else self._script[0]
        if isinstance(item, Exception):
            raise item
        text = item(request) if callable(item) else item
        return LLMResponse(text=text, finish_reason="stop")


_EVIDENCE_WITH_TITLE = re.compile(r'<evidence id="(E\d+)" document="([^"]*)"[^>]*>\n(.*?)\n</evidence>', re.DOTALL)
_QUESTION = re.compile(r"<question>\n(.*?)\n</question>", re.DOTALL)


class ExtractiveBaselineProvider:
    """Deterministic, offline "generator" (not an LLM; it cannot paraphrase, translate or reason).

    v2 (`extractive-baseline-v2`) selects verbatim statements as follows:
      1. Segment each evidence block into statements (`text.segments`): wrapped lines re-joined,
         list items split, slide titles and page numbers dropped.
      2. Weight each question key term by its rarity across those statements
         (w = ln(1 + n / df)); a term found in no statement gets the weight of the rarest
         possible term, so a question about something the material never mentions cannot be
         "answered" by statements that share only a generic word ("Git").
      3. A statement qualifies only if its matched weight is ≥ `min_share` of the question's total
         weight AND it contains a question term less widespread than the most widespread one
         (a statement sharing only "Git" never answers "Git status nedir?").
      4. Up to `max_claims` qualifying statements, best first (status "answered"; completeness
         is judged by the pipeline's question coverage). No qualifying statement → status
         "insufficient", with the question terms the evidence never mentions in `missing`.
      5. Weak match: if nothing qualifies, the best statement with a specific question term and
         share ≥ `fallback_share` (0.2, chosen on eval.v2) is returned with model support
         "partial" and status "partial" — at most GEVEŞEK, never ANSWERED. Without it, paraphrased
         and English questions over Turkish material were refused outright (eval.v2: 7 vs 4
         unnecessary refusals).
      6. If a NAMED question term (capitalised or identifier-like: "Dijkstra", "Python", "TCP")
         occurs nowhere in the evidence, the question is about something the material does not
         cover: status "insufficient" without claims ("Dijkstra algoritması nedir?" otherwise
         matched "Secure Hash Algorithm" through "algoritması").

    v1 picked, per block, the sentence with the most shared tokens (≥ 1), which turned slide
    titles and statements sharing only "Git" into claims.
    """

    def __init__(self, min_share: float = 0.34, max_claims: int = 3, fallback_share: float | None = 0.2):
        self._min_share = min_share
        self._max = max_claims
        self._fallback = fallback_share

    @property
    def name(self) -> str:
        return "extractive_baseline"

    @property
    def model(self) -> str:
        return "extractive-baseline-v2"

    def complete(self, request: LLMRequest) -> LLMResponse:
        qm = _QUESTION.search(request.user)
        question = qm.group(1) if qm else ""
        blocks = _EVIDENCE_WITH_TITLE.findall(request.user)
        segs = [(eid, seg) for eid, _, body in blocks for seg in segments(body)]
        keys = question_key_terms(question)
        seg_stems = [stem_set(seg) for _, seg in segs]
        # Terms in a passage or its title but in no candidate statement (e.g. only in a dropped
        # slide title) are context: they neither count as absent nor against a statement's share.
        block_stems = set().union(*(stem_set(f"{title} {body}") for _, title, body in blocks)) if blocks else set()
        claims: list[dict] = []
        absent: list[str] = []
        if keys and segs:
            n = len(segs)
            df = {stem(tok): sum(1 for ss in seg_stems if stem_in(stem(tok), ss)) for _, tok in keys}
            absent = [raw for raw, tok in keys if not stem_in(stem(tok), block_stems)]
            absent_stems = {stem(tok) for raw, tok in keys if raw in absent}
            # Absent terms weigh as the rarest possible term; context-only terms are left out.
            w = {st: math.log(1 + n / (d if d else 0.5)) for st, d in df.items() if d or st in absent_stems}
            total = sum(w.values())
            present = [st for st, d in df.items() if d]
            if present and not (set(named_terms(question)) & set(absent)):
                constrained, specific = specific_question_terms(question, seg_stems)
                ranked = []
                for i, ((eid, seg), ss) in enumerate(zip(segs, seg_stems)):
                    matched = [st for st in present if stem_in(st, ss)]
                    share = sum(w[st] for st in matched) / total
                    if share >= self._min_share and (not constrained or any(st in specific for st in matched)):
                        ranked.append((-share, i, eid, seg))
                support = "full"
                if not ranked and self._fallback is not None:
                    # Weak match (paraphrase, other language): best statement with a specific term,
                    # offered as PARTIAL support only — never SIKI, never an ANSWERED outcome.
                    for i, ((eid, seg), ss) in enumerate(zip(segs, seg_stems)):
                        matched = [st for st in present if stem_in(st, ss)]
                        share = sum(w[st] for st in matched) / total
                        if share >= self._fallback and (not constrained or any(st in specific for st in matched)):
                            ranked.append((-share, i, eid, seg))
                    ranked = sorted(ranked)[:1]
                    support = "partial"
                for _, _, eid, seg in sorted(ranked)[: self._max]:
                    # Claim text with normalised whitespace; the quote stays the exact source slice.
                    claims.append({"text": " ".join(seg.split()), "evidence_ids": [eid], "quote": seg, "support": support})
        if claims and claims[0]["support"] == "partial":
            payload = {"status": "partial", "claims": claims,
                       "missing": [MSG_ABSENT_TERMS.format(terms=", ".join(absent))] if absent else []}
        elif claims:
            # Whether the answer is complete is decided by the pipeline's question coverage.
            payload = {"status": "answered", "claims": claims, "missing": []}
        else:
            missing = [MSG_ABSENT_TERMS.format(terms=", ".join(absent))] if absent else []
            missing.append("Soruyla doğrudan ilgili bir kaynak cümlesi bulunamadı.")
            payload = {"status": "insufficient", "claims": [], "missing": missing}
        return LLMResponse(text=json.dumps(payload, ensure_ascii=False), finish_reason="stop")
