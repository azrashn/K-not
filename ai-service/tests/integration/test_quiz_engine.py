"""Quiz engine v2 with a scripted provider and a fake clock; no real model is called."""

import json
import logging

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from knot_rag import quiz_checks as qc
from knot_rag import quiz_engine as qe
from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.generation.providers.base import (
    LLMRequest,
    LLMResponse,
    ProviderAuthError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderTruncatedError,
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


def test_an_unusable_provider_answer_is_invalid_json_and_repaired():
    provider = Scripted(ProviderResponseError("empty provider output"), [mc()])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["questions"][0]["quality"]["attempts"] == 2


# ── truncation: TRUNCATED, then one retry with twice the limit ───────────────────────────────
def truncated(output_tokens=None):
    return ProviderTruncatedError("provider output truncated (max tokens)", output_tokens=output_tokens)


def test_truncated_output_is_retried_once_with_twice_the_limit_instead_of_a_repair():
    provider = Scripted(truncated(440), [mc()])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["attempts"] == 2
    first, retry = provider.requests
    assert first.max_output_tokens == qe.output_tokens("MULTIPLE_CHOICE", 1) == 440
    assert retry.max_output_tokens == 2 * first.max_output_tokens
    user = json.loads(retry.user)
    assert "previous_draft" not in user and "problem" not in user  # a fresh attempt, not a repair


def test_truncated_twice_is_reported_as_truncated():
    provider = Scripted(truncated(), truncated())
    out = run(request("TRUE_FALSE"), provider)
    failure = out["failures"][0]
    assert failure["code"] == qc.TRUNCATED and failure["attempts"] == 2
    assert "token limit" in failure["detail"] and len(provider.requests) == 2


def test_a_truncated_batch_retries_each_question_alone_with_twice_its_own_limit():
    provider = Scripted(truncated(), [mc()], [MC2])
    out = run(request("MULTIPLE_CHOICE", "MULTIPLE_CHOICE"), provider)
    assert len(out["questions"]) == 2
    assert provider.requests[0].max_output_tokens == qe.output_tokens("MULTIPLE_CHOICE", 2)
    assert [r.max_output_tokens for r in provider.requests[1:]] == [2 * qe.output_tokens("MULTIPLE_CHOICE", 1)] * 2


def test_no_time_for_the_larger_retry_keeps_truncated_as_the_reason():
    clock = Clock()
    provider = Scripted(truncated(), clock=clock, seconds=60)
    out = run(request("TRUE_FALSE", budget_seconds=130), provider, speed=qe.Speed(7, 50), clock=clock)
    failure = out["failures"][0]
    assert failure["code"] == qc.TRUNCATED and failure["attempts"] == 1
    assert "süre kalmadı" in failure["detail"] and len(provider.requests) == 1


def test_truncation_is_logged_with_the_tokens_used_and_the_finish_reason(caplog):
    with caplog.at_level(logging.WARNING, logger="knot_rag.quiz_engine"):
        run(request("TRUE_FALSE"), Scripted(truncated(340), truncated()))
    lines = [r.getMessage() for r in caplog.records if "quiz_call truncated" in r.getMessage()]
    assert lines[0] == ("quiz_call truncated kind=TRUE_FALSE count=1 max_tokens=340 output_tokens=340 "
                        "finish_reason=length")
    assert "max_tokens=680 output_tokens=? " in lines[1]
    assert any("code=TRUNCATED" in r.getMessage() for r in caplog.records)


def test_the_provider_keeps_usage_when_the_output_is_cut():
    def reply(request):
        body = json.loads(request.content)
        assert body["max_tokens"] == 320 and body["response_format"]["type"] == "json_schema"
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"questions": [{"quo'},
                                                      "finish_reason": "length"}],
                                         "usage": {"prompt_tokens": 600, "completion_tokens": 320}})
    provider = OpenAICompatibleProvider("http://127.0.0.1:11436/v1", "m",
                                        client=httpx.Client(transport=httpx.MockTransport(reply)))
    with pytest.raises(ProviderTruncatedError) as exc:
        provider.complete(LLMRequest(system="s", user="u", max_output_tokens=320, response_schema={"type": "object"}))
    assert isinstance(exc.value, ProviderResponseError)  # older callers still see a response error
    assert (exc.value.output_tokens, exc.value.max_tokens, exc.value.finish_reason) == (320, 320, "length")
    assert str(exc.value) == "provider output truncated (max tokens)"


