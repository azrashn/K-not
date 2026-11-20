"""The AI service's summary response is a contract with the backend (backend/test/unit/summary-contract.spec.ts
reads the same file). If this shape changes, both sides must change together."""

import json
from pathlib import Path

from knot_rag.generation.providers.base import LLMResponse
from knot_rag.summary import build_summary

FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "contract" / "summary_response.json").read_text(encoding="utf-8"))


class Model:
    def complete(self, request):
        return LLMResponse(text=json.dumps(FIXTURE["model_output"]))


def test_the_service_returns_exactly_the_documented_response_shape():
    result = build_summary(Model(), "summary", "tr", [{"text": s["text"]} for s in FIXTURE["sources"]])
    assert result == FIXTURE["response"]
