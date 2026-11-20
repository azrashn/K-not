import pytest

from knot_rag import explanations
from knot_rag.explanations import parse_cited_text, source_digest
from knot_rag.generation.providers.base import LLMResponse, ProviderTimeoutError, ProviderUnavailableError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.unified import Explain

LINK_LAYER = """Link layer: services
§framing, link access:
•encapsulate datagram into frame, adding
header, trailer
•channel access if shared medium
•“MAC” addresses in frame headers iden9fy
source, des9na9on (different from IP
address!)
§reliable delivery between adjacent nodes
•we already know how to do this!
…
…
Cable access
cellular
WiFi
Ethernet LANs
Link Layer 7"""
NETWORK = "network\nlink\nphysical\napplica/on\ntransport\nnetwork\nlink\nphysical\nNetwork Layer: 4-4"


def evidence():
    return [
        {"id": "a" * 64, "text": LINK_LAYER, "kind": "PDF", "location": {"page": 7}},
        {"id": "b" * 64, "text": NETWORK, "kind": "PDF", "location": {"page": 4}},
    ]


def excerpts():
    return [{"n": i + 1, "text": e["text"], "kind": e["kind"], "location": e["location"]} for i, e in enumerate(evidence())]


def body(question="Bu bölgedeki framing nedir? açıklar mısın?", mode="default"):
    return Explain(question=question, evidence=evidence(), response_mode=mode)


@pytest.fixture(autouse=True)
def model_env(monkeypatch):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-model")


def test_digest_picks_the_sentences_about_the_question_not_whole_pages():
    out = source_digest("Bu bölgedeki framing nedir? açıklar mısın?", excerpts(), "default")
    assert "encapsulate datagram into frame" in out and out.strip().endswith("[1]")
    assert "applica/on" not in out and "Cable access" not in out  # diagram junk is not shown
    assert len(out) < 600


def test_digest_length_follows_the_requested_mode():
    short = source_digest("framing", excerpts(), "short")
    detailed = source_digest("framing", excerpts(), "detailed")
    assert short.count("•") <= 2 <= detailed.count("•") or detailed.count("•") >= short.count("•")


def test_cited_text_keeps_only_paragraphs_with_real_citations():
    text = "Framing, bir datagramın başlık ve sonluk eklenerek çerçeveye konmasıdır [1].\n\nUydurma bir cümle ama kaynak yok.\n- Adresler MAC ile belirlenir [1][2][9]."
    claims = parse_cited_text(text, 2, 4)
    assert [c["sources"] for c in claims] == [[1], [1, 2]]
    assert all("[" not in c["text"] for c in claims)
    assert not any("Uydurma" in c["text"] for c in claims)


def fake(responses, calls):
    def complete(self, request):
        calls.append(request)
        r = responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return LLMResponse(text=r)

    return complete


def test_when_the_structured_answer_fails_a_plain_text_answer_is_tried(monkeypatch):
    calls = []
    plain = "Framing, datagramın başlık ve sonluk eklenerek bir çerçeveye (frame) kapsüllenmesidir [1].\n\nÇerçeve başlığındaki MAC adresleri kaynağı ve hedefi belirler [1]."
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([ProviderUnavailableError("provider error 500"), plain], calls))
    result = explanations.explain(body())
    assert result["status"] == "GENERATED_UNVERIFIED" and result["generation_path"] == "PLAIN_TEXT"
    assert result["response_mode"] == "default" and len(result["claims"]) == 2
    assert all(c["sources"] for c in result["claims"])
    assert calls[1].json_mode is False and "TURKISH" in calls[1].system  # second attempt: prose, in Turkish


def test_when_both_attempts_fail_the_reason_is_reported_and_only_relevant_sentences_are_shown(monkeypatch):
    calls = []
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([ProviderUnavailableError("e"), ProviderUnavailableError("e")], calls))
    result = explanations.explain(body())
    assert result["status"] == "GENERATION_FAILED_SOURCE_EXCERPTS" and result["generation_failure"] == "UNAVAILABLE"
    assert "framing" in result["answer"].lower() and "applica/on" not in result["answer"]


def test_a_timeout_is_not_retried_because_the_time_budget_is_spent(monkeypatch):
    calls = []
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([ProviderTimeoutError("t")], calls))
    result = explanations.explain(body())
    assert len(calls) == 1 and result["generation_failure"] == "TIMEOUT"


def test_modes_ask_for_different_things_and_report_which_one_was_used(monkeypatch):
    seen = {}
    for mode in ("short", "detailed"):
        calls = []
        one = '{"claims":[{"text":"Framing, datagramı çerçeveye koymaktır.","sources":[1]}]}'
        ok = one if mode == "short" else '{"claims":[{"text":"Framing, datagramın başlık ve sonluk eklenerek çerçeveye konmasıdır.","sources":[1]},{"text":"Çerçeve başlığındaki MAC adresleri kaynağı belirler.","sources":[1]},{"text":"Bu, bitişik düğümler arası bağlantı katmanının işidir.","sources":[1]}]}'
        monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([ok], calls))
        result = explanations.explain(body(mode=mode))
        seen[mode] = (calls[0].system, result["response_mode"])
    assert "at most 55 words" in seen["short"][0] and seen["short"][1] == "short"
    assert "thorough explanation" in seen["detailed"][0] and seen["detailed"][1] == "detailed"


def test_the_failure_detail_reaches_the_answer_and_the_lead_is_in_the_question_language(monkeypatch):
    calls = []
    boom = ProviderUnavailableError("provider error 500: model requires more system memory")
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([boom, boom], calls))
    tr = explanations.explain(body())
    assert "more system memory" in tr["generation_detail"]
    assert tr["answer"].startswith("Yerel model şu anda yanıt vermediği için")
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", fake([boom, boom], []))
    en = explanations.explain(body(question="What is framing in this region?"))
    assert en["answer"].startswith("The local model is not answering right now")
