"""True/false statements: the server decides which are true and which false. The model always writes a TRUE
statement; the server turns the planned-false ones into false statements (false by construction)."""

import json

import pytest

from knot_rag import quiz_checks as qc
from knot_rag import quiz_engine as qe
from knot_rag.generation.providers.base import LLMResponse

BFS = ("BFS (genişlik öncelikli arama), düğümleri başlangıç düğümüne uzaklıklarına göre katman katman "
       "ziyaret eder. BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır. DFS, yığın veya "
       "özyineleme kullanır.")
FAST = qe.Speed(decode_tps=1000, prefill_tps=100000)

TRUE_DRAFT = {"quote_id": 2, "statement": "BFS, sırada bekleyen düğümleri tutmak için kuyruk yapısını kullanır.",
              "is_true": True, "explanation": "Kaynak, BFS'nin kuyruk kullandığını söyler."}
FALSE_DRAFT = {"quote_id": 2, "statement": "BFS, sırada bekleyen düğümleri tutmak için yığın kullanır.",
               "is_true": False, "explanation": "Kaynağa göre BFS yığın değil kuyruk kullanır."}
# a second sentence ([3] "DFS, yığın veya özyineleme kullanır."), for a second question
TRUE_DRAFT_3 = {"quote_id": 3, "statement": "DFS, yığın veya özyineleme yapısını kullanır.",
                "is_true": True, "explanation": "Kaynak, DFS'nin yığın veya özyineleme kullandığını söyler."}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("QUIZ_VERIFY_KEY", "off")
    monkeypatch.delenv("QUIZ_TRUTH_BALANCE", raising=False)


class Scripted:
    def __init__(self, *answers):
        self.answers, self.requests = list(answers), []

    def complete(self, request):
        self.requests.append(request)
        answer = self.answers.pop(0)
        return LLMResponse(text=json.dumps({"questions": answer}, ensure_ascii=False), input_tokens=10,
                           output_tokens=10)


def request(*kinds, topic="BFS"):
    return qe.QuizRequest(topic=topic, evidence=[{"text": BFS}], items=[{"kind": k} for k in kinds])


def test_statements_alternate_over_the_true_false_slots_and_ignore_other_kinds():
    req = request("TRUE_FALSE", "MULTIPLE_CHOICE", "TRUE_FALSE", "TRUE_FALSE", "TRUE_FALSE")
    plan = qe.truth_targets(req, req.items)
    assert sorted(plan) == [0, 2, 3, 4]
    assert [plan[s] for s in (0, 2, 3, 4)] in ([True, False, True, False], [False, True, False, True])


def test_the_plan_is_reproducible_and_depends_on_the_request():
    a, b = request("TRUE_FALSE", topic="BFS"), request("TRUE_FALSE", topic="BFS")
    assert qe.truth_targets(a, a.items) == qe.truth_targets(b, b.items)
    firsts = {qe.truth_targets(r, r.items)[0] for r in (request("TRUE_FALSE", topic=f"konu {i}") for i in range(12))}
    assert firsts == {True, False}  # a single question is not always true


def test_the_balance_can_be_switched_off(monkeypatch):
    monkeypatch.setenv("QUIZ_TRUTH_BALANCE", "off")
    req = request("TRUE_FALSE", "TRUE_FALSE")
    assert qe.truth_targets(req, req.items) == {}


def test_the_model_writes_true_statements_and_the_server_makes_the_planned_false_ones_false():
    req = request("TRUE_FALSE", "TRUE_FALSE")
    plan = qe.truth_targets(req, req.items)
    provider = Scripted([TRUE_DRAFT, TRUE_DRAFT_3])
    out = qe.generate(req, provider, speed=FAST)
    sent = json.loads(provider.requests[0].user)
    assert sent["truth"] == [True, True]                       # the model is always asked for a true statement
    assert out["failures"] == [] and len(provider.requests) == 1  # making a false one costs no model call
    for q, slot in zip(out["questions"], (0, 1)):
        assert q["expected"] == ("0" if plan[slot] else "1")
        if not plan[slot]:
            assert "constructed_false" in q and "doğrusu şöyledir" in q["explanation"]
            assert "kullanmaz" in q["question"]                # a negation of the true statement


def test_a_false_statement_the_model_wrote_when_a_true_one_was_asked_is_repaired():
    req = request("TRUE_FALSE")
    provider = Scripted([FALSE_DRAFT], [TRUE_DRAFT])
    out = qe.generate(req, provider, speed=FAST)
    assert out["failures"] == []
    problem = json.loads(provider.requests[1].user)["problem"]
    assert problem.startswith(qc.BAD_FORMAT) and "TRUE" in problem
    assert json.loads(provider.requests[1].user)["truth"] == [True]


def test_a_slot_planned_false_with_no_possible_change_stays_true():
    # no opposite word, number or verb the server knows: the question is kept, as a true one
    sentence = "Yığın yapısında elemanlar tek uçtan eklenir ve silinir."
    draft = {"quote_id": 1, "statement": sentence, "is_true": True,
             "explanation": "Kaynak, yığında elemanların tek uçtan eklenip silindiğini söyler."}
    for topic in (f"konu {i}" for i in range(12)):
        req = qe.QuizRequest(topic=topic, evidence=[{"text": sentence}], items=[{"kind": "TRUE_FALSE"}])
        if qe.truth_targets(req, req.items)[0] is False:
            out = qe.generate(req, Scripted([draft]), speed=FAST)
            assert out["failures"] == [] and out["questions"][0]["expected"] == "0"
            assert "constructed_false" not in out["questions"][0]
            return
    pytest.fail("no topic planned a false statement")


def test_other_kinds_are_sent_without_a_truth_list():
    provider = Scripted([{"quote_id": 2, "answer": "kuyruk", "explanation": "Kaynak kuyruk kullanıldığını söyler."}])
    qe.generate(request("CLOZE"), provider, speed=FAST)
    assert "truth" not in json.loads(provider.requests[0].user)


def test_a_topic_whose_section_has_no_text_is_reported_as_no_source_without_a_call():
    page = "4. Veri Tipleri\nJava'da sekiz ilkel veri tipi vardır.\n\n5. Bellek Yönetimi"
    req = qe.QuizRequest(topic="Bellek Yönetimi", evidence=[{"text": page}], items=[{"kind": "OPEN"}])
    provider = Scripted()
    out = qe.generate(req, provider, speed=FAST)
    assert provider.requests == [] and out["questions"] == []
    assert [f["code"] for f in out["failures"]] == ["NO_SOURCE"]