# ── quote_id: the model names a numbered sentence, the server writes the quote ──────────────────
def by_id(draft, quote_id):
    return {"quote_id": quote_id, **{k: v for k, v in draft.items() if k != "quote"}}


def test_sentences_are_numbered_across_sources_as_exact_substrings():
    sources = qe.trim_sources([{"text": BFS}, {"text": "Kısa.\nYığın son giren ilk çıkar mantığıyla çalışır. Evet."}])
    sentences = qe.number_sentences(sources)
    assert [(s["id"], s["source"]) for s in sentences] == [(1, 1), (2, 1), (3, 1), (4, 2)]
    assert sentences[1]["text"] == QUOTE and sentences[2]["text"] == DFS_QUOTE
    # "Kısa." and "Evet." are too short for a quote: they join the sentence next to them.
    assert sentences[3]["text"] == "Kısa.\nYığın son giren ilk çıkar mantığıyla çalışır. Evet."
    for s in sentences:
        assert s["text"] in sources[s["source"] - 1]["text"]


def test_a_sentence_without_punctuation_is_cut_into_quotable_pieces():
    slide = " ".join(["kelime"] * 300)  # 2099 characters, no sentence end
    sentences = qe.number_sentences([{"source": 1, "text": slide}])
    assert len(sentences) > 3 and all(len(s["text"]) <= qe.SENTENCE_MAX for s in sentences)
    assert all(s["text"] in slide for s in sentences)


def test_the_model_reads_numbered_sentences_and_returns_only_a_number():
    provider = Scripted([by_id(mc(), 2)])
    out = run(request("MULTIPLE_CHOICE"), provider)
    q = out["questions"][0]
    assert q["quote"] == QUOTE and q["source_index"] == 1 and out["failures"] == []
    r = provider.requests[0]
    assert json.loads(r.user)["sources"][0]["text"].startswith("[1] BFS (genişlik")
    assert f"[2] {QUOTE} [3] {DFS_QUOTE}" in json.loads(r.user)["sources"][0]["text"]
    assert "quote_id" in r.system and "do not copy the sentence" in r.system
    fields = r.response_schema["properties"]["questions"]["items"]["properties"]
    assert "quote" not in fields and fields["quote_id"] == {"type": "integer", "minimum": 1, "maximum": 3}


def test_the_quote_comes_from_the_right_source():
    second = "Dijkstra algoritması negatif ağırlıklı kenarlarla doğru çalışmaz."
    draft = {"quote_id": 4, "statement": "Dijkstra negatif kenarlarla doğru çalışır.", "is_true": False,
             "explanation": "Kaynak, Dijkstra'nın negatif kenarlarla doğru çalışmadığını söyler."}
    out = run(request("TRUE_FALSE", evidence=[{"text": BFS}, {"text": second}]), Scripted([draft]))
    q = out["questions"][0]
    assert q["quote"] == second and q["source_index"] == 2


@pytest.mark.parametrize("quote_id", ["2", "[2]", " 2 "])
def test_a_number_written_as_text_is_read(quote_id):
    assert run(request("MULTIPLE_CHOICE"), Scripted([by_id(mc(), quote_id)]))["questions"][0]["quote"] == QUOTE


def test_an_unknown_number_is_quote_not_found_and_the_repair_names_quote_id():
    provider = Scripted([by_id(mc(), 9)], [by_id(mc(), 2)])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["attempts"] == 2
    repair = json.loads(provider.requests[1].user)
    assert repair["problem"].startswith(qc.QUOTE_NOT_FOUND) and "quote_id" in repair["problem"]
    assert repair["previous_draft"]["quote_id"] == 9  # the model's own draft, not the server's version


@pytest.mark.parametrize("quote_id", [0, None, True, "yok", 1.5])
def test_a_missing_or_invalid_number_fails_with_quote_not_found(quote_id):
    out = run(request("MULTIPLE_CHOICE"), Scripted([by_id(mc(), quote_id)], [by_id(mc(), quote_id)]))
    assert out["failures"][0]["code"] == qc.QUOTE_NOT_FOUND


