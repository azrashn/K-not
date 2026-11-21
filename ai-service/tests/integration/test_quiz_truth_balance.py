"""True/false statements: the server decides which are true and which false, and refuses the other kind."""

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
# the same two kinds on another sentence ([3] "DFS, yığın veya özyineleme kullanır."), for a second question
TRUE_DRAFT_3 = {"quote_id": 3, "statement": "DFS, yığın veya özyineleme yapısını kullanır.",
                "is_true": True, "explanation": "Kaynak, DFS'nin yığın veya özyineleme kullandığını söyler."}
FALSE_DRAFT_3 = {"quote_id": 3, "statement": "DFS, kuyruk veya özyineleme kullanır.",
                 "is_true": False, "explanation": "Kaynağa göre DFS kuyruk değil yığın kullanır."}


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


def test_the_model_is_told_which_statement_is_true_and_which_false_and_both_are_kept():
    req = request("TRUE_FALSE", "TRUE_FALSE")
    plan = qe.truth_targets(req, req.items)
    drafts = [(TRUE_DRAFT if plan[0] else FALSE_DRAFT), (TRUE_DRAFT_3 if plan[1] else FALSE_DRAFT_3)]
    provider = Scripted(drafts)
    out = qe.generate(req, provider, speed=FAST)
    sent = json.loads(provider.requests[0].user)
    assert sent["truth"] == [plan[0], plan[1]] and "is_true must equal it" in provider.requests[0].system
    assert out["failures"] == []
    assert [q["expected"] for q in out["questions"]] == ["0" if plan[s] else "1" for s in (0, 1)]


def test_a_statement_of_the_other_kind_is_repaired_to_the_asked_kind():
    req = request("TRUE_FALSE")
    wanted = qe.truth_targets(req, req.items)[0]
    wrong, right = (FALSE_DRAFT, TRUE_DRAFT) if wanted else (TRUE_DRAFT, FALSE_DRAFT)
    provider = Scripted([wrong], [right])
    out = qe.generate(req, provider, speed=FAST)
    assert out["failures"] == [] and out["questions"][0]["expected"] == ("0" if wanted else "1")
    problem = json.loads(provider.requests[1].user)["problem"]
    assert problem.startswith(qc.BAD_FORMAT) and ("TRUE" if wanted else "FALSE") in problem
    assert json.loads(provider.requests[1].user)["truth"] == [wanted]


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
