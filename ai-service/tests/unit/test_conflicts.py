import json
import re

from knot_rag.evidence import EvidenceMapper
from knot_rag.evidence.conflicts import detect_claim_conflicts, model_conflicts, similarity
from knot_rag.generation.generator import ModelAnswer
from knot_rag.generation.providers import ScriptedProvider
from knot_rag.schemas import AnswerRequest, RetrievedEvidence, SourceLocation, SupportStatus
from tests.fakes import scope


def ev(eid, text, doc="d"):
    return RetrievedEvidence(
        evidence_id=eid, chunk_id=f"{doc}:{eid}", document_id=doc, course_id="c", document_title=doc, document_type="notes",
        indexing_version="v1", location=SourceLocation(page_start=1), label=f"{doc} · s.1", text=text, rank=int(eid[1:]),
    )


E1 = ev("E1", "Ekleme sıralaması kararlı bir sıralama algoritmasıdır.", "notlar")
E2 = ev("E2", "Ekleme sıralaması kararlı bir sıralama algoritması değildir.", "kitap")
E3 = ev("E3", "AVL ağacında alt ağaç yükseklikleri farkı en fazla 1 olabilir.", "slayt")
E4 = ev("E4", "AVL ağacında alt ağaç yükseklikleri farkı en fazla 2 olabilir.", "eski-not")
E5 = ev("E5", "Yığın sıralaması yerinde çalışır ve O(n log n) sürer.", "kitap")


def mapped(*claims, evidence=(E1, E2, E3, E4, E5)):
    cl = [{"text": t, "evidence_ids": [e], "quote": q} for t, e, q in claims]
    return EvidenceMapper().map(ModelAnswer.model_validate({"status": "answered", "claims": cl}), list(evidence))


def test_negation_conflict_between_two_sources_is_detected():
    m = mapped(("Ekleme sıralaması kararlı bir sıralama algoritmasıdır.", "E1", "Ekleme sıralaması kararlı bir sıralama algoritmasıdır"),
               ("Ekleme sıralaması kararlı bir sıralama algoritması değildir.", "E2", "kararlı bir sıralama algoritması değildir"))
    (c,) = detect_claim_conflicts(m)
    assert c.source == "negation" and set(c.claim_ids) == {"c1", "c2"} and set(c.evidence_ids) == {"E1", "E2"}


def test_numeric_conflict_is_detected():
    m = mapped(("AVL ağacında yükseklik farkı en fazla 1 olabilir.", "E3", "farkı en fazla 1"),
               ("AVL ağacında yükseklik farkı en fazla 2 olabilir.", "E4", "farkı en fazla 2"))
    (c,) = detect_claim_conflicts(m)
    assert c.source == "numeric"


def test_unrelated_claims_are_not_conflicts():
    m = mapped(("AVL ağacında yükseklik farkı en fazla 1 olabilir.", "E3", "farkı en fazla 1"),
               ("Yığın sıralaması yerinde çalışır ve O(n log n) sürer.", "E5", "Yığın sıralaması yerinde çalışır"))
    assert detect_claim_conflicts(m) == []
    assert similarity("AVL ağacında fark en fazla 1", "Yığın sıralaması yerinde çalışır") < 0.6


def test_claims_without_valid_citations_do_not_create_conflicts():
    m = mapped(("Ekleme sıralaması kararlıdır.", "E9", "x"), ("Ekleme sıralaması kararlı değildir.", "E2", "kararlı"))
    assert detect_claim_conflicts(m) == []


def test_model_conflicts_need_two_real_evidence_ids():
    m = mapped(("Ekleme sıralaması kararlı bir sıralama algoritmasıdır.", "E1", "kararlı bir sıralama"))
    known = {"E1", "E2"}
    assert model_conflicts([["E1", "E99"]], m, known) == []  # invented id → not a conflict
    assert model_conflicts([["E1"]], m, known) == []
    (c,) = model_conflicts([["E1", "E2"]], m, known)
    assert c.source == "model" and c.claim_ids == ("c1",)


# --- pipeline: conflicts only lower support and block ANSWERED -----------------------------

Q = "AVL ağacında alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?"
_BLOCK = re.compile(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', re.DOTALL)


def _two_sources(report_conflict: bool):
    def answer(req):
        blocks = _BLOCK.findall(req.user)[:2]
        claims = []
        for eid, body in blocks:
            sent = re.split(r"(?<=[.!?])\s+", body.strip())[0]
            claims.append({"text": sent, "evidence_ids": [eid], "quote": sent})
        out = {"status": "answered", "claims": claims, "missing": []}
        if report_conflict:
            out["conflicts"] = [{"evidence_ids": [b[0] for b in blocks], "note": "kaynaklar farklı"}]
        return json.dumps(out, ensure_ascii=False)
    return answer


def test_model_reported_conflict_caps_claims_and_prevents_answered(make_components):
    comps = make_components(provider=ScriptedProvider([_two_sources(True)]))
    a = comps.rag.answer(AnswerRequest(question=Q, scope=scope()), "r")
    assert a.claims and all(c.support_status != SupportStatus.SUPPORTED for c in a.claims)
    assert a.outcome.value != "ANSWERED" and a.support_label != "SIKI"
    assert any("çelişiyor" in m for m in a.insufficient_evidence.missing_information)
    assert all("çelişiyor" in (c.support_explanation or "") for c in a.claims)


def test_same_answer_without_a_reported_conflict_is_unaffected(make_components):
    comps = make_components(provider=ScriptedProvider([_two_sources(False)]))
    a = comps.rag.answer(AnswerRequest(question=Q, scope=scope()), "r")
    assert not any("çelişiyor" in (c.support_explanation or "") for c in a.claims)


def test_a_reported_conflict_never_upgrades_a_kopuk_claim(make_components):
    def answer(req):
        (eid, _), (eid2, _) = _BLOCK.findall(req.user)[:2]
        return json.dumps({"status": "answered", "claims": [{"text": "Kırmızı-siyah ağaçlar renk kullanır.", "evidence_ids": ["E99"]}],
                           "missing": [], "conflicts": [{"evidence_ids": [eid, eid2]}]}, ensure_ascii=False)

    a = make_components(provider=ScriptedProvider([answer])).rag.answer(AnswerRequest(question=Q, scope=scope()), "r")
    assert a.claims[0].support_status == SupportStatus.UNSUPPORTED and a.outcome.value == "INSUFFICIENT_EVIDENCE"


def test_parallel_worked_examples_with_different_numbers_are_not_conflicts():
    # eval.v2 regression: two exam questions about different insertion orders are not a contradiction.
    a = "Soru 6: Bir AVL ağacına 50, 40, 30 sırasıyla eklendiğinde 50 düğümünde LL durumu oluşur ve tek sağa rotasyon uygulanır."
    b = "Soru 3: Boş bir AVL ağacına sırasıyla 10, 20, 30 eklenirse 10 düğümünde denge bozulur ve RR durumu oluşur; tek sola rotasyon uygulanır."
    E6, E7 = ev("E6", a, "sinav"), ev("E7", b, "sinav")
    assert detect_claim_conflicts(mapped((a, "E6", "LL durumu oluşur"), (b, "E7", "RR durumu oluşur"), evidence=(E6, E7))) == []
