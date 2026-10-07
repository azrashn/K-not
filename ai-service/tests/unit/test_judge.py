import json
from dataclasses import replace

from knot_rag.config import LLMSettings, SupportSettings
from knot_rag.evidence import EvidenceMapper, HeuristicSupportAssessor, LLMJudgeSupportAssessor
from knot_rag.generation.generator import ModelAnswer
from knot_rag.generation.providers import ProviderUnavailableError, ScriptedProvider
from knot_rag.schemas import AnswerRequest, RetrievedEvidence, SourceLocation, SupportStatus, VerificationLevel
from tests.fakes import scope

EV = RetrievedEvidence(
    evidence_id="E1", chunk_id="n:1", document_id="n", course_id="c", document_title="Notlar", document_type="notes",
    indexing_version="v1", location=SourceLocation(page_start=1), label="Notlar · s.1",
    text="Pratikte kırmızı-siyah ağaçlara göre daha sıkı dengeli; arama daha hızlı, güncelleme biraz yavaş.", rank=1,
)
Q = "AVL ağacı ile kırmızı-siyah ağaç arasındaki fark nedir?"
PARAPHRASE = {"text": "AVL ağacı kırmızı-siyah ağaçtan daha sıkı dengelidir, bu nedenle aramada genellikle daha hızlıdır.",
              "evidence_ids": ["E1"], "quote": "daha sıkı dengeli; arama daha hızlı"}


def verdicts(*v):
    return json.dumps({"verdicts": [{"claim_id": cid, "verdict": verdict, "reason": "r"} for cid, verdict in v]})


def judge(script, claims, question=Q):
    p = ScriptedProvider(script)
    a = LLMJudgeSupportAssessor(HeuristicSupportAssessor(SupportSettings()), p, LLMSettings())
    mapped = EvidenceMapper().map(ModelAnswer.model_validate({"status": "answered", "claims": claims}), [EV])
    return a.assess_all(mapped, question), p


def test_paraphrase_overlap_only_geveşek_is_upgraded_by_entailment():
    base = HeuristicSupportAssessor(SupportSettings()).assess_all(
        EvidenceMapper().map(ModelAnswer.model_validate({"status": "answered", "claims": [PARAPHRASE]}), [EV]), Q)
    assert base[0].status == SupportStatus.PARTIALLY_SUPPORTED and not base[0].capped_by_hard_rule
    (d,), _ = judge([verdicts(("c1", "ENTAILED"))], [PARAPHRASE])
    assert d.status == SupportStatus.SUPPORTED
    assert d.assessment.semantically_verified and d.assessment.verification == VerificationLevel.SEMANTIC_JUDGE
    assert d.assessment.judge_verdict == "ENTAILED"


def test_not_entailed_becomes_kopuk():
    (d,), _ = judge([verdicts(("c1", "NOT_ENTAILED"))], [PARAPHRASE])
    assert d.status == SupportStatus.UNSUPPORTED and "NOT_ENTAILED" in d.explanation


def test_judge_cannot_override_hard_rules():
    claim = {**PARAPHRASE, "text": "AVL ağacı 2 kat daha sıkı dengelidir ve aramada daha hızlıdır."}  # number not in source
    (d,), _ = judge([verdicts(("c1", "ENTAILED"))], [claim])
    assert d.status == SupportStatus.PARTIALLY_SUPPORTED and d.assessment.semantically_verified


def test_judge_failure_falls_back_and_is_not_verified():
    for script in (["not json"], [ProviderUnavailableError()], [verdicts(("c9", "ENTAILED"))]):
        (d,), _ = judge(script, [PARAPHRASE])
        assert d.assessment.verification == VerificationLevel.HEURISTIC_FALLBACK
        assert d.assessment.semantically_verified is False


def test_kopuk_claims_are_not_sent_to_the_judge():
    claim = {"text": "Kırmızı-siyah ağaçta yükseklik 2·log(n+1).", "evidence_ids": ["E9"]}
    (d,), p = judge([AssertionError("must not be called")], [claim])
    assert d.status == SupportStatus.UNSUPPORTED and p.requests == []


def test_judge_prompt_keeps_evidence_out_of_system_message():
    _, p = judge([verdicts(("c1", "ENTAILED"))], [PARAPHRASE])
    assert "sıkı dengeli" not in p.requests[0].system and '"claim_id": "c1"' in p.requests[0].user


def test_pipeline_with_judge_reports_confirmed_support(make_components, settings):
    s = replace(settings, support=replace(settings.support, judge="llm"))

    def answer(r):
        e = next(x for x in r.user.split('<evidence id="')[1:] if "Dört temel rotasyon" in x).split('"')[0]
        return json.dumps({"status": "answered", "claims": [{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [e],
                                                              "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"}], "missing": []})

    from knot_rag.bootstrap import build_components

    comps = build_components(s, index=make_components().index, embedder=make_components().embedder,
                             provider=ScriptedProvider([answer]), judge_provider=ScriptedProvider([verdicts(("c1", "ENTAILED"))]))
    ans = comps.rag.answer(AnswerRequest(question="Kaç temel rotasyon vardır ve bunlar nelerdir?", scope=scope()), "r")
    assert ans.support_label == "SIKI" and ans.support_confirmed and ans.verification == VerificationLevel.SEMANTIC_JUDGE
