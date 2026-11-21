"""The key check: a second call reads the question and the source sentence (never the key) and must agree."""

import json

import pytest

from knot_rag import quiz_checks as qc
from knot_rag import quiz_engine as qe
from knot_rag.generation.providers.base import LLMResponse, ProviderUnavailableError

BFS = ("BFS (genişlik öncelikli arama), düğümleri başlangıç düğümüne uzaklıklarına göre katman katman "
       "ziyaret eder. BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır. DFS, yığın veya "
       "özyineleme kullanır.")
QUOTE = "BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır."
FAST = qe.Speed(decode_tps=1000, prefill_tps=100000)


@pytest.fixture(autouse=True)
def _key_check_on(monkeypatch):
    monkeypatch.delenv("QUIZ_VERIFY_KEY", raising=False)
    monkeypatch.setenv("QUIZ_TRUTH_BALANCE", "off")  # these drafts fix is_true themselves


def mc(**over):
    return {"quote_id": 2, "question": "BFS bekleyen düğümleri hangi veri yapısında tutar?",
            "options": ["Kuyruk", "Yığın", "İkili ağaç", "Karma tablosu"], "answer": "Kuyruk",
            "explanation": "Kaynak, BFS'nin bekleyen düğümler için kuyruk kullandığını söyler.", **over}


def tf(is_true=False, **over):
    return {"quote_id": 2, "statement": "BFS, sırada bekleyen düğümleri tutmak için yığın kullanır.",
            "is_true": is_true, "explanation": "Kaynağa göre BFS yığın değil kuyruk kullanır.", **over}


def option_number(request, text):
    options = json.loads(request.user)["options"]
    return next(o["n"] for o in options if o["text"] == text)


class Scripted:
    """The next scripted answer per call: a list of drafts, a dict (raw JSON), text, an exception or a callable."""

    def __init__(self, *answers):
        self.answers, self.requests = list(answers), []

    def complete(self, request):
        self.requests.append(request)
        answer = self.answers.pop(0)
        if callable(answer):
            answer = answer(request)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, list):
            answer = {"questions": answer}
        text = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        return LLMResponse(text=text, input_tokens=100, output_tokens=20)


def pick(text):
    return lambda request: {"choice": option_number(request, text)}


def generate(kind, provider, **over):
    req = qe.QuizRequest(topic="BFS", evidence=[{"text": BFS}], items=[{"kind": kind}], **over)
    return qe.generate(req, provider, speed=FAST)


def test_an_agreeing_second_reading_marks_the_key_checked():
    provider = Scripted([mc()], pick("Kuyruk"))
    out = generate("MULTIPLE_CHOICE", provider)
    q = out["questions"][0]
    assert out["failures"] == [] and out["timing"]["calls"] == 2
    assert q["quality"]["key_checked"] is True and q["quality"]["independent_model_review"] is True
    assert q["note"] == qe.NOTE_KEY_CHECKED


def test_the_checker_sees_the_sentence_and_the_question_but_never_the_key():
    provider = Scripted([mc()], pick("Kuyruk"))
    generate("MULTIPLE_CHOICE", provider)
    checker = provider.requests[1]
    sent = json.loads(checker.user)
    assert set(sent) == {"sentence", "question", "options"}
    assert sent["sentence"] == QUOTE and len(sent["options"]) == 4
    assert "explanation" not in checker.user and "expected" not in checker.user
    assert checker.temperature == 0 and checker.max_output_tokens == qe.VERIFY_OUTPUT_TOKENS