def test_the_answer_must_still_rest_on_the_chosen_sentence():
    # Sentence 3 is about DFS; the answer "Kuyruk" is not in it.
    out = run(request("MULTIPLE_CHOICE"), Scripted([by_id(mc(), 3)], [by_id(mc(), 3)]))
    assert out["failures"][0]["code"] == qc.ANSWER_NOT_IN_SOURCE


def test_a_copied_quote_is_still_accepted_when_the_server_ignores_the_schema():
    assert run(request("MULTIPLE_CHOICE"), Scripted([mc()]))["questions"][0]["quote"] == QUOTE
    # an out-of-range number next to a copied quote: the copy is checked like before
    assert run(request("MULTIPLE_CHOICE"), Scripted([{**mc(), "quote_id": 99}]))["questions"][0]["quote"] == QUOTE


# ── self-contained stems and open questions ─────────────────────────────────────────────────
def test_the_prompt_asks_for_self_contained_stems_and_real_open_questions():
    provider = Scripted([{"quote_id": 2, "question": "BFS neden kuyruk kullanır?",
                          "explanation": "Kaynak, BFS'nin bekleyen düğümleri kuyrukta tuttuğunu söyler."}])
    run(request("OPEN"), provider)
    system = provider.requests[0].system
    assert "understandable on its own" in system and "do not copy the source sentence word for word" in system
    assert "Bu, Şu, O, Daha sonra, Ardından, Böylece" in system
    assert "Never a plain statement" in system


