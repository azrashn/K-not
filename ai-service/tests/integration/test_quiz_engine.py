"""Quiz engine v2 with a scripted provider and a fake clock; no real model is called."""

import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from knot_rag import quiz_checks as qc
from knot_rag import quiz_engine as qe
from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.generation.providers.base import (
    LLMResponse,
    ProviderAuthError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider

BFS = ("BFS (genişlik öncelikli arama), düğümleri başlangıç düğümüne uzaklıklarına göre katman katman "
       "ziyaret eder. BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır. DFS, yığın veya "
       "özyineleme kullanır.")
QUOTE = "BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır."
DFS_QUOTE = "DFS, yığın veya özyineleme kullanır."
FAST = qe.Speed(decode_tps=1000, prefill_tps=100000)  # every call fits any budget


def mc(question="BFS bekleyen düğümleri hangi veri yapısında tutar?", **over):
    return {"quote": QUOTE, "question": question,
            "options": ["Kuyruk", "Yığın", "İkili ağaç", "Karma tablosu"], "answer": "Kuyruk",
            "explanation": "Kaynak, BFS'nin bekleyen düğümler için kuyruk kullandığını söyler.", **over}


MC2 = mc("DFS dolaşırken hangi yapıdan yararlanır?", quote=DFS_QUOTE,
         options=["Yığın", "Kuyruk", "Öncelik kuyruğu", "Karma tablosu"], answer="Yığın",
         explanation="Kaynağa göre DFS yığın veya özyineleme kullanır.")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Scripted:
    """Answers each call with the next scripted item: a list of drafts, raw text or an exception."""

    def __init__(self, *answers, clock=None, seconds=0.0):
        self.answers = list(answers)
        self.requests = []
        self.clock, self.seconds = clock, seconds

    def complete(self, request):
        self.requests.append(request)
        if self.clock:
            self.clock.now += self.seconds
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps({"questions": answer}, ensure_ascii=False)
        return LLMResponse(text=text, input_tokens=100, output_tokens=50)


def request(*kinds, **over):
    items = [k if isinstance(k, dict) else {"kind": k} for k in kinds]
    return qe.QuizRequest(**{"topic": "BFS ve DFS", "evidence": [{"text": BFS}], "items": items, **over})


def run(req, provider, **kw):
    kw.setdefault("speed", FAST)
    return qe.generate(req, provider, **kw)


# ── single call, batching ────────────────────────────────────────────────────────────────────
def test_one_question_needs_exactly_one_call_and_has_the_public_shape():
    provider = Scripted([mc()])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert len(provider.requests) == 1 and out["failures"] == []
    q = out["questions"][0]
    assert q["options"][int(q["expected"])] == "Kuyruk" and q["quote"] == QUOTE and q["source_index"] == 1
    assert q["quality"]["pipeline_version"] == "single-call-v1" and q["quality"]["deterministic_validation"] is True
    assert q["quality"]["independent_model_review"] is False and q["quality"]["attempts"] == 1
    assert q["option_feedback"] == [] and q["experimental"] is True and q["question_style"] == "CONCEPTUAL"
    assert out["timing"]["calls"] == 1 and out["timing"]["input_tokens"] == 100


def test_same_kind_questions_share_one_call_and_one_bad_question_does_not_drop_the_others():
    bad = mc("BFS düğümleri nasıl ziyaret eder?", answer="Bağlı liste")
    provider = Scripted([mc(), bad, MC2], [bad])  # batch, then the repair (fails again)
    out = run(request("MULTIPLE_CHOICE", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE"), provider, clock=Clock())
    assert [q["slot"] for q in out["questions"]] == [0, 2]
    assert out["failures"] == [{"slot": 1, "kind": "MULTIPLE_CHOICE", "variant": None,
                                "code": qc.ANSWER_NOT_IN_OPTIONS, "detail": "Bağlı liste",
                                "attempts": 2, "seconds": 0.0}]
    assert len(provider.requests) == 2
    assert '"questions"' in json.dumps(provider.requests[0].response_schema)
    assert provider.requests[0].response_schema["properties"]["questions"]["minItems"] == 3


def test_batches_are_split_by_kind_and_size():
    groups = qe._groups([qe.QuizItem(kind=k) for k in
                         ["MULTIPLE_CHOICE", "TRUE_FALSE", "MULTIPLE_CHOICE", "MULTIPLE_CHOICE",
                          "MULTIPLE_CHOICE"]], 3)
    assert groups == [[0, 2, 3], [4], [1]]
    calc = [qe.QuizItem(kind="SHORT_ANSWER", variant="CALCULATION"), qe.QuizItem(kind="SHORT_ANSWER")]
    assert qe._groups(calc, 3) == [[0], [1]]


def test_batch_size_setting(monkeypatch):
    monkeypatch.setenv("QUIZ_MAX_BATCH", "1")
    assert qe.batch_size() == 1
    monkeypatch.setenv("QUIZ_MAX_BATCH", "9")
    assert qe.batch_size() == 3
    monkeypatch.setenv("QUIZ_MAX_BATCH", "x")
    assert qe.batch_size() == 3


# ── repair ───────────────────────────────────────────────────────────────────────────────────
def test_a_failed_question_gets_one_repair_with_the_reason():
    wrong_quote = mc(quote="BFS her zaman kuyruk kullanır.")
    provider = Scripted([wrong_quote], [mc()])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["attempts"] == 2
    repair = json.loads(provider.requests[1].user)
    assert repair["problem"].startswith(qc.QUOTE_NOT_FOUND) and repair["previous_draft"] == wrong_quote
    assert provider.requests[1].response_schema["properties"]["questions"]["minItems"] == 1


def test_never_more_than_one_repair():
    bad = mc(answer="Yok")
    provider = Scripted([bad], [bad])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["questions"] == [] and out["failures"][0]["attempts"] == 2 and len(provider.requests) == 2


@pytest.mark.parametrize("raw,code", [
    ("not json at all", qc.INVALID_JSON),
    ('{"items": []}', qc.SCHEMA_MISMATCH),
    ('{"questions": []}', qc.SCHEMA_MISMATCH),
    ('{"questions": ["x"]}', qc.SCHEMA_MISMATCH),
])
def test_unreadable_responses_are_named_and_repaired_once(raw, code):
    provider = Scripted(raw, raw)
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["failures"][0]["code"] == code and len(provider.requests) == 2


def test_truncated_provider_output_is_invalid_json():
    provider = Scripted(ProviderResponseError("provider output truncated (max tokens)"), [mc()])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["questions"][0]["quality"]["attempts"] == 2


def test_json_in_a_code_fence_or_bare_object_is_read():
    fenced = "```json\n" + json.dumps({"questions": [mc()]}, ensure_ascii=False) + "\n```"
    assert run(request("MULTIPLE_CHOICE"), Scripted(fenced))["questions"]
    bare = json.dumps(mc(), ensure_ascii=False)
    assert run(request("MULTIPLE_CHOICE"), Scripted(bare))["questions"]


# ── timeouts and the model being down ────────────────────────────────────────────────────────
def test_timeout_drops_only_its_batch_and_is_not_repaired():
    provider = Scripted(ProviderTimeoutError("slow"), [{"quote": DFS_QUOTE, "statement": "DFS kuyruk kullanır.",
                                                        "is_true": False, "explanation": "DFS yığın kullanır."}])
    out = run(request("MULTIPLE_CHOICE", "TRUE_FALSE"), provider)
    assert [f["code"] for f in out["failures"]] == [qc.TIMEOUT] and out["failures"][0]["attempts"] == 1
    assert [q["kind"] for q in out["questions"]] == ["TRUE_FALSE"]
    assert len(provider.requests) == 2


@pytest.mark.parametrize("error", [ProviderUnavailableError("refused"), ProviderAuthError("401")])
def test_unreachable_model_without_any_question_is_503(error):
    provider = Scripted(error)
    with pytest.raises(HTTPException) as exc:
        run(request("MULTIPLE_CHOICE", "TRUE_FALSE"), provider)
    assert exc.value.status_code == 503 and exc.value.detail["code"] == qc.MODEL_UNREACHABLE
    assert {f["code"] for f in exc.value.detail["failures"]} == {qc.MODEL_UNREACHABLE}
    assert len(provider.requests) == 1  # no further calls after the model is gone


def test_unreachable_after_a_question_keeps_the_question():
    provider = Scripted([mc()], ProviderUnavailableError("refused"))
    out = run(request("MULTIPLE_CHOICE", "TRUE_FALSE"), provider)
    assert len(out["questions"]) == 1 and out["failures"][0]["code"] == qc.MODEL_UNREACHABLE


# ── time budget ──────────────────────────────────────────────────────────────────────────────
def test_estimate_matches_a_slow_cpu_model():
    speed = qe.Speed(decode_tps=7, prefill_tps=50)
    seconds = speed.seconds(prompt_chars=2100, output_tokens=280)  # ~700 prompt tokens, one MC
    assert 50 < seconds < 60


def test_a_call_that_cannot_fit_is_not_started():
    provider = Scripted()
    out = run(request("MULTIPLE_CHOICE", budget_seconds=20), provider, speed=qe.Speed(7, 50))
    assert provider.requests == [] and out["failures"][0]["code"] == qc.BUDGET_EXHAUSTED


def test_no_repair_without_time_keeps_the_original_reason():
    clock = Clock()
    provider = Scripted([mc(answer="Yok")], clock=clock, seconds=100)
    out = run(request("MULTIPLE_CHOICE", budget_seconds=130), provider, speed=qe.Speed(7, 50), clock=clock)
    failure = out["failures"][0]
    assert failure["code"] == qc.ANSWER_NOT_IN_OPTIONS and failure["attempts"] == 1
    assert "süre kalmadı" in failure["detail"] and len(provider.requests) == 1


def test_call_timeout_never_exceeds_what_is_left():
    clock = Clock()
    provider = Scripted([mc()], clock=clock)
    run(request("MULTIPLE_CHOICE", budget_seconds=130), provider, speed=qe.Speed(7, 50), clock=clock)
    assert provider.requests[0].timeout_seconds <= 130


def test_speed_settings_come_from_the_environment(monkeypatch):
    monkeypatch.setenv("QUIZ_DECODE_TPS", "11")
    monkeypatch.setenv("QUIZ_PREFILL_TPS", "nonsense")
    assert qe.Speed.from_env() == qe.Speed(11.0, 50.0)


# ── prompt size and content ──────────────────────────────────────────────────────────────────
def test_prompt_keeps_two_trimmed_sources_and_no_penalties():
    long = ("Bu cümle kaynak metindir. " * 120).strip()
    sources = qe.trim_sources([{"text": long}, {"text": BFS}, {"text": "Üçüncü kaynak kullanılmaz."}, {}])
    assert [s["source"] for s in sources] == [1, 2] and len(sources[0]["text"]) <= qe.SOURCE_CHARS
    assert sources[0]["text"].endswith(".")
    provider = Scripted([mc()])
    run(request("MULTIPLE_CHOICE", evidence=[{"text": long}, {"text": BFS}, {"text": "x" * 2000}]), provider)
    r = provider.requests[0]
    assert len(r.user) < 2 * qe.SOURCE_CHARS + 600
    assert r.frequency_penalty is None and r.presence_penalty is None


def test_style_hint_and_previous_stems_reach_the_prompt():
    provider = Scripted([mc("DFS dolaşırken hangi yapıdan yararlanır?", quote=DFS_QUOTE,
                            options=["Yığın", "Kuyruk", "Ağaç", "Liste"], answer="Yığın")])
    run(request("MULTIPLE_CHOICE", style_hint="Sınav stili: kısa sorular.",
                avoid_stems=["BFS bekleyen düğümleri hangi veri yapısında tutar?"]), provider)
    r = provider.requests[0]
    assert "Sınav stili: kısa sorular." in r.system
    assert json.loads(r.user)["avoid_questions"] == ["BFS bekleyen düğümleri hangi veri yapısında tutar?"]


def test_repeated_stem_from_an_earlier_question_is_rejected():
    provider = Scripted([mc()], [mc()])
    out = run(request("MULTIPLE_CHOICE", avoid_stems=["BFS bekleyen düğümleri hangi veri yapısında tutar?"]), provider)
    assert out["failures"][0]["code"] == qc.DUPLICATE_STEM


def test_calculation_uses_its_own_schema_and_is_checked():
    physics = "Ortalama hız, alınan toplam yolun geçen toplam süreye bölünmesiyle bulunur."
    draft = {"quote": physics, "question": "Bir araç 1.200 km yolu 2,5 saatte alıyor. Ortalama hızı kaç km/sa?",
             "expression": "1.200 / 2,5", "answer": "480 km/sa",
             "explanation": "Toplam yol toplam süreye bölünür."}
    provider = Scripted([draft])
    out = run(request({"kind": "SHORT_ANSWER", "variant": "CALCULATION"}, evidence=[{"text": physics}]), provider)
    q = out["questions"][0]
    assert (q["kind"], q["variant"], q["expected"]) == ("SHORT_ANSWER", "CALCULATION", "480")
    assert "expression" in provider.requests[0].response_schema["properties"]["questions"]["items"]["properties"]


def test_cloze_is_marked_as_source_completion():
    provider = Scripted([{"quote": QUOTE, "answer": "kuyruk", "explanation": "BFS kuyruk kullanır, kaynak böyle der."}])
    q = run(request("CLOZE"), provider)["questions"][0]
    assert q["question_style"] == "SOURCE_COMPLETION" and "_____" in q["question"]


def test_request_model_limits():
    with pytest.raises(ValueError):
        request(*["MULTIPLE_CHOICE"] * 13)
    with pytest.raises(ValueError):
        request({"kind": "MULTIPLE_CHOICE", "variant": "ESSAY"})
    with pytest.raises(ValueError):
        request("MULTIPLE_CHOICE", unknown=True)


# ── HTTP route and QUIZ_ENGINE ───────────────────────────────────────────────────────────────
AUTH = {"Authorization": "Bearer engine-tests-token"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("UNIFIED_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_ENGINE", raising=False)
    app = create_app(build_components(Settings(internal_api_token="engine-tests-token",
                                               embedding_backend="hashing", chroma_mode="memory")))
    with TestClient(app) as c:
        yield c


V2_BODY = {"topic": "BFS", "evidence": [{"text": BFS}], "items": [{"kind": "MULTIPLE_CHOICE"}]}


def with_model(monkeypatch, *answers):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")
    scripted = Scripted(*answers)
    monkeypatch.setattr(OpenAICompatibleProvider, "complete", lambda self, r: scripted.complete(r))
    return scripted


def test_route_serves_v2_by_default(client, monkeypatch):
    with_model(monkeypatch, [mc()])
    r = client.post("/api/v1/knowledge/quiz", headers=AUTH, json=V2_BODY)
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "v2" and len(body["questions"]) == 1 and body["failures"] == []


def test_route_reports_reasons_in_the_response(client, monkeypatch):
    with_model(monkeypatch, "broken", "broken")
    r = client.post("/api/v1/knowledge/quiz", headers=AUTH, json=V2_BODY)
    assert r.status_code == 200 and r.json()["failures"][0]["code"] == qc.INVALID_JSON


def test_route_without_a_local_model_is_503(client):
    r = client.post("/api/v1/knowledge/quiz", headers=AUTH, json=V2_BODY)
    assert r.status_code == 503 and r.json()["detail"]["code"] == qc.MODEL_UNREACHABLE


def test_legacy_setting_refuses_v2_requests(client, monkeypatch):
    monkeypatch.setenv("QUIZ_ENGINE", "legacy")
    with_model(monkeypatch, [mc()])
    r = client.post("/api/v1/knowledge/quiz", headers=AUTH, json=V2_BODY)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "QUIZ_ENGINE_DISABLED"


def test_legacy_shaped_requests_still_reach_the_old_engine(client, monkeypatch):
    called = {}

    def legacy(body):
        called["kind"] = body.kind
        return {"engine": "legacy"}

    monkeypatch.setattr("knot_rag.quiz_quality.quiz", legacy)
    r = client.post("/api/v1/knowledge/quiz", headers=AUTH,
                    json={"question": "BFS", "kind": "TRUE_FALSE", "evidence": [{"text": BFS}]})
    assert r.status_code == 200 and called == {"kind": "TRUE_FALSE"}


@pytest.mark.parametrize("body", [
    {**V2_BODY, "items": []},
    {**V2_BODY, "extra": 1},
    {"question": "BFS", "kind": "ESSAY", "evidence": [{"text": BFS}]},
])
def test_route_validates_both_shapes(client, body):
    assert client.post("/api/v1/knowledge/quiz", headers=AUTH, json=body).status_code == 422


def test_route_requires_auth(client):
    assert client.post("/api/v1/knowledge/quiz", json=V2_BODY).status_code == 401


def test_engine_setting_values(monkeypatch):
    for raw, expected in [("", "v2"), ("V2", "v2"), ("legacy", "legacy"), ("other", "v2")]:
        monkeypatch.setenv("QUIZ_ENGINE", raw)
        assert qe.engine_setting() == expected