def test_a_checker_that_reads_another_option_sends_the_question_to_repair_and_the_repair_is_checked_again():
    provider = Scripted([mc()], pick("Yığın"), [mc(answer="Kuyruk")], pick("Kuyruk"))
    out = generate("MULTIPLE_CHOICE", provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["attempts"] == 2
    problem = json.loads(provider.requests[2].user)["problem"]
    assert problem.startswith(qc.KEY_NOT_SUPPORTED)


def test_a_key_the_checker_never_agrees_with_is_dropped_with_its_own_code():
    provider = Scripted([mc()], pick("Yığın"), [mc()], pick("Yığın"))
    out = generate("MULTIPLE_CHOICE", provider)
    assert out["questions"] == []
    assert [(f["code"], f["attempts"]) for f in out["failures"]] == [(qc.KEY_NOT_SUPPORTED, 2)]


def test_a_sentence_that_does_not_settle_the_answer_counts_as_disagreement():
    provider = Scripted([mc()], {"choice": 0}, [mc()], {"choice": 0})
    out = generate("MULTIPLE_CHOICE", provider)
    assert out["questions"] == [] and out["failures"][0]["code"] == qc.KEY_NOT_SUPPORTED


@pytest.mark.parametrize("draft,verdict,kept", [
    (tf(is_true=False), "false", True),
    (tf(is_true=False), "not_stated", True),     # a changed fact the sentence does not mention is still false
    (tf(is_true=False), "true", False),
    (tf(is_true=True, statement="BFS, sırada bekleyen düğümleri tutmak için kuyruk yapısını kullanır."),
     "true", True),
    (tf(is_true=True, statement="BFS, sırada bekleyen düğümleri tutmak için kuyruk yapısını kullanır."),
     "not_stated", False),
])
def test_true_false_keys_follow_the_checkers_verdict(draft, verdict, kept):
    provider = Scripted([draft], {"verdict": verdict}, [draft], {"verdict": verdict})
    out = generate("TRUE_FALSE", provider)
    assert bool(out["questions"]) is kept
    if kept:
        assert out["questions"][0]["quality"]["key_checked"] is True


@pytest.mark.parametrize("reply", ["not json", {"choice": "one"}, {"choice": 9}, {"unexpected": 1}])
def test_an_unreadable_checker_answer_skips_the_check_instead_of_failing_the_question(reply):
    provider = Scripted([mc()], reply)
    out = generate("MULTIPLE_CHOICE", provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["key_checked"] is False
    assert out["questions"][0]["note"] == qe.NOTE


def test_a_model_error_in_the_check_skips_it_and_keeps_the_question():
    provider = Scripted([mc()], ProviderUnavailableError("down"))
    out = generate("MULTIPLE_CHOICE", provider)
    assert out["failures"] == [] and out["questions"][0]["quality"]["key_checked"] is False


def test_the_check_can_be_switched_off():
    import os

    os.environ["QUIZ_VERIFY_KEY"] = "off"
    try:
        provider = Scripted([mc()])
        out = generate("MULTIPLE_CHOICE", provider)
    finally:
        del os.environ["QUIZ_VERIFY_KEY"]
    assert len(provider.requests) == 1 and out["questions"][0]["quality"]["key_checked"] is False


@pytest.mark.parametrize("kind,draft", [
    ("CLOZE", {"quote_id": 2, "answer": "kuyruk", "explanation": "Kaynak kuyruk kullanıldığını söyler."}),
    ("SHORT_ANSWER", {"quote_id": 2, "question": "BFS bekleyen düğümleri hangi yapıda tutar?",
                      "answer": "kuyruk", "explanation": "Kaynak kuyruk kullanıldığını söyler."}),
])
def test_only_true_false_and_multiple_choice_have_a_key_to_read_back(kind, draft):
    provider = Scripted([draft])
    out = generate(kind, provider)
    assert len(provider.requests) == 1 and out["failures"] == []


def test_no_time_left_skips_the_check_without_failing():
    speed = qe.Speed(decode_tps=100, prefill_tps=1000)  # each call is estimated at about 5-7 s
    provider = Scripted([mc()])
    req = qe.QuizRequest(topic="BFS", evidence=[{"text": BFS}], items=[{"kind": "MULTIPLE_CHOICE"}],
                         budget_seconds=600)
    clock_now = [0.0]

    def clock():
        return clock_now[0]

    original = provider.complete

    def complete(request):
        clock_now[0] += 597  # the writing call used almost all of the budget
        return original(request)

    provider.complete = complete
    out = qe.generate(req, provider, speed=speed, clock=clock)
    assert out["failures"] == [] and out["questions"][0]["quality"]["key_checked"] is False


def test_the_engine_adds_the_truth_cue_to_a_vague_stem_over_statement_options(monkeypatch):
    monkeypatch.setenv("QUIZ_VERIFY_KEY", "off")
    sentence = "String ise ilkel bir tip değildir; karakter dizilerini tutan bir sınıftır."
    options = ["String ilkel bir tip değildir ve karakter dizisi tutar", "String mantıksal iki değer alan bir veridir",
               "String tam sayıları tutan bir veri tipidir", "String yalnızca sayısal ifadeleri saklayan bir sınıftır"]
    draft = {"quote_id": 1, "question": "String veri tipi hakkında ne söylenir?", "options": options,
             "answer": options[0], "explanation": "Kaynak, String'in ilkel olmadığını söyler."}
    req = qe.QuizRequest(topic="Veri Tipleri", evidence=[{"text": sentence}], items=[{"kind": "MULTIPLE_CHOICE"}])
    out = qe.generate(req, Scripted([draft]), speed=FAST)
    assert out["failures"] == []
    assert out["questions"][0]["question"] == "Veri Tipleri ile ilgili aşağıdakilerden hangisi doğrudur?"


def test_the_request_can_ask_for_the_relaxed_balance():
    base = {"topic": "x", "evidence": [{"text": "bir cümle burada"}], "items": [{"kind": "OPEN"}]}
    assert qe.QuizRequest(**base, relaxed=True).relaxed is True
    assert qe.QuizRequest(**base).relaxed is False


def test_a_relaxed_request_numbers_the_sentences_earlier_questions_used():
    sentence = "BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır."
    base = {"topic": "BFS", "evidence": [{"text": sentence}], "items": [{"kind": "OPEN"}], "avoid_quotes": [sentence]}
    assert qe.number_sentences(qe.trim_sources(base["evidence"]), base["avoid_quotes"]) == []
    out = qe.generate(qe.QuizRequest(**base), Scripted(), speed=FAST)
    assert [f["code"] for f in out["failures"]] == ["DUPLICATE_QUOTE"]  # strict: nothing left to ask
    provider = Scripted([{"quote_id": 1, "question": "BFS bekleyen düğümleri nasıl tutar, açıklayınız?",
                          "explanation": "Kaynak, kuyruk kullanıldığını söyler."}])
    relaxed = qe.generate(qe.QuizRequest(**base, relaxed=True), provider, speed=FAST)
    assert relaxed["failures"] == [] and len(relaxed["questions"]) == 1


def test_a_relaxed_try_keeps_a_key_the_code_backs_even_when_the_second_reading_differs():
    # the checker reads another option, but the correct option is stated by the sentence word for word
    strict = Scripted([mc()], pick("Yığın"), [mc()], pick("Yığın"))
    assert generate("MULTIPLE_CHOICE", strict)["questions"] == []

    provider = Scripted([mc()], pick("Yığın"))
    req = qe.QuizRequest(topic="BFS", evidence=[{"text": BFS}], items=[{"kind": "MULTIPLE_CHOICE"}], relaxed=True)
    out = qe.generate(req, provider, speed=FAST)
    assert out["failures"] == [] and len(out["questions"]) == 1
    assert out["questions"][0]["quality"]["key_checked"] is False and out["questions"][0]["note"] == qe.NOTE


COURSE_TEXT = ("Java, 1995 yılında yayımlandı. Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri "
               "kazanır. Java nesne yönelimli bir programlama dilidir. JVM, bytecode'u her platformda çalıştırır.")
GC_STATEMENT = "Çöp toplayıcı, kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır."


def test_in_a_relaxed_request_a_multiple_choice_slot_is_asked_as_a_true_statement_and_built_by_the_server(monkeypatch):
    monkeypatch.setenv("QUIZ_VERIFY_KEY", "off")
    monkeypatch.delenv("QUIZ_TRUTH_BALANCE", raising=False)  # the server-built choice follows the balance switch
    draft = {"quote_id": 2, "statement": GC_STATEMENT, "is_true": True,
             "explanation": "Kaynak, çöp toplayıcının belleği geri kazandığını söyler."}
    provider = Scripted([draft])
    req = qe.QuizRequest(topic="Bellek Yönetimi", evidence=[{"text": COURSE_TEXT}],
                         items=[{"kind": "MULTIPLE_CHOICE"}], relaxed=True)
    out = qe.generate(req, provider, speed=FAST)
    assert out["failures"] == [] and len(provider.requests) == 1
    assert "statement" in provider.requests[0].response_schema["properties"]["questions"]["items"]["properties"]
    q = out["questions"][0]
    assert q["kind"] == "MULTIPLE_CHOICE" and len(q["options"]) == 4 and q["constructed_choice"] is True
    assert q["options"][int(q["expected"])] == GC_STATEMENT
    assert q["question"] in [t.format(topic="Bellek Yönetimi") for t in qc.CHOICE_STEMS["tr"]]


def test_a_strict_request_still_asks_the_model_for_the_options(monkeypatch):
    monkeypatch.setenv("QUIZ_VERIFY_KEY", "off")
    provider = Scripted([mc()])
    qe.generate(qe.QuizRequest(topic="BFS", evidence=[{"text": BFS}], items=[{"kind": "MULTIPLE_CHOICE"}]),
                provider, speed=FAST)
    assert "options" in provider.requests[0].response_schema["properties"]["questions"]["items"]["properties"]
