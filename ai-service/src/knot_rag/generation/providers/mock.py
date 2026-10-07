"""Test and offline providers. Neither is an LLM; results produced with them must never be
reported as model-quality metrics."""

from __future__ import annotations

import json
import re
import threading
from typing import Callable, Sequence

from knot_rag.generation.providers.base import LLMRequest, LLMResponse
from knot_rag.text import content_tokens

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


_EVIDENCE = re.compile(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', re.DOTALL)
_SENT = re.compile(r"(?<=[.!?])\s+")
_QUESTION = re.compile(r"<question>\n(.*?)\n</question>", re.DOTALL)


class ExtractiveBaselineProvider:
    """Deterministic, offline "generator": for each evidence block it picks the sentence with
    the highest token overlap with the question and returns it verbatim as a cited claim.

    Purpose: local demos without paid APIs and exercising the full pipeline in the
    evaluation harness. It cannot synthesise or reason; it is a pipeline baseline only.
    """

    def __init__(self, min_overlap: int = 1, max_claims: int = 3):
        self._min = min_overlap
        self._max = max_claims

    @property
    def name(self) -> str:
        return "extractive_baseline"

    @property
    def model(self) -> str:
        return "extractive-baseline-v1"

    def complete(self, request: LLMRequest) -> LLMResponse:
        qm = _QUESTION.search(request.user)
        q_tokens = set(content_tokens(qm.group(1) if qm else ""))
        scored = []
        for eid, body in _EVIDENCE.findall(request.user):
            for sent in _SENT.split(body.strip()):
                overlap = len(q_tokens & set(content_tokens(sent)))
                if overlap >= self._min:
                    scored.append((overlap, int(eid[1:]), sent.strip(), eid))
        scored.sort(key=lambda x: (-x[0], x[1]))
        claims, used = [], set()
        for _, _, sent, eid in scored:
            if sent in used:
                continue
            used.add(sent)
            claims.append({"text": sent, "evidence_ids": [eid], "quote": sent, "support": "full"})
            if len(claims) >= self._max:
                break
        payload = {
            "status": "answered" if claims else "insufficient",
            "claims": claims,
            "missing": [] if claims else ["Soruyla örtüşen bir kaynak cümlesi bulunamadı."],
        }
        return LLMResponse(text=json.dumps(payload, ensure_ascii=False), finish_reason="stop")