def test_a_dangling_stem_is_repaired_with_its_reason():
    bad = by_id(mc("Bu yapı bekleyen düğümleri hangi veri yapısında tutar?"), 2)
    provider = Scripted([bad], [by_id(mc(), 2)])
    out = run(request("MULTIPLE_CHOICE"), provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["attempts"] == 2
    assert json.loads(provider.requests[1].user)["problem"].startswith(qc.NOT_SELF_CONTAINED)


# ── calculation without numbers in the sources ──────────────────────────────────────────────
CALC = {"kind": "SHORT_ANSWER", "variant": "CALCULATION"}


def test_a_calculation_without_numbers_in_the_sources_is_asked_as_a_short_answer(caplog):
    short = {"quote_id": 2, "question": "Genişlik öncelikli aramada sıradaki öğeler nerede bekletilir?", "answer": "kuyruk",
             "explanation": "Kaynak, BFS'nin bekleyen düğümleri kuyrukta tuttuğunu söyler."}
    provider = Scripted([mc()], [short])
    with caplog.at_level(logging.INFO, logger="knot_rag.quiz_engine"):
        out = run(request("MULTIPLE_CHOICE", CALC), provider)
    assert out["failures"] == []
    q = out["questions"][1]
    assert (q["slot"], q["kind"], q.get("variant"), q["downgraded_from"]) == (1, "SHORT_ANSWER", None, "CALCULATION")
    assert q["expected"] == "kuyruk"
    fields = provider.requests[1].response_schema["properties"]["questions"]["items"]["properties"]
    assert "expression" not in fields  # the short-answer schema, not the calculation one
    assert "downgraded_from" not in out["questions"][0]
    assert any("slot=1 kind=CALCULATION downgraded_to=SHORT_ANSWER reason=no_number_or_formula_in_sources"
               in r.getMessage() for r in caplog.records)


def plan(text):
    items, changed = qe.plan_items([qe.QuizItem(**CALC), qe.QuizItem(kind="OPEN")], [{"source": 1, "text": text}])
    return [(i.kind, i.variant) for i in items], changed


KEPT = ([("SHORT_ANSWER", "CALCULATION"), ("OPEN", None)], set())
DOWNGRADED = ([("SHORT_ANSWER", None), ("OPEN", None)], {0})


@pytest.mark.parametrize("text", [
    "Bir araç 120 km yolu 2 saatte alır.",                                         # a number
    "Ortalama hız, alınan toplam yolun geçen toplam süreye bölünmesiyle bulunur.",  # formula words, no number
    "Kinetik enerji, kütle ile hızın karesinin çarpımının yarısıdır: E = m * v ** x / iki.",
    "İki kuvvetin bileşkesi vektörlerin toplamı olarak hesaplanır.",
    "Verim, faydalı işin harcanan enerjiye oranı olarak tanımlanır.",
    "Momentum formülü kütle ve hızı içerir.",
    "Average speed is calculated as distance divided by time.",
    "Faiz yüzde ile ifade edilir: anaparanın %x kadarı.",
    "Yoğunluk kütlenin hacme bölümüdür: d = m / V.",
    "Güç (P) işin zamana oranıdır, yani W / t.",
    # "bulunur" / "farkı" next to a number or another formula sign
    "Ortalama hız, yolun süreye bölünmesiyle bulunur.",
    "İki sıcaklığın farkı 15 derecedir.",
    "Kâr, gelir ile gider arasındaki farkı ifade eder: K = G - M.",
    "The difference between the two speeds is found by subtracting: d = a - b.",
])
def test_a_calculation_is_kept_with_a_number_or_a_formula(text):
    assert plan(text) == KEPT


@pytest.mark.parametrize("text", [
    BFS,
    "Java nesne yönelimli bir programlama dilidir. Kaynak kod derleyici tarafından bytecode'a çevrilir. "
    "JVM bytecode'u çalıştırır ve çöp toplayıcı kullanılmayan nesnelerin belleğini geri kazanır.",
    "Ayrıntılar için https://docs.oracle.com/javase adresine bakın. // yorum satırları derlenmez.",
    "String sınıfı java/lang paketindedir; /* blok yorumları */ derlenmez.",
    # Everyday words that also appear in formulas do not make a formula on their own.
    "Java'da çöp toplayıcı bulunur.",
    "Bu bölümde sınıf ile nesne arasındaki farkı inceleyeceğiz.",
    "The answer is found by reading the documentation.",
    "We discuss the difference between a class and an object.",
])
def test_a_calculation_without_a_number_or_a_formula_becomes_a_short_answer(text):
    assert plan(text) == DOWNGRADED


def test_a_failed_downgraded_slot_is_reported_as_a_short_answer():
    out = run(request(CALC), Scripted("not json", "not json"))
    assert out["failures"][0]["kind"] == "SHORT_ANSWER" and out["failures"][0]["variant"] is None


# ── output caps ──────────────────────────────────────────────────────────────────────────────
def test_output_caps_per_kind(monkeypatch):
    monkeypatch.delenv("QUIZ_OUTPUT_TOKEN_SCALE", raising=False)
    caps = {key: qe.output_tokens(key, 1) - qe.OUTPUT_TOKENS_OVERHEAD for key in qe.OUTPUT_TOKENS}
    assert caps == {"MULTIPLE_CHOICE": 420, "TRUE_FALSE": 320, "CLOZE": 280, "SHORT_ANSWER": 280,
                    "OPEN": 320, "CALCULATION": 400}
    assert qe.output_tokens("TRUE_FALSE", 3) == 3 * 320 + 20
    assert qe.output_tokens("TRUE_FALSE", 1, 2) == 2 * (320 + 20)


@pytest.mark.parametrize("value,scale", [("1.5", 1.5), ("", 1.0), ("x", 1.0), ("-2", 1.0), ("0.1", 0.25), ("9", 4.0)])
def test_output_token_scale_setting(monkeypatch, value, scale):
    monkeypatch.setenv("QUIZ_OUTPUT_TOKEN_SCALE", value)
    assert qe.output_token_scale() == scale
    assert qe.output_tokens("TRUE_FALSE", 1) == round(320 * scale) + 20


def test_the_time_estimate_uses_the_scaled_caps(monkeypatch):
    slow = qe.Speed(7, 50)
    monkeypatch.setenv("QUIZ_OUTPUT_TOKEN_SCALE", "1")
    assert run(request("TRUE_FALSE", budget_seconds=130), Scripted([{"quote": DFS_QUOTE, "statement": "DFS kuyruk kullanır.",
                                                                     "is_true": False, "explanation": "DFS yığın kullanır, kuyruk değil."}]),
               speed=slow)["questions"]
    monkeypatch.setenv("QUIZ_OUTPUT_TOKEN_SCALE", "4")  # 1300 tokens at 7 tok/s: ~190 s > 130 s
    provider = Scripted([mc()])
    out = run(request("TRUE_FALSE", budget_seconds=130), provider, speed=slow)
    assert provider.requests == [] and out["failures"][0]["code"] == qc.BUDGET_EXHAUSTED
    monkeypatch.setenv("QUIZ_OUTPUT_TOKEN_SCALE", "1.5")
    provider = Scripted([mc()])
    run(request("MULTIPLE_CHOICE"), provider)
    assert provider.requests[0].max_output_tokens == round(420 * 1.5) + 20


# ── explanation ──────────────────────────────────────────────────────────────────────────────
def test_the_schema_and_prompt_ask_for_one_short_explanation():
    provider = Scripted([mc()])
    run(request("MULTIPLE_CHOICE"), provider)
    item = provider.requests[0].response_schema["properties"]["questions"]["items"]["properties"]
    assert item["explanation"]["maxLength"] == qc.EXPLANATION_MAX == 200
    assert all(qe.FIELDS[k]["explanation"]["maxLength"] == 200 for k in qe.FIELDS)
    assert "ONE short sentence (at most 200 characters)" in provider.requests[0].system


def test_a_long_explanation_is_cut_to_its_first_sentence():
    long = ("Kaynak, BFS'nin bekleyen düğümler için kuyruk kullandığını açıkça söyler. "
            "Ayrıca kuyruk ilk giren ilk çıkar mantığıyla çalışır ve bu yüzden katman katman ilerler.")
    q = run(request("MULTIPLE_CHOICE"), Scripted([mc(explanation=long)]))["questions"][0]
    assert q["explanation"] == "Kaynak, BFS'nin bekleyen düğümler için kuyruk kullandığını açıkça söyler."


# ── startup log ──────────────────────────────────────────────────────────────────────────────
def test_the_quiz_model_and_address_are_logged_without_secrets(monkeypatch, caplog):
    monkeypatch.delenv("QUIZ_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("QUIZ_LLM_MODEL", raising=False)
    monkeypatch.delenv("QUIZ_OUTPUT_TOKEN_SCALE", raising=False)
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://user:s3cret@127.0.0.1:11436/v1?api_key=abc#x")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "qwen3-vl:2b-instruct")
    monkeypatch.setenv("UNIFIED_LLM_API_KEY", "sk-should-not-appear")
    with caplog.at_level(logging.INFO, logger="knot_rag.quiz_engine"):
        qe.log_model_settings()
    message = caplog.records[-1].getMessage()
    assert message == ("quiz_model engine=v2 configured=true source=UNIFIED_LLM model=qwen3-vl:2b-instruct "
                       "base_url=http://127.0.0.1:11436/v1 local=True output_token_scale=1.0")
    assert "s3cret" not in message and "abc" not in message and "sk-" not in message


def test_quiz_llm_settings_win_and_a_missing_model_is_logged(monkeypatch, caplog):
    monkeypatch.setenv("QUIZ_LLM_BASE_URL", "http://127.0.0.1:11434/v1")
    monkeypatch.setenv("QUIZ_LLM_MODEL", "qwen2.5:3b")
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "other")
    assert qe.model_settings() == ("http://127.0.0.1:11434/v1", "qwen2.5:3b")
    with caplog.at_level(logging.INFO, logger="knot_rag.quiz_engine"):
        qe.log_model_settings()
    assert "source=QUIZ_LLM model=qwen2.5:3b base_url=http://127.0.0.1:11434/v1" in caplog.records[-1].getMessage()
    for name in ("QUIZ_LLM_BASE_URL", "QUIZ_LLM_MODEL", "UNIFIED_LLM_BASE_URL", "UNIFIED_LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    with caplog.at_level(logging.INFO, logger="knot_rag.quiz_engine"):
        qe.log_model_settings()
    assert "configured=false" in caplog.records[-1].getMessage()


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
    # The source has no number, but it states a formula ("bölünmesiyle bulunur"): still a calculation.
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
