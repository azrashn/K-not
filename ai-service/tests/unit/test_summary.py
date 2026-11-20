"""Source-bound summary: every kept point must quote the source it cites."""

import json

import pytest
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMResponse, ProviderTimeoutError
from knot_rag.summary import build_summary, summarize, verified_items
from knot_rag.unified import Summary

SOURCES = [
    {"text": "A queue removes items in first-in-first-out order. Enqueue adds at the rear."},
    {"text": "Dijkstra's algorithm needs non-negative edge weights to stay correct."},
]


class Fake:
    def __init__(self, payload):
        self.payload = payload
        self.requests = []

    def complete(self, request):
        self.requests.append(request)
        text = self.payload if isinstance(self.payload, str) else json.dumps(self.payload)
        return LLMResponse(text=text)


def test_points_are_kept_only_when_their_quote_is_in_the_cited_source():
    raw = {"points": [
        {"text": "Kuyruk FIFO çalışır.", "quote": "removes items in first-in-first-out order", "source_index": 1},
        {"text": "Kuyruk LIFO çalışır.", "quote": "removes items in last-in-first-out order", "source_index": 1},
        {"text": "Dijkstra negatif ağırlık kullanır.", "quote": "needs non-negative edge weights", "source_index": 1},
        {"text": "Kaynak yok.", "quote": "Enqueue adds at the rear.", "source_index": 9},
    ]}
    items, proposed = verified_items(raw, "summary", SOURCES)
    assert proposed == 4
    # Kept: the exact quote from source 1. Dropped: a changed quote, a quote cited to the wrong
    # source (source 2 text under index 1), and an index that does not exist.
    assert items == [{"text": "Kuyruk FIFO çalışır.", "quote": "removes items in first-in-first-out order", "source_index": 1}]


def test_build_summary_reports_dropped_points_and_marks_quotes_verified():
    raw = {"points": [
        {"text": "Kuyruk FIFO çalışır.", "quote": "A queue removes items in first-in-first-out order.", "source_index": 1},
        {"text": "Uydurma bir iddia.", "quote": "this sentence is not in any source", "source_index": 2},
    ]}
    result = build_summary(Fake(raw), "summary", "tr", SOURCES)
    assert result["focus"] == "summary"
    assert len(result["items"]) == 1
    assert result["dropped"] == 1
    assert result["quality"] == {"quote_verified": True, "model_generated": True}


def test_concepts_focus_uses_its_own_schema_and_keeps_term_and_explanation():
    raw = {"concepts": [{"term": "FIFO", "explanation": "İlk giren ilk çıkar sırasıdır.",
                         "quote": "first-in-first-out order", "source_index": 1}]}
    fake = Fake(raw)
    result = build_summary(fake, "concepts", "tr", SOURCES)
    assert result["items"][0]["term"] == "FIFO"
    assert "concepts" in fake.requests[0].response_schema["properties"]


def test_nothing_verifiable_is_an_error_not_an_empty_summary():
    raw = {"points": [{"text": "Hiçbir yerde yok.", "quote": "invented claim text", "source_index": 1}]}
    with pytest.raises(HTTPException) as exc:
        build_summary(Fake(raw), "summary", "en", SOURCES)
    assert exc.value.status_code == 422


@pytest.mark.parametrize("payload", ["not json", {"unexpected": []}])
def test_malformed_model_output_is_rejected(payload):
    with pytest.raises(HTTPException) as exc:
        build_summary(Fake(payload), "summary", "en", SOURCES)
    assert exc.value.status_code == 422


def test_provider_failure_is_not_turned_into_a_summary():
    class Down:
        def complete(self, request):
            raise ProviderTimeoutError("slow")

    with pytest.raises(HTTPException) as exc:
        build_summary(Down(), "summary", "en", SOURCES)
    assert exc.value.status_code == 422


def test_summarize_refuses_when_no_local_model_is_configured(monkeypatch):
    monkeypatch.delenv("SUMMARY_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("UNIFIED_LLM_BASE_URL", raising=False)
    body = Summary(evidence=[{"text": SOURCES[0]["text"]}], focus="summary", language="en")
    with pytest.raises(HTTPException) as exc:
        summarize(body)
    assert exc.value.status_code == 503


def test_request_model_bounds_the_evidence_count():
    with pytest.raises(Exception):
        Summary(evidence=[{"text": "x"}] * 13, focus="summary")
    with pytest.raises(Exception):
        Summary(evidence=[], focus="summary")


def test_key_terms_reach_the_model_as_a_hint_and_items_are_written_in_the_requested_language():
    import json

    from knot_rag.summary import build_summary

    seen = {}

    class Provider:
        def complete(self, request):
            seen["system"], seen["user"] = request.system, request.user
            from types import SimpleNamespace

            return SimpleNamespace(text=json.dumps({"points": [{"text": "TCP bağlantıyı üç adımda kurar.", "quote": "three-way handshake", "source_index": 1}]}))

    sources = [{"id": "a" * 64, "text": "TCP uses a three-way handshake to open a connection.", "location": {"kind": "page", "page": 4}}]
    out = build_summary(Provider(), "summary", "tr", sources, ["congestion control", "TCP", 7, "x"])
    assert "congestion control, TCP" in seen["system"] and "Turkish" in seen["system"]
    assert out["items"][0]["quote"] == "three-way handshake" and out["items"][0]["text"].startswith("TCP bağlantıyı")
    # a quote that is not in the source is dropped
    class Liar(Provider):
        def complete(self, request):
            from types import SimpleNamespace

            return SimpleNamespace(text=json.dumps({"points": [{"text": "Uydurma madde burada.", "quote": "not in the source at all", "source_index": 1}]}))

    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        build_summary(Liar(), "summary", "tr", sources)
